import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole, hashPassword } from '../middleware/auth';

const app = new Hono<Env>();

app.use('*', requireAuth, requireRole('owner'));

app.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT id, email, name, phone, role, is_active, created_at FROM users ORDER BY created_at DESC').all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/', async (c) => {
  try {
    const data = await c.req.json();
    if (!validUserData(data) || typeof data.password !== 'string' || data.password.length < 12) {
      return c.json({ error: 'Name, valid email, supported role, and a password of at least 12 characters are required' }, 400);
    }
    const id = crypto.randomUUID();
    
    const hash = await hashPassword(data.password);
    
    const { success } = await c.env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, name, phone, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, data.email.trim().toLowerCase(), hash, data.name.trim(), data.phone || null, data.role, data.is_active !== undefined ? data.is_active : 1
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
    if (!id) return c.json({ error: 'User ID is required' }, 400);
    if (!validUserData(data) || (data.password !== undefined
      && (typeof data.password !== 'string' || data.password.length < 12))) {
      return c.json({ error: 'Name, valid email, supported role, and an optional password of at least 12 characters are required' }, 400);
    }
    
    let query = 'UPDATE users SET email = ?, name = ?, phone = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP';
    const params: any[] = [data.email.trim().toLowerCase(), data.name.trim(), data.phone || null, data.role, data.is_active !== undefined ? data.is_active : 1];

    if (data.password) {
      query += ', password_hash = ?';
      params.push(await hashPassword(data.password));
    }

    query += ' WHERE id = ?';
    params.push(id);

    const { success } = await c.env.DB.prepare(query).bind(...params).run();

    if (!success) return c.json({ error: 'Failed to update' }, 500);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

function validUserData(data: any): boolean {
  return typeof data.name === 'string' && data.name.trim().length > 0
    && typeof data.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())
    && ['owner', 'manager', 'delivery_partner'].includes(data.role)
    && (data.is_active === undefined || data.is_active === 0 || data.is_active === 1);
}

export default app;
