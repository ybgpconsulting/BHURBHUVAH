import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';
import { generateDispatch, publishDispatch } from '../dispatch-engine';
import { runDispatchGeneration } from '../dispatch-scheduler';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

app.post('/generate', requireRole('owner', 'manager'), async (c) => {
  try {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const { date } = await c.req.json<{ date: string }>();
    const generated = await generateDispatch(c.env.DB, date, user.id);
    const run = await c.env.DB.prepare('SELECT * FROM dispatch_runs WHERE id = ?').bind(generated.dispatchRunId).first<any>();
    return c.json({
      ...(await buildRichDispatchResponse(c.env.DB, run)),
      dispatch_run_id: generated.dispatchRunId,
      generated_count: generated.generatedCount,
      success: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dispatch generation failed';
    return c.json({ error: message }, /valid delivery date|already published/.test(message) ? 400 : 500);
  }
});

app.get('/generation-runs', requireRole('owner', 'manager'), async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM dispatch_generation_runs ORDER BY started_at DESC LIMIT 100
  `).all();
  return c.json(results);
});

app.post('/generation-runs/:date/retry', requireRole('owner', 'manager'), async (c) => {
  try {
    const result = await runDispatchGeneration(c.env.DB, new Date(), 'manual_retry', c.req.param('date'), c.env.DISPATCH_AUTO_PUBLISH === 'true');
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Generation retry failed' }, 400);
  }
});

app.get('/assignment-options', requireRole('owner', 'manager'), async (c) => {
  const [routes, partners] = await Promise.all([
    c.env.DB.prepare('SELECT id, name FROM routes WHERE is_active = 1 ORDER BY sort_order, name').all(),
    c.env.DB.prepare("SELECT id, name FROM users WHERE role = 'delivery_partner' AND is_active = 1 ORDER BY name").all(),
  ]);
  return c.json({ routes: routes.results, partners: partners.results });
});
async function buildRichDispatchResponse(db: D1Database, run: any) {
  const { results: deliveries } = await db.prepare(`
    SELECT d.*, r.name as route_name, u.name as partner_name
    FROM deliveries d
    LEFT JOIN routes r ON d.route_id = r.id
    LEFT JOIN users u ON d.assigned_partner_id = u.id
    WHERE d.dispatch_run_id = ?
  `).bind(run.id).all<any>();

  const { results: items } = await db.prepare(`
    SELECT di.* 
    FROM delivery_items di 
    JOIN deliveries d ON di.delivery_id = d.id 
    WHERE d.dispatch_run_id = ?
  `).bind(run.id).all<any>();

  const { results: routeSummary } = await db.prepare(`
    SELECT r.id as id, COALESCE(r.name, 'Unassigned') as name, COUNT(DISTINCT d.id) as stops, COALESCE(SUM(di.planned_quantity), 0) as volume
    FROM deliveries d
    LEFT JOIN routes r ON d.route_id = r.id
    LEFT JOIN delivery_items di ON d.id = di.delivery_id
    WHERE d.dispatch_run_id = ?
    GROUP BY r.id, r.name
  `).bind(run.id).all<any>();

  const { results: partnerSummary } = await db.prepare(`
    SELECT COALESCE(u.name, 'Unassigned') as name, COALESCE(r.name, 'Multiple/None') as route, COUNT(DISTINCT d.id) as stops
    FROM deliveries d
    LEFT JOIN users u ON d.assigned_partner_id = u.id
    LEFT JOIN routes r ON d.route_id = r.id
    WHERE d.dispatch_run_id = ?
    GROUP BY u.id, u.name
  `).bind(run.id).all<any>();

  const enrichedDeliveries = deliveries.map((d: any) => {
    const dItems = items.filter((i: any) => i.delivery_id === d.id);
    return {
      ...d,
      address: d.delivery_address,
      product_name: dItems.map((i: any) => i.product_name).join(', '),
      quantity: dItems.reduce((acc: number, i: any) => acc + i.planned_quantity, 0),
      items: dItems,
    };
  });

  return {
    ...run,
    summary: {
      totalOrders: run.total_orders || deliveries.length,
      totalVolume: run.total_quantity || items.reduce((acc: number, i: any) => acc + i.planned_quantity, 0),
      totalRoutes: routeSummary.length,
    },
    routes: routeSummary,
    partners: partnerSummary,
    deliveries: enrichedDeliveries,
    items,
  };
}

app.get('/', async (c) => {
  try {
    const date = c.req.query('date');
    if (date) {
      const run = await c.env.DB.prepare('SELECT * FROM dispatch_runs WHERE delivery_date = ? ORDER BY revision DESC LIMIT 1').bind(date).first<any>();
      if (!run) return c.json({ error: 'No dispatch data' }, 404);
      return c.json(await buildRichDispatchResponse(c.env.DB, run));
    }
    const { results } = await c.env.DB.prepare('SELECT * FROM dispatch_runs ORDER BY delivery_date DESC').all();
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const run = await c.env.DB.prepare('SELECT * FROM dispatch_runs WHERE id = ?').bind(id).first<any>();
    if (!run) return c.json({ error: 'Not found' }, 404);
    return c.json(await buildRichDispatchResponse(c.env.DB, run));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

const handleLockDispatch = async (c: any) => {
  try {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const id = c.req.param('id');
    await publishDispatch(c.env.DB, id, user.id);
    const run = await c.env.DB.prepare('SELECT * FROM dispatch_runs WHERE id = ?').bind(id).first();
    return c.json({ ...(run ? await buildRichDispatchResponse(c.env.DB, run) : {}), success: true });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : 'Failed to publish dispatch';
    return c.json({ error: message }, message.includes('validation errors') || message.includes('not a draft') ? 400 : 500);
  }
};

app.post('/:id/lock', requireRole('owner', 'manager'), handleLockDispatch);
app.put('/:id/lock', requireRole('owner', 'manager'), handleLockDispatch);

app.post('/:id/revise', requireRole('owner', 'manager'), async (c) => {
  try {
    const oldRun = await c.env.DB.prepare("SELECT * FROM dispatch_runs WHERE id = ? AND status = 'locked'")
      .bind(c.req.param('id')).first<any>();
    if (!oldRun) return c.json({ error: 'Only a published dispatch can be revised' }, 400);
    const { results: deliveries } = await c.env.DB.prepare('SELECT * FROM deliveries WHERE dispatch_run_id = ?')
      .bind(oldRun.id).all<any>();
    const { results: items } = await c.env.DB.prepare(`
      SELECT di.* FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE d.dispatch_run_id = ?
    `).bind(oldRun.id).all<any>();
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const newRunId = crypto.randomUUID();
    const revision = oldRun.revision + 1;
    const deliveryIds = new Map<string, string>();
    const statements = [
      c.env.DB.prepare(`
        INSERT INTO dispatch_runs (id, delivery_date, status, revision, total_orders, total_quantity, generated_by, revision_of)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)
      `).bind(newRunId, oldRun.delivery_date, revision, oldRun.total_orders, oldRun.total_quantity, user.id, oldRun.id),
    ];

    for (const delivery of deliveries) {
      const id = crypto.randomUUID();
      deliveryIds.set(delivery.id, id);
      statements.push(c.env.DB.prepare(`
        INSERT INTO deliveries
          (id, dispatch_run_id, customer_id, subscription_id, source_change_id, route_id, assigned_partner_id,
           delivery_date, sequence_number, customer_name, customer_phone, delivery_address, delivery_instructions,
           status, is_extra)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).bind(id, newRunId, delivery.customer_id, delivery.subscription_id, delivery.source_change_id,
        delivery.route_id, delivery.assigned_partner_id, delivery.delivery_date, delivery.sequence_number,
        delivery.customer_name, delivery.customer_phone, delivery.delivery_address, delivery.delivery_instructions,
        delivery.is_extra));
    }
    for (const item of items) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO delivery_items (id, delivery_id, product_id, product_name, planned_quantity, unit, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).bind(crypto.randomUUID(), deliveryIds.get(item.delivery_id), item.product_id, item.product_name,
        item.planned_quantity, item.unit));
    }
    await c.env.DB.batch(statements);
    return c.json(await buildRichDispatchResponse(c.env.DB, {
      ...oldRun,
      id: newRunId,
      status: 'draft',
      revision,
      revision_of: oldRun.id,
      generated_by: user.id,
    }), 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to create dispatch revision' }, 500);
  }
});

app.put('/:id/deliveries/:deliveryId/assignment', requireRole('owner', 'manager'), async (c) => {
  try {
    const { route_id: routeId, assigned_partner_id: partnerId } = await c.req.json<{ route_id: string; assigned_partner_id: string }>();
    if (!routeId || !partnerId) return c.json({ error: 'Route and delivery partner are required' }, 400);
    const runId = c.req.param('id');
    const deliveryId = c.req.param('deliveryId');
    const [run, route, partner, delivery] = await Promise.all([
      c.env.DB.prepare("SELECT revision_of FROM dispatch_runs WHERE id = ? AND status = 'draft'").bind(runId).first<{ revision_of: string | null }>(),
      c.env.DB.prepare('SELECT id FROM routes WHERE id = ? AND is_active = 1').bind(routeId).first(),
      c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'delivery_partner' AND is_active = 1").bind(partnerId).first(),
      c.env.DB.prepare('SELECT id FROM deliveries WHERE id = ? AND dispatch_run_id = ?').bind(deliveryId, runId).first(),
    ]);
    if (!run || !delivery) return c.json({ error: 'Draft dispatch or delivery not found' }, 404);
    if (!route || !partner) return c.json({ error: 'Selected route or delivery partner is unavailable' }, 400);

    await c.env.DB.prepare(`
      UPDATE deliveries SET route_id = ?, assigned_partner_id = ?, changed_after_publish = ?, updated_at = ?
      WHERE id = ? AND dispatch_run_id = ?
    `).bind(routeId, partnerId, run.revision_of ? 1 : 0, new Date().toISOString(), deliveryId, runId).run();
    return c.json({ success: true, affected: Boolean(run.revision_of) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to update assignment' }, 500);
  }
});

app.get('/:id/summary', async (c) => {
  try {
    const id = c.req.param('id');
    const { results: productSummary } = await c.env.DB.prepare(`
      SELECT di.product_name as name, SUM(di.planned_quantity) as total_qty
      FROM delivery_items di
      JOIN deliveries d ON di.delivery_id = d.id
      WHERE d.dispatch_run_id = ?
      GROUP BY di.product_id, di.product_name
    `).bind(id).all();

    const { results: routeSummary } = await c.env.DB.prepare(`
      SELECT r.name, COUNT(d.id) as delivery_count
      FROM deliveries d
      LEFT JOIN routes r ON d.route_id = r.id
      WHERE d.dispatch_run_id = ?
      GROUP BY r.id, r.name
    `).bind(id).all();

    const { results: partnerSummary } = await c.env.DB.prepare(`
      SELECT u.name, COUNT(d.id) as delivery_count
      FROM deliveries d
      LEFT JOIN users u ON d.assigned_partner_id = u.id
      WHERE d.dispatch_run_id = ?
      GROUP BY u.id, u.name
    `).bind(id).all();

    return c.json({ productSummary, routeSummary, partnerSummary });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
