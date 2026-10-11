import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

app.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT r.*, u.name AS partner_name, COUNT(c.id) AS customer_count
      FROM routes r
      LEFT JOIN users u ON u.id = r.assigned_partner_id
      LEFT JOIN customers c ON c.route_id = r.id
      GROUP BY r.id
      ORDER BY r.sort_order ASC, r.name ASC
    `).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/', requireRole('owner', 'manager'), async (c) => {
  try {
    const data = await c.req.json();
    const id = crypto.randomUUID();
    
    const { success } = await c.env.DB.prepare(`
      INSERT INTO routes (id, name, description, assigned_partner_id, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      id, data.name, data.description || null, data.assigned_partner_id || null, data.is_active !== undefined ? data.is_active : 1, data.sort_order || 0
    ).run();

    if (!success) return c.json({ error: 'Failed to create' }, 500);
    return c.json({ id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/:id', requireRole('owner', 'manager'), async (c) => {
  try {
    const id = c.req.param('id');
    const data = await c.req.json();
    
    const { success } = await c.env.DB.prepare(`
      UPDATE routes 
      SET name = ?, description = ?, assigned_partner_id = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      data.name, data.description || null, data.assigned_partner_id || null, data.is_active !== undefined ? data.is_active : 1, data.sort_order || 0, id
    ).run();

    if (!success) return c.json({ error: 'Failed to update' }, 500);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
