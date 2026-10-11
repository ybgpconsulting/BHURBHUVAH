import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

app.get('/', async (c) => {
  try {
    const { search, status, route_id, page = '1', pageSize = '20' } = c.req.query();
    let query = `
      SELECT c.*, r.name as route_name 
      FROM customers c 
      LEFT JOIN routes r ON c.route_id = r.id 
      WHERE 1=1
    `;
    let countQuery = 'SELECT COUNT(*) as total FROM customers c WHERE 1=1';
    const params: any[] = [];

    if (search) {
      const searchClause = ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.customer_code LIKE ?)';
      query += searchClause;
      countQuery += searchClause;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      const statusClause = ' AND c.status = ?';
      query += statusClause;
      countQuery += statusClause;
      params.push(status);
    }
    if (route_id) {
      const routeClause = ' AND c.route_id = ?';
      query += routeClause;
      countQuery += routeClause;
      params.push(route_id);
    }

    const { total } = await c.env.DB.prepare(countQuery).bind(...params).first<{total: number}>() || { total: 0 };

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), offset);

    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ data: results, total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const customer = await c.env.DB.prepare(`
      SELECT c.*, r.name as route_name 
      FROM customers c 
      LEFT JOIN routes r ON c.route_id = r.id 
      WHERE c.id = ?
    `).bind(id).first();
    
    if (!customer) return c.json({ error: 'Not found' }, 404);

    const { results: subscriptions } = await c.env.DB.prepare('SELECT * FROM subscriptions WHERE customer_id = ?').bind(id).all();
    return c.json({ ...customer, subscriptions });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/', requireRole('owner', 'manager'), async (c) => {
  try {
    const data = await c.req.json();
    const id = crypto.randomUUID();
    
    // Auto-generate customer_code
    const { count } = await c.env.DB.prepare('SELECT COUNT(*) as count FROM customers').first<{count: number}>() || {count: 0};
    const customer_code = `CUST-${String(count + 1).padStart(4, '0')}`;

    const { success } = await c.env.DB.prepare(`
      INSERT INTO customers (id, customer_code, name, phone, whatsapp_phone, address, area, pincode, route_id, assigned_partner_id, delivery_instructions, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, customer_code, data.name, data.phone, data.whatsapp_phone || null, data.address, data.area || null, data.pincode || null, data.route_id || null, data.assigned_partner_id || null, data.delivery_instructions || null, data.status || 'active', data.notes || null
    ).run();

    if (!success) return c.json({ error: 'Failed to create' }, 500);
    return c.json({ id, customer_code }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/:id', requireRole('owner', 'manager'), async (c) => {
  try {
    const id = c.req.param('id');
    const data = await c.req.json();
    
    const { success } = await c.env.DB.prepare(`
      UPDATE customers 
      SET name = ?, phone = ?, whatsapp_phone = ?, address = ?, area = ?, pincode = ?, route_id = ?, assigned_partner_id = ?, delivery_instructions = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      data.name, data.phone, data.whatsapp_phone || null, data.address, data.area || null, data.pincode || null, data.route_id || null, data.assigned_partner_id || null, data.delivery_instructions || null, data.status, data.notes || null, id
    ).run();

    if (!success) return c.json({ error: 'Failed to update' }, 500);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/:id/subscriptions', async (c) => {
  try {
    const id = c.req.param('id');
    const { results } = await c.env.DB.prepare(`
      SELECT s.*, p.name AS plan_name,
        (SELECT group_concat(pr.name, ', ')
          FROM subscription_items si
          JOIN products pr ON pr.id = si.product_id
          WHERE si.subscription_id = s.id) AS product_name,
        (SELECT SUM(si.quantity)
          FROM subscription_items si
          WHERE si.subscription_id = s.id) AS quantity
      FROM subscriptions s
      LEFT JOIN plan_templates p ON p.id = s.plan_template_id
      WHERE s.customer_id = ?
      ORDER BY s.created_at DESC
    `).bind(id).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/:id/deliveries', async (c) => {
  try {
    const id = c.req.param('id');
    const { results } = await c.env.DB.prepare('SELECT * FROM deliveries WHERE customer_id = ? ORDER BY delivery_date DESC LIMIT 50').bind(id).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/:id/changes', async (c) => {
  try {
    const id = c.req.param('id');
    const { results } = await c.env.DB.prepare('SELECT * FROM delivery_changes WHERE customer_id = ? ORDER BY created_at DESC').bind(id).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
