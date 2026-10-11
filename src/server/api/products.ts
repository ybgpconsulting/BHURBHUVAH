import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

app.get('/', async (c) => {
  try {
    const { is_active } = c.req.query();
    let query = 'SELECT * FROM products';
    const params: any[] = [];
    
    if (is_active !== undefined) {
      query += ' WHERE is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }
    
    query += ' ORDER BY sort_order ASC, name ASC';
    const { results } = await c.env.DB.prepare(query).bind(...params).all();
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
      INSERT INTO products (id, name, category, unit, default_price, packing_notes, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, data.name, data.category || 'milk', data.unit || 'litre', data.default_price || null, data.packing_notes || null, data.is_active !== undefined ? data.is_active : 1, data.sort_order || 0
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
      UPDATE products 
      SET name = ?, category = ?, unit = ?, default_price = ?, packing_notes = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      data.name, data.category || 'milk', data.unit || 'litre', data.default_price || null, data.packing_notes || null, data.is_active !== undefined ? data.is_active : 1, data.sort_order || 0, id
    ).run();

    if (!success) return c.json({ error: 'Failed to update' }, 500);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
