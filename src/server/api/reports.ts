import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';

const app = new Hono<Env>();

app.use('*', requireAuth, requireRole('owner', 'manager'));

app.get('/delivery-summary', async (c) => {
  try {
    const { from, to, route_id, partner_id } = c.req.query();
    let query = `
      SELECT d.id, d.delivery_date, d.status, c.name as customer_name, r.name as route_name
      FROM deliveries d
      JOIN customers c ON d.customer_id = c.id
      LEFT JOIN routes r ON d.route_id = r.id
      WHERE d.delivery_date >= ? AND d.delivery_date <= ?
        AND d.dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = d.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
    `;
    const params: any[] = [from, to];

    if (route_id) {
      query += ' AND d.route_id = ?';
      params.push(route_id);
    }
    if (partner_id) {
      query += ' AND d.assigned_partner_id = ?';
      params.push(partner_id);
    }

    const { results } = await c.env.DB.prepare(query).bind(...params).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/product-dispatch', async (c) => {
  try {
    const { from, to } = c.req.query();
    const { results } = await c.env.DB.prepare(`
      SELECT p.name, SUM(di.planned_quantity) as planned, SUM(di.actual_quantity) as actual
      FROM delivery_items di
      JOIN deliveries d ON di.delivery_id = d.id
      JOIN products p ON di.product_id = p.id
      WHERE d.delivery_date >= ? AND d.delivery_date <= ?
        AND d.dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = d.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
      GROUP BY p.id, p.name
    `).bind(from, to).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/partner-performance', async (c) => {
  try {
    const { from, to } = c.req.query();
    const { results } = await c.env.DB.prepare(`
      SELECT u.name, COUNT(d.id) as total_assigned, 
             SUM(CASE WHEN d.status IN ('completed', 'delivered') THEN 1 ELSE 0 END) as completed
      FROM deliveries d
      JOIN users u ON d.assigned_partner_id = u.id
      WHERE d.delivery_date >= ? AND d.delivery_date <= ?
        AND d.dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = d.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
      GROUP BY u.id, u.name
    `).bind(from, to).all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
