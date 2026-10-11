import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';

const app = new Hono<Env>();

app.use('*', requireAuth);

app.get('/', requireRole('owner', 'manager'), async (c) => {
  try {
    const { customer_id, status } = c.req.query();
    let query = 'SELECT * FROM delivery_changes WHERE 1=1';
    const params: any[] = [];
    
    if (customer_id) {
      query += ' AND customer_id = ?';
      params.push(customer_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/', requireRole('owner', 'manager'), async (c) => {
  try {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const data = await c.req.json();
    const id = crypto.randomUUID();
    
    const { success } = await c.env.DB.prepare(`
      INSERT INTO delivery_changes (
        id, customer_id, subscription_id, change_type, effective_date, end_date, 
        product_id, previous_value, new_value, previous_quantity, new_quantity, 
        new_product_id, new_address, new_route_id, new_partner_id, reason, status, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, data.customer_id, data.subscription_id || null, data.change_type, data.effective_date, data.end_date || null,
      data.product_id || null, data.previous_value || null, data.new_value || null, data.previous_quantity || null, data.new_quantity || null,
      data.new_product_id || null, data.new_address || null, data.new_route_id || null, data.new_partner_id || null, data.reason || null, data.status || 'pending', user.id
    ).run();

    if (!success) return c.json({ error: 'Failed to create' }, 500);
    return c.json({ id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/:id/approve', requireRole('owner', 'manager'), async (c) => {
  try {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    const { success } = await c.env.DB.prepare('UPDATE delivery_changes SET status = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('approved', user.id, id).run();
    if (!success) return c.json({ error: 'Failed to approve' }, 500);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/:id/reject', requireRole('owner', 'manager'), async (c) => {
  try {
    const id = c.req.param('id');
    const { success } = await c.env.DB.prepare('UPDATE delivery_changes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('rejected', id).run();
    if (!success) return c.json({ error: 'Failed to reject' }, 500);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
