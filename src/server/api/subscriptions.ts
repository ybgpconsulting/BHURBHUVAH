import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';
import { addDays, endOfMonth, parseISO, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { getSubscriptionItemsAtDate, renewSubscription } from '../subscription-service';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

app.get('/', requireRole('owner', 'manager'), async (c) => {
  try {
    const { customer_id, status } = c.req.query();
    const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    let query = `
      SELECT s.*, c.name AS customer_name, p.name AS plan_name,
        (SELECT group_concat(pr.name, ', ')
          FROM subscription_items si
          JOIN products pr ON pr.id = si.product_id
          WHERE si.subscription_id = s.id) AS product_name,
        COALESCE((
          SELECT CASE WHEN dc.change_type = 'pause'
            AND (dc.end_date IS NULL OR dc.end_date >= ?)
            THEN 1 ELSE 0 END
          FROM delivery_changes dc
          WHERE dc.subscription_id = s.id AND dc.status = 'approved'
            AND dc.change_type IN ('pause', 'resume') AND dc.effective_date <= ?
          ORDER BY dc.effective_date DESC, dc.created_at DESC, dc.rowid DESC LIMIT 1
        ), 0) AS is_paused
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      LEFT JOIN plan_templates p ON p.id = s.plan_template_id
      WHERE 1=1
    `;
    const params: any[] = [today, today];
    
    if (customer_id) {
      query += ' AND s.customer_id = ?';
      params.push(customer_id);
    }
    if (status) {
      query += ' AND s.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY s.created_at DESC';
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/expiring', requireRole('owner', 'manager'), async (c) => {
  try {
    const days = parseInt(c.req.query('days') || '7');
    if (!Number.isInteger(days) || days < 0) return c.json({ error: 'Days must be a non-negative integer' }, 400);
    const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    const futureDate = format(addDays(parseISO(today), days), 'yyyy-MM-dd');
    
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM subscriptions WHERE status = ? AND end_date >= ? AND end_date <= ? ORDER BY end_date ASC'
    ).bind('active', today, futureDate).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Subscription ID is required' }, 400);
    const subscription = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first();
    if (!subscription) return c.json({ error: 'Not found' }, 404);

    const effectiveDate = c.req.query('effective_date')
      || formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    if (!isBusinessDate(effectiveDate)) return c.json({ error: 'Effective date must use YYYY-MM-DD format' }, 400);
    const items = await getSubscriptionItemsAtDate(c.env.DB, id, effectiveDate);
    return c.json({ ...subscription, items });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/', requireRole('owner', 'manager'), async (c) => {
  try {
    const data = await c.req.json();
    if (!data.customer_id || !data.plan_template_id || !isBusinessDate(data.start_date)) {
      return c.json({ error: 'Customer, plan, and a valid start date are required' }, 400);
    }
    if (!Array.isArray(data.items) || data.items.length === 0 || !validItems(data.items)) {
      return c.json({ error: 'At least one unique product with a positive quantity is required' }, 400);
    }
    const id = crypto.randomUUID();
    
    const plan = await c.env.DB.prepare('SELECT * FROM plan_templates WHERE id = ?').bind(data.plan_template_id).first<{duration_type: string, duration_days: number, price: number}>();
    if (!plan) return c.json({ error: 'Invalid plan template' }, 400);

    let end_date = data.end_date;
    if (!end_date) {
      const startDate = parseISO(data.start_date);
      if (plan.duration_type === 'fixed_days') {
        end_date = format(addDays(startDate, plan.duration_days - 1), 'yyyy-MM-dd');
      } else if (plan.duration_type === 'calendar_month') {
        end_date = format(endOfMonth(startDate), 'yyyy-MM-dd');
      }
    }

    const customer = await c.env.DB.prepare('SELECT id FROM customers WHERE id = ? AND status = ?')
      .bind(data.customer_id, 'active').first();
    if (!customer) return c.json({ error: 'Active customer not found' }, 400);
    const { success } = await c.env.DB.prepare(`
      INSERT INTO subscriptions (id, customer_id, plan_template_id, start_date, end_date, status, delivery_days, price, payment_status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, data.customer_id, data.plan_template_id, data.start_date, end_date, data.status || 'active', data.delivery_days || '1,2,3,4,5,6,7', data.price ?? plan.price ?? 0, data.payment_status || 'pending', data.notes || null
    ).run();

    if (!success) return c.json({ error: 'Failed to create subscription' }, 500);

    {
      for (const item of data.items) {
        const result = await c.env.DB.prepare(`
          INSERT INTO subscription_items (id, subscription_id, product_id, quantity, unit_price)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), id, item.product_id, item.quantity, item.unit_price ?? null
        ).run();
        if (!result.success) throw new Error('Failed to save subscription products');
      }
    }

    return c.json({ id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/:id', requireRole('owner', 'manager'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Subscription ID is required' }, 400);
    const data = await c.req.json();
    const current = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first<any>();
    if (!current) return c.json({ error: 'Subscription not found' }, 404);

    const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    const effectiveDate: unknown = data.effective_date;
    const safeEffectiveDate: string = isBusinessDate(effectiveDate) ? effectiveDate : '';
    const dateFields = ['start_date', 'end_date'];
    if (dateFields.some(field => data[field] !== undefined && !isBusinessDate(data[field]))) {
      return c.json({ error: 'Subscription dates must use YYYY-MM-DD format' }, 400);
    }
    if (data.status !== undefined && !['active', 'expired', 'cancelled'].includes(data.status)) {
      return c.json({ error: 'Subscription status must be active, expired, or cancelled; use pause/resume for temporary holds' }, 400);
    }
    const nextStart = data.start_date ?? current.start_date;
    const nextEnd = data.end_date ?? current.end_date;
    if (nextEnd < nextStart) return c.json({ error: 'End date cannot be before start date' }, 400);
    if (data.delivery_days !== undefined && !validDeliveryDays(data.delivery_days)) {
      return c.json({ error: 'Delivery days must be a comma-separated set of weekday values from 1 to 7' }, 400);
    }

    let oldItems: any[] = [];
    const itemChanges: D1PreparedStatement[] = [];
    if (data.items !== undefined) {
      if (!safeEffectiveDate || safeEffectiveDate < today) {
        return c.json({ error: 'Product and quantity changes require an effective date of today or later' }, 400);
      }
      if (!Array.isArray(data.items) || data.items.length === 0 || !validItems(data.items)) {
        return c.json({ error: 'At least one unique product with a positive quantity is required' }, 400);
      }
      const lockedRun = await c.env.DB.prepare(
        "SELECT id FROM dispatch_runs WHERE delivery_date = ? AND status = 'locked' LIMIT 1",
      ).bind(safeEffectiveDate).first();
      if (lockedRun) return c.json({ error: 'Changes cannot be applied to a published delivery date; choose a future date' }, 409);
      oldItems = await getSubscriptionItemsAtDate(c.env.DB, id, safeEffectiveDate);
      const productIds = [...new Set([...oldItems.map(item => item.product_id), ...data.items.map((item: any) => item.product_id)])];
      const placeholders = productIds.map(() => '?').join(',');
      const availableProducts = await c.env.DB.prepare(
        `SELECT id FROM products WHERE is_active = 1 AND id IN (${placeholders})`,
      ).bind(...productIds).all();
      if (availableProducts.results.length !== productIds.length) {
        return c.json({ error: 'All subscription products must be active products' }, 400);
      }
      const oldByProduct = new Map<string, any>(oldItems.map(item => [item.product_id, item]));
      const newByProduct = new Map<string, any>(data.items.map((item: any) => [item.product_id, item]));
      for (const [productId, oldItem] of oldByProduct) {
        const nextItem = newByProduct.get(productId);
        if (!nextItem) {
          itemChanges.push(makeChange(c.env.DB, {
            customerId: current.customer_id, subscriptionId: id, userId: c.get('user')!.id,
            type: 'quantity_change', effectiveDate: safeEffectiveDate, productId,
            previousQuantity: oldItem.quantity, newQuantity: 0,
          }));
        } else if (Number(nextItem.quantity) !== Number(oldItem.quantity)) {
          itemChanges.push(makeChange(c.env.DB, {
            customerId: current.customer_id, subscriptionId: id, userId: c.get('user')!.id,
            type: 'quantity_change', effectiveDate: safeEffectiveDate, productId,
            previousQuantity: oldItem.quantity, newQuantity: Number(nextItem.quantity),
          }));
        }
      }
      for (const [productId, nextItem] of newByProduct) {
        if (!oldByProduct.has(productId)) {
          itemChanges.push(makeChange(c.env.DB, {
            customerId: current.customer_id, subscriptionId: id, userId: c.get('user')!.id,
            type: 'product_change', effectiveDate: safeEffectiveDate, newProductId: productId,
            newQuantity: Number(nextItem.quantity),
          }));
        }
      }
    }

    const planId = data.plan_template_id ?? current.plan_template_id;
    const plan = await c.env.DB.prepare('SELECT id FROM plan_templates WHERE id = ?').bind(planId).first();
    if (!plan) return c.json({ error: 'Invalid plan template' }, 400);
    const updateStatement = c.env.DB.prepare(`
      UPDATE subscriptions
      SET plan_template_id = ?, start_date = ?, end_date = ?, status = ?, delivery_days = ?,
        price = ?, payment_status = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      planId, nextStart, nextEnd, data.status ?? current.status,
      data.delivery_days ?? current.delivery_days, data.price ?? current.price,
      data.payment_status ?? current.payment_status, data.notes ?? current.notes,
      new Date().toISOString(), id,
    );
    const results = await c.env.DB.batch([updateStatement, ...itemChanges]);
    if (!results[0].success) return c.json({ error: 'Failed to update subscription' }, 500);
    return c.json({ success: true, effective_date: typeof effectiveDate === 'string' ? effectiveDate : null });
  } catch (err: any) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to update subscription' }, 500);
  }
});

app.post('/:id/pause', requireRole('owner', 'manager'), async (c) => {
  try {
    const id = c.req.param('id');
    const { effective_date: effectiveDate, end_date: endDate } = await c.req.json<{ effective_date?: string; end_date?: string }>();
    const subscription = await c.env.DB.prepare('SELECT customer_id, status FROM subscriptions WHERE id = ?').bind(id).first<any>();
    if (!subscription) return c.json({ error: 'Subscription not found' }, 404);
    const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    if (!isBusinessDate(effectiveDate) || effectiveDate < today
      || (endDate !== undefined && (!isBusinessDate(endDate) || endDate < effectiveDate))) {
      return c.json({ error: 'Pause requires valid dates; the end date must be on or after its effective date' }, 400);
    }
    const validPauseDate = effectiveDate;
    const result = await c.env.DB.prepare(`
      INSERT INTO delivery_changes (id, customer_id, subscription_id, change_type, effective_date, end_date, status, created_by)
      VALUES (?, ?, ?, 'pause', ?, ?, 'approved', ?)
    `).bind(crypto.randomUUID(), subscription.customer_id, id, validPauseDate, endDate ?? null, c.get('user')!.id).run();
    if (!result.success) return c.json({ error: 'Failed to pause subscription' }, 500);
    return c.json({ success: true, effective_date: effectiveDate });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to pause subscription' }, 500);
  }
});

app.post('/:id/resume', requireRole('owner', 'manager'), async (c) => {
  try {
    const id = c.req.param('id');
    const { effective_date: effectiveDate } = await c.req.json<{ effective_date?: string }>();
    const subscription = await c.env.DB.prepare('SELECT customer_id FROM subscriptions WHERE id = ?').bind(id).first<any>();
    if (!subscription) return c.json({ error: 'Subscription not found' }, 404);
    const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    if (!isBusinessDate(effectiveDate) || effectiveDate < today) {
      return c.json({ error: 'Resume requires a valid effective date of today or later' }, 400);
    }
    const validResumeDate = effectiveDate;
    const result = await c.env.DB.prepare(`
      INSERT INTO delivery_changes (id, customer_id, subscription_id, change_type, effective_date, status, created_by)
      VALUES (?, ?, ?, 'resume', ?, 'approved', ?)
    `).bind(crypto.randomUUID(), subscription.customer_id, id, validResumeDate, c.get('user')!.id).run();
    if (!result.success) return c.json({ error: 'Failed to resume subscription' }, 500);
    return c.json({ success: true, effective_date: effectiveDate });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to resume subscription' }, 500);
  }
});

app.post('/:id/renew', requireRole('owner', 'manager'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Subscription ID is required' }, 400);
    const result = await renewSubscription(c.env.DB, id);
    return c.json(result, result.already_renewed ? 200 : 201);
  } catch (err: any) {
    const message = err instanceof Error ? err.message : 'Failed to renew subscription';
    return c.json({ error: message }, message === 'Subscription not found' ? 404 : 400);
  }
});

function isBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return !Number.isNaN(parsed.getTime()) && format(parsed, 'yyyy-MM-dd') === value;
}

function validDeliveryDays(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const days = value.split(',').map(Number);
  return days.length > 0 && days.every(day => Number.isInteger(day) && day >= 1 && day <= 7)
    && new Set(days).size === days.length;
}

function validItems(items: unknown[]): boolean {
  return items.every((item: any) => typeof item?.product_id === 'string' && item.product_id.length > 0
      && typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0)
    && new Set(items.map((item: any) => item.product_id)).size === items.length;
}

function makeChange(db: D1Database, change: {
  customerId: string;
  subscriptionId: string;
  userId: string;
  type: string;
  effectiveDate: string;
  productId?: string;
  newProductId?: string;
  previousQuantity?: number;
  newQuantity?: number;
}) {
  return db.prepare(`
    INSERT INTO delivery_changes
      (id, customer_id, subscription_id, change_type, effective_date, product_id,
       previous_quantity, new_quantity, new_product_id, status, created_by, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
  `).bind(
    crypto.randomUUID(), change.customerId, change.subscriptionId, change.type,
    change.effectiveDate, change.productId ?? null, change.previousQuantity ?? null,
    change.newQuantity ?? null, change.newProductId ?? null, change.userId, change.userId,
  );
}

export default app;
