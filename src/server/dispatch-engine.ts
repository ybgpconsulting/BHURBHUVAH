import { addDays, format, getDay, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { DispatchNotificationProvider } from './dispatch-notifications';

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

export function getUtcCronExpression(localTime: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime);
  if (!match) throw new Error('Dispatch generation time must use 24-hour HH:mm format');
  const utcMinutes = (Number(match[1]) * 60 + Number(match[2]) - 330 + 1440) % 1440;
  return `${utcMinutes % 60} ${Math.floor(utcMinutes / 60)} * * *`;
}

export function getNextDeliveryDate(instant: Date): string {
  const businessToday = formatInTimeZone(instant, BUSINESS_TIMEZONE, 'yyyy-MM-dd');
  return format(addDays(parseISO(businessToday), 1), 'yyyy-MM-dd');
}

export async function validateDispatch(db: D1Database, dispatchRunId: string): Promise<string[]> {
  const checks = await db.prepare(`
    SELECT
      COUNT(*) AS total_deliveries,
      SUM(CASE WHEN d.route_id IS NULL THEN 1 ELSE 0 END) AS missing_route,
      SUM(CASE WHEN d.assigned_partner_id IS NULL OR u.is_active != 1 OR u.role != 'delivery_partner' THEN 1 ELSE 0 END) AS missing_partner,
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM delivery_items di WHERE di.delivery_id = d.id) THEN 1 ELSE 0 END) AS missing_items
    FROM deliveries d
    LEFT JOIN users u ON u.id = d.assigned_partner_id
    WHERE d.dispatch_run_id = ?
  `).bind(dispatchRunId).first<{ total_deliveries: number; missing_route: number; missing_partner: number; missing_items: number }>();

  const errors: string[] = [];
  if (!checks?.total_deliveries) errors.push('Dispatch contains no deliveries');
  if (checks?.missing_route) errors.push(`${checks.missing_route} delivery(ies) have no route`);
  if (checks?.missing_partner) errors.push(`${checks.missing_partner} delivery(ies) have no active delivery partner`);
  if (checks?.missing_items) errors.push(`${checks.missing_items} delivery(ies) have no product items`);
  return errors;
}

export async function publishDispatch(
  db: D1Database,
  dispatchRunId: string,
  userId: string,
  notificationProvider?: DispatchNotificationProvider,
): Promise<void> {
  const errors = await validateDispatch(db, dispatchRunId);
  if (errors.length) throw new Error(`Dispatch has validation errors: ${errors.join('; ')}`);

  const now = new Date().toISOString();
  const run = await db.prepare('SELECT delivery_date FROM dispatch_runs WHERE id = ? AND status = ?')
    .bind(dispatchRunId, 'draft').first<{ delivery_date: string }>();
  if (!run) throw new Error('Dispatch is not a draft or no longer exists');

  const results = await db.batch([
    db.prepare("UPDATE dispatch_runs SET status = 'locked', locked_by = ?, locked_at = ?, updated_at = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'draft'")
      .bind(userId, now, now, userId, now, dispatchRunId),
    db.prepare("UPDATE dispatch_runs SET status = 'revised', updated_at = ? WHERE delivery_date = ? AND id != ? AND status = 'locked'")
      .bind(now, run.delivery_date, dispatchRunId),
  ]);
  if (!results[0].meta.changes) throw new Error('Dispatch could not be published because its status changed');
  if (notificationProvider) {
    const { results: partners } = await db.prepare(`
      SELECT DISTINCT assigned_partner_id FROM deliveries WHERE dispatch_run_id = ? AND assigned_partner_id IS NOT NULL
    `).bind(dispatchRunId).all<{ assigned_partner_id: string }>();
    try {
      await notificationProvider.dispatchPublished({
        dispatchRunId,
        deliveryDate: run.delivery_date,
        partnerIds: partners.map(partner => partner.assigned_partner_id),
      });
    } catch (error) {
      console.error('Dispatch was published but notification delivery failed', error instanceof Error ? error.message : 'Unknown notification failure');
    }
  }
}

export async function generateDispatch(db: D1Database, date: string, userId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parseISO(date).getTime()) || format(parseISO(date), 'yyyy-MM-dd') !== date) {
    throw new Error('A valid delivery date in YYYY-MM-DD format is required');
  }

  const isoDay = getDay(parseISO(date)) || 7;
  let run = await db.prepare('SELECT id, status, revision FROM dispatch_runs WHERE delivery_date = ? ORDER BY revision DESC LIMIT 1')
    .bind(date).first<{ id: string; status: string; revision: number }>();

  if (run && run.status !== 'draft') throw new Error('Dispatch is already published for this date');
  if (!run) {
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO dispatch_runs (id, delivery_date, status, revision, generated_by) VALUES (?, ?, ?, ?, ?)')
      .bind(id, date, 'draft', 1, userId).run();
    run = { id, status: 'draft', revision: 1 };
  }

  const { results: subscriptions } = await db.prepare(`
    SELECT s.*, c.route_id, c.name AS c_name, c.phone AS c_phone, c.address AS c_address,
      c.delivery_instructions AS c_instructions, c.assigned_partner_id AS c_partner_id
    FROM subscriptions s
    JOIN customers c ON s.customer_id = c.id
    WHERE s.status = 'active' AND c.status = 'active' AND s.start_date <= ? AND s.end_date >= ?
  `).bind(date, date).all<any>();
  const { results: changes } = await db.prepare(`
    SELECT * FROM delivery_changes
    WHERE status = 'approved' AND effective_date <= ?
    ORDER BY effective_date ASC, created_at ASC, rowid ASC
  `).bind(date).all<any>();

  let generatedCount = 0;
  const getAssignedPartner = async (customerPartner: string | null, routeId: string | null) => {
    if (customerPartner) return customerPartner;
    if (!routeId) return null;
    const route = await db.prepare('SELECT assigned_partner_id FROM routes WHERE id = ?').bind(routeId).first<{ assigned_partner_id: string | null }>();
    return route?.assigned_partner_id || null;
  };

  const eligibleSubscriptionIds = new Set<string>();
  for (const sub of subscriptions) {
    if (!sub.delivery_days.split(',').map(Number).includes(isoDay)) continue;
    const subscriptionChanges = changes.filter(change => change.subscription_id === sub.id);
    if (subscriptionChanges.some(change => change.change_type === 'skip' && change.effective_date === date)) continue;
    let paused = false;
    for (const change of subscriptionChanges) {
      if (change.change_type === 'pause') paused = !change.end_date || change.end_date >= date;
      else if (change.change_type === 'resume') paused = false;
    }
    if (!paused) eligibleSubscriptionIds.add(sub.id);
  }
  const { results: existingSubscriptions } = await db.prepare(`
    SELECT id, subscription_id FROM deliveries WHERE dispatch_run_id = ? AND subscription_id IS NOT NULL
  `).bind(run.id).all<{ id: string; subscription_id: string }>();
  for (const existing of existingSubscriptions) {
    if (!eligibleSubscriptionIds.has(existing.subscription_id)) {
      await db.prepare('DELETE FROM delivery_items WHERE delivery_id = ?').bind(existing.id).run();
      await db.prepare('DELETE FROM deliveries WHERE id = ? AND dispatch_run_id = ?').bind(existing.id, run.id).run();
    }
  }

  for (const sub of subscriptions) {
    if (!eligibleSubscriptionIds.has(sub.id)) continue;
    const subscriptionChanges = changes.filter(change => change.subscription_id === sub.id);

    let delivery = await db.prepare('SELECT id FROM deliveries WHERE dispatch_run_id = ? AND customer_id = ? AND subscription_id = ?')
      .bind(run.id, sub.customer_id, sub.id).first<{ id: string }>();
    const routeChange = subscriptionChanges.filter(c => c.end_date == null || c.end_date >= date)
      .filter(c => ['route_change', 'permanent_change'].includes(c.change_type)).at(-1);
    const addressChange = subscriptionChanges.filter(c => c.end_date == null || c.end_date >= date)
      .filter(c => ['address_change', 'permanent_change'].includes(c.change_type)).at(-1);
    const routeId = routeChange?.new_route_id || sub.route_id;
    const partnerId = routeChange?.new_partner_id || await getAssignedPartner(sub.c_partner_id, routeId);

    if (!delivery) {
      const id = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO deliveries
          (id, dispatch_run_id, customer_id, subscription_id, route_id, assigned_partner_id, delivery_date,
           customer_name, customer_phone, delivery_address, delivery_instructions, status, is_extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
      `).bind(id, run.id, sub.customer_id, sub.id, routeId, partnerId, date, sub.c_name, sub.c_phone,
        addressChange?.new_address || sub.c_address, sub.c_instructions).run();
      delivery = { id };
      generatedCount++;
    }
    await db.prepare(`
      UPDATE deliveries SET route_id = ?, assigned_partner_id = ?, delivery_address = ?, updated_at = ?
      WHERE id = ? AND dispatch_run_id = ?
    `).bind(routeId, partnerId, addressChange?.new_address || sub.c_address, new Date().toISOString(), delivery.id, run.id).run();

    const { results: items } = await db.prepare(`
      SELECT si.*, p.name AS product_name, p.unit
      FROM subscription_items si JOIN products p ON si.product_id = p.id
      WHERE si.subscription_id = ?
    `).bind(sub.id).all<any>();
    const desiredItems = new Map<string, { product_id: string; quantity: number }>(
      items.map(item => [item.product_id, { product_id: item.product_id, quantity: item.quantity }]),
    );
    for (const change of subscriptionChanges) {
      if (change.end_date && change.end_date < date) continue;
      if (change.change_type === 'quantity_change' && change.product_id) {
        if (change.new_quantity === 0) desiredItems.delete(change.product_id);
        else if (change.new_quantity != null) {
          const existing = desiredItems.get(change.product_id);
          if (existing) existing.quantity = change.new_quantity;
        }
      } else if (change.change_type === 'product_change' && change.new_product_id) {
        const oldItem = change.product_id ? desiredItems.get(change.product_id) : undefined;
        if (change.product_id) desiredItems.delete(change.product_id);
        desiredItems.set(change.new_product_id, {
          product_id: change.new_product_id,
          quantity: change.new_quantity ?? oldItem?.quantity ?? 0,
        });
      }
    }

    const existingItems = await db.prepare('SELECT id, product_id FROM delivery_items WHERE delivery_id = ?')
      .bind(delivery.id).all<{ id: string; product_id: string }>();
    const desiredProductIds = new Set(desiredItems.keys());
    for (const existing of existingItems.results) {
      if (!desiredProductIds.has(existing.product_id)) {
        await db.prepare('DELETE FROM delivery_items WHERE id = ? AND delivery_id = ?')
          .bind(existing.id, delivery.id).run();
      }
    }

    for (const desired of desiredItems.values()) {
      const product = await db.prepare('SELECT name, unit FROM products WHERE id = ?')
        .bind(desired.product_id).first<{ name: string; unit: string }>();
      if (!product) throw new Error(`Configured product ${desired.product_id} is unavailable`);
      const existing = existingItems.results.find(item => item.product_id === desired.product_id);
      if (existing) {
        await db.prepare(`
          UPDATE delivery_items SET product_name = ?, planned_quantity = ?, unit = ?, updated_at = ?
          WHERE id = ? AND delivery_id = ?
        `).bind(product.name, desired.quantity, product.unit, new Date().toISOString(), existing.id, delivery.id).run();
      } else {
        await db.prepare(`
          INSERT INTO delivery_items (id, delivery_id, product_id, product_name, planned_quantity, unit, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).bind(crypto.randomUUID(), delivery.id, desired.product_id, product.name, desired.quantity, product.unit).run();
      }
    }
  }

  const oneTimeAdds = changes.filter(c => c.change_type === 'one_time_add' && c.effective_date === date);
  for (const add of oneTimeAdds) {
    let delivery = await db.prepare('SELECT id FROM deliveries WHERE dispatch_run_id = ? AND source_change_id = ?')
      .bind(run.id, add.id).first<{ id: string }>();

    if (!delivery) {
      const customer = await db.prepare('SELECT name, phone, address, delivery_instructions, route_id, assigned_partner_id FROM customers WHERE id = ?')
        .bind(add.customer_id).first<any>();
      if (!customer) throw new Error(`Customer for extra delivery ${add.id} no longer exists`);
      const partnerId = await getAssignedPartner(customer.assigned_partner_id, customer.route_id);
      const id = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO deliveries
          (id, dispatch_run_id, customer_id, subscription_id, source_change_id, route_id, assigned_partner_id,
           delivery_date, customer_name, customer_phone, delivery_address, delivery_instructions, status, is_extra)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)
      `).bind(id, run.id, add.customer_id, add.id,
        customer.route_id, partnerId, date, customer.name, customer.phone, customer.address, customer.delivery_instructions).run();
      delivery = { id };
      generatedCount++;
    }

    const product = await db.prepare('SELECT name, unit FROM products WHERE id = ?').bind(add.product_id).first<{ name: string; unit: string }>();
    if (!product) throw new Error(`Configured product ${add.product_id} is unavailable`);
    const existingItem = await db.prepare('SELECT id FROM delivery_items WHERE delivery_id = ? AND product_id = ?')
      .bind(delivery.id, add.product_id).first();
    if (!existingItem) {
      await db.prepare(`
        INSERT INTO delivery_items (id, delivery_id, product_id, product_name, planned_quantity, unit, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).bind(crypto.randomUUID(), delivery.id, add.product_id, product.name, add.new_quantity, product.unit).run();
    }
  }

  const totals = await db.prepare(`
    SELECT COUNT(DISTINCT d.id) AS total_orders, COALESCE(SUM(di.planned_quantity), 0) AS total_quantity
    FROM deliveries d LEFT JOIN delivery_items di ON d.id = di.delivery_id
    WHERE d.dispatch_run_id = ?
  `).bind(run.id).first<{ total_orders: number; total_quantity: number }>();
  await db.prepare('UPDATE dispatch_runs SET total_orders = ?, total_quantity = ?, updated_at = ? WHERE id = ? AND status = ?')
    .bind(totals?.total_orders || 0, totals?.total_quantity || 0, new Date().toISOString(), run.id, 'draft').run();

  return { dispatchRunId: run.id, generatedCount, totals: totals || { total_orders: 0, total_quantity: 0 } };
}
