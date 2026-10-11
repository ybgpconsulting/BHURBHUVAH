import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

app.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM plan_templates ORDER BY sort_order ASC, name ASC').all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/', requireRole('owner'), async (c) => {
  try {
    const data = await c.req.json();
    const id = crypto.randomUUID();
    
    const { success } = await c.env.DB.prepare(`
      INSERT INTO plan_templates (id, name, duration_days, duration_type, price, description, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, data.name, data.duration_days, data.duration_type || 'fixed_days', data.price || null, data.description || null, data.is_active !== undefined ? data.is_active : 1, data.sort_order || 0
    ).run();

    if (!success) return c.json({ error: 'Failed to create' }, 500);
    return c.json({ id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const data = await c.req.json();
    
    const { success } = await c.env.DB.prepare(`
      UPDATE plan_templates 
      SET name = ?, duration_days = ?, duration_type = ?, price = ?, description = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      data.name, data.duration_days, data.duration_type || 'fixed_days', data.price || null, data.description || null, data.is_active !== undefined ? data.is_active : 1, data.sort_order || 0, id
    ).run();

    if (!success) return c.json({ error: 'Failed to update' }, 500);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
