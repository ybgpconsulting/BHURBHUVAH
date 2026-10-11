import { addDays, endOfMonth, format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export async function renewSubscription(db: D1Database, subscriptionId: string) {
  const oldSub = await db.prepare('SELECT * FROM subscriptions WHERE id = ?')
    .bind(subscriptionId).first<any>();
  if (!oldSub) throw new Error('Subscription not found');
  if (oldSub.status === 'cancelled' || oldSub.status === 'renewed') {
    throw new Error('Cancelled or already replaced subscriptions cannot be renewed');
  }

  const existing = await db.prepare('SELECT id FROM subscriptions WHERE renewed_from_id = ?')
    .bind(subscriptionId).first<{ id: string }>();
  if (existing) return { id: existing.id, already_renewed: true };

  const plan = await db.prepare('SELECT duration_type, duration_days, price FROM plan_templates WHERE id = ?')
    .bind(oldSub.plan_template_id).first<{ duration_type: string; duration_days: number; price: number }>();
  if (!plan) throw new Error('Invalid plan template');
  const oldItems = await getSubscriptionItemsAtDate(db, subscriptionId, oldSub.end_date);
  if (!oldItems.length) throw new Error('Subscription has no products to renew');

  const nextDay = format(addDays(parseISO(oldSub.end_date), 1), 'yyyy-MM-dd');
  const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const startDate = nextDay < today ? today : nextDay;
  const parsedStart = parseISO(startDate);
  const endDate = plan.duration_type === 'fixed_days'
    ? format(addDays(parsedStart, plan.duration_days - 1), 'yyyy-MM-dd')
    : format(endOfMonth(parsedStart), 'yyyy-MM-dd');

  const id = crypto.randomUUID();
  const statements = [
    db.prepare(`
      INSERT INTO subscriptions
        (id, customer_id, plan_template_id, start_date, end_date, status, delivery_days, price, payment_status, renewed_from_id)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 'pending', ?)
    `).bind(
      id, oldSub.customer_id, oldSub.plan_template_id, startDate, endDate,
      oldSub.delivery_days, oldSub.price ?? plan.price ?? 0, subscriptionId,
    ),
    ...oldItems.map(item => db.prepare(`
      INSERT INTO subscription_items (id, subscription_id, product_id, quantity, unit_price)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, item.product_id, item.quantity, item.unit_price)),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const concurrentRenewal = await db.prepare('SELECT id FROM subscriptions WHERE renewed_from_id = ?')
      .bind(subscriptionId).first<{ id: string }>();
    if (concurrentRenewal) return { id: concurrentRenewal.id, already_renewed: true };
    throw error;
  }
  return { id, start_date: startDate, end_date: endDate, already_renewed: false };
}

export async function getSubscriptionItemsAtDate(db: D1Database, subscriptionId: string, date: string) {
  const { results: items } = await db.prepare(
    'SELECT product_id, quantity, unit_price FROM subscription_items WHERE subscription_id = ?',
  ).bind(subscriptionId).all<{ product_id: string; quantity: number; unit_price: number | null }>();
  const projected = new Map(items.map(item => [item.product_id, {
    product_id: item.product_id,
    quantity: Number(item.quantity),
    unit_price: item.unit_price,
  }]));
  const { results: changes } = await db.prepare(`
    SELECT change_type, product_id, new_product_id, new_quantity, end_date
    FROM delivery_changes
    WHERE subscription_id = ? AND status = 'approved' AND effective_date <= ?
      AND change_type IN ('quantity_change', 'product_change')
    ORDER BY effective_date, created_at, rowid
  `).bind(subscriptionId, date).all<{
    change_type: string;
    product_id: string | null;
    new_product_id: string | null;
    new_quantity: number | null;
    end_date: string | null;
  }>();

  for (const change of changes) {
    if (change.end_date && change.end_date < date) continue;
    if (change.change_type === 'quantity_change' && change.product_id) {
      if (change.new_quantity === 0) projected.delete(change.product_id);
      else if (change.new_quantity != null) {
        const item = projected.get(change.product_id);
        if (item) item.quantity = Number(change.new_quantity);
      }
    } else if (change.change_type === 'product_change' && change.new_product_id) {
      const previousItem = change.product_id ? projected.get(change.product_id) : undefined;
      if (change.product_id) projected.delete(change.product_id);
      projected.set(change.new_product_id, {
        product_id: change.new_product_id,
        quantity: Number(change.new_quantity ?? previousItem?.quantity ?? 0),
        unit_price: previousItem?.unit_price ?? null,
      });
    }
  }
  return [...projected.values()];
}
