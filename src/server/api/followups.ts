import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';
import { formatInTimeZone } from 'date-fns-tz';
import { renewSubscription } from '../subscription-service';

const app = new Hono<Env>();

app.use('*', requireAuth, requireRole('owner', 'manager'));

app.get('/', async (c) => {
  try {
    const { status, days } = c.req.query();
    const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    let query = `
      SELECT f.*, c.name AS customer_name, c.phone,
        s.end_date, p.name AS plan_name,
        (SELECT group_concat(pr.name, ', ')
          FROM subscription_items si
          JOIN products pr ON pr.id = si.product_id
          WHERE si.subscription_id = s.id) AS product_name,
        CASE WHEN COALESCE(s.end_date, f.next_follow_up_date) IS NULL THEN NULL
          ELSE CAST(julianday(COALESCE(s.end_date, f.next_follow_up_date)) - julianday(?) AS INTEGER)
        END AS days_left
      FROM follow_up_tasks f
      JOIN customers c ON c.id = f.customer_id
      LEFT JOIN subscriptions s ON s.id = f.subscription_id
      LEFT JOIN plan_templates p ON p.id = s.plan_template_id
      WHERE 1=1
    `;
    const params: any[] = [today];
    
    if (status) {
      query += ' AND f.status = ?';
      params.push(status);
    }

    if (days !== undefined) {
      const daysFilter = Number(days);
      if (!Number.isInteger(daysFilter) || daysFilter < -1) {
        return c.json({ error: 'Invalid days filter' }, 400);
      }
      if (daysFilter === -1) {
        query += ' AND (s.end_date < ? OR s.status = ?)';
        params.push(today, 'expired');
      } else {
        const endDate = formatInTimeZone(
          new Date(Date.now() + daysFilter * 24 * 60 * 60 * 1000),
          'Asia/Kolkata',
          'yyyy-MM-dd',
        );
        query += ' AND s.end_date >= ? AND s.end_date <= ?';
        params.push(today, endDate);
      }
    }
    
    query += ' ORDER BY COALESCE(s.end_date, f.next_follow_up_date) ASC';
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/', async (c) => {
  try {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const data = await c.req.json();
    const id = crypto.randomUUID();
    
    const { success } = await c.env.DB.prepare(`
      INSERT INTO follow_up_tasks (id, customer_id, subscription_id, task_type, status, assigned_to, last_contact_date, next_follow_up_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, data.customer_id, data.subscription_id || null, data.task_type || 'general', data.status || 'pending', data.assigned_to || null, data.last_contact_date || null, data.next_follow_up_date || null, data.notes || null, user.id
    ).run();

    if (!success) return c.json({ error: 'Failed to create' }, 500);
    return c.json({ id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const data = await c.req.json();
    const actionStatuses: Record<string, string> = {
      mark_contacted: 'contacted',
      mark_interested: 'interested',
      mark_not_interested: 'not_interested',
      no_response: 'no_response',
      record_renewal: 'renewed',
    };
    const status = actionStatuses[data.action] || data.status;
    const allowedStatuses = ['pending', 'contacted', 'interested', 'renewed', 'not_interested', 'no_response', 'closed'];
    if (!allowedStatuses.includes(status)) {
      return c.json({ error: 'Invalid follow-up action or status' }, 400);
    }
    const today = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    let renewalId: string | undefined;
    if (data.action === 'record_renewal') {
      const task = await c.env.DB.prepare('SELECT subscription_id FROM follow_up_tasks WHERE id = ?')
        .bind(id).first<{ subscription_id: string | null }>();
      if (!task) return c.json({ error: 'Follow-up task not found' }, 404);
      if (!task.subscription_id) return c.json({ error: 'Follow-up has no subscription to renew' }, 400);
      renewalId = (await renewSubscription(c.env.DB, task.subscription_id)).id;
    }
    const { success } = await c.env.DB.prepare(`
      UPDATE follow_up_tasks 
      SET task_type = COALESCE(?, task_type), status = ?,
        assigned_to = COALESCE(?, assigned_to),
        last_contact_date = COALESCE(?, last_contact_date),
        next_follow_up_date = COALESCE(?, next_follow_up_date),
        notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      data.task_type || null, status, data.assigned_to || null,
      data.last_contact_date || (data.action ? today : null),
      data.next_follow_up_date || null, data.notes || null, id
    ).run();

    if (!success) return c.json({ error: 'Failed to update' }, 500);
    return c.json({ success: true, renewal_id: renewalId });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
