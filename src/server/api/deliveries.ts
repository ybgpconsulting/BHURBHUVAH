import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';
import { formatInTimeZone } from 'date-fns-tz';

const app = new Hono<Env>();

app.use('*', requireAuth);

app.get('/my', requireRole('delivery_partner', 'owner', 'manager'), async (c) => {
  try {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const date = c.req.query('date') || formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    const dispatch = await c.env.DB.prepare(`
      SELECT id, delivery_date, revision, status, locked_at FROM dispatch_runs
      WHERE delivery_date = ? AND status = 'locked' ORDER BY revision DESC LIMIT 1
    `).bind(date).first<any>();
    if (!dispatch) return c.json({ dispatch: null, deliveries: [], superseded_revisions: [] });
    const { results: deliveries } = await c.env.DB.prepare(`
      SELECT d.*
      FROM deliveries d
      WHERE d.dispatch_run_id = ? AND d.assigned_partner_id = ?
      ORDER BY d.sequence_number ASC
    `).bind(dispatch.id, user.id).all<any>();

    const deliveryIds = deliveries.map(d => d.id);
    let items: any[] = [];

    if (deliveryIds.length > 0) {
      const placeholders = deliveryIds.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(`
        SELECT * FROM delivery_items WHERE delivery_id IN (${placeholders})
      `).bind(...deliveryIds).all();
      items = results;
    }

    const { results: superseded } = await c.env.DB.prepare(`
      SELECT dr.id, dr.revision, dr.status, COUNT(d.id) AS assigned_deliveries
      FROM dispatch_runs dr
      JOIN deliveries d ON d.dispatch_run_id = dr.id
      WHERE dr.delivery_date = ? AND dr.status = 'revised' AND d.assigned_partner_id = ?
      GROUP BY dr.id, dr.revision, dr.status
      ORDER BY dr.revision DESC
    `).bind(date, user.id).all();
    return c.json({
      dispatch,
      superseded_revisions: superseded,
      deliveries: deliveries.map(d => ({
        ...d,
        status: d.status === 'delivered' ? 'completed' : d.status,
        phone: d.customer_phone,
        address: d.delivery_address,
        instructions: d.delivery_instructions,
        items: items.filter(i => i.delivery_id === d.id),
        products: items.filter(i => i.delivery_id === d.id).map(i => ({
          ...i,
          name: i.product_name,
          quantity: i.planned_quantity,
        })),
      })),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

const handleDeliveryStatus = async (c: any) => {
  try {
    const id = c.req.param('id');
    if (!id) return c.json({ error: 'Delivery ID is required' }, 400);
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    const { status: requestedStatus, exception_reason, reason, items: requestedItems, actual_qty } = await c.req.json() as {
      status?: string;
      exception_reason?: string;
      reason?: string;
      items?: Array<{ id: string; actual_quantity: number }>;
      actual_qty?: number;
    };
    const status = requestedStatus === 'delivered' ? 'completed' : requestedStatus;
    if (typeof status !== 'string' || !['completed', 'partial', 'missed'].includes(status)) {
      return c.json({ error: 'Invalid delivery status' }, 400);
    }

    const delivery = await c.env.DB.prepare(`
      SELECT d.assigned_partner_id, d.status, d.dispatch_run_id, dr.status AS dispatch_status
      FROM deliveries d JOIN dispatch_runs dr ON dr.id = d.dispatch_run_id WHERE d.id = ?
    `).bind(id).first() as {
      assigned_partner_id: string;
      status: string;
      dispatch_run_id: string;
      dispatch_status: string;
    } | null;
    if (!delivery) return c.json({ error: 'Not found' }, 404);

    if (delivery.assigned_partner_id !== user.id && user.role !== 'owner' && user.role !== 'manager') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (delivery.dispatch_status !== 'locked') return c.json({ error: 'Only published dispatch deliveries can be updated' }, 409);
    if (user.role === 'delivery_partner' && delivery.status !== 'pending') {
      return c.json({ error: 'Only pending deliveries can be updated by a delivery partner' }, 409);
    }

    const reasonText = exception_reason || reason;
    if ((status === 'missed' || status === 'partial') && !reasonText) {
      return c.json({ error: 'Exception reason required for missed/partial deliveries' }, 400);
    }

    const { results: deliveryItems } = await c.env.DB.prepare('SELECT id, planned_quantity FROM delivery_items WHERE delivery_id = ?')
      .bind(id).all();
    if (!deliveryItems.length) return c.json({ error: 'Delivery has no product items' }, 409);

    const deliveryTable = await c.env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deliveries'",
    ).first() as { sql: string } | null;
    const usesLegacyDeliveredStatus = Boolean(
      deliveryTable?.sql.includes("'delivered'") && !deliveryTable.sql.includes("'completed'"),
    );

    const suppliedItems = Array.isArray(requestedItems) ? requestedItems : null;
    if (status === 'partial' && !suppliedItems && (deliveryItems.length !== 1 || !Number.isFinite(actual_qty))) {
      return c.json({ error: 'Actual quantities are required for each product on a partial delivery' }, 400);
    }

    const now = new Date().toISOString();
    const itemStatements = [];
    for (let index = 0; index < deliveryItems.length; index++) {
      const deliveryItem = deliveryItems[index];
      const supplied = suppliedItems?.find((item: any) => item.id === deliveryItem.id);
      if (suppliedItems && !supplied) return c.json({ error: 'An actual quantity is missing for a delivery item' }, 400);
      const quantity = status === 'completed' ? deliveryItem.planned_quantity
        : status === 'missed' ? 0
          : Number(supplied ? supplied.actual_quantity : actual_qty);
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > deliveryItem.planned_quantity) {
        return c.json({ error: 'Actual quantity must be between zero and the planned quantity' }, 400);
      }
      const itemStatus = status === 'completed' || (status === 'partial' && quantity === deliveryItem.planned_quantity) ? 'delivered'
        : status === 'partial' && quantity === 0 ? 'missed'
          : status;
      itemStatements.push(c.env.DB.prepare(`
        UPDATE delivery_items SET status = ?, actual_quantity = ?, updated_at = ? WHERE id = ? AND delivery_id = ?
      `).bind(itemStatus, quantity, now, deliveryItem.id, id));
    }

    const updateDelivery = c.env.DB.prepare(`
      UPDATE deliveries SET status = ?, exception_reason = ?, completed_at = ?, completed_by = ?, updated_at = ?
      WHERE id = ? AND dispatch_run_id = ?
    `).bind(status === 'completed' && usesLegacyDeliveredStatus ? 'delivered' : status, reasonText || null, now, user.id, now, id, delivery.dispatch_run_id);
    await c.env.DB.batch([updateDelivery, ...itemStatements]);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
};

app.post('/:id/status', requireRole('delivery_partner', 'owner', 'manager'), handleDeliveryStatus);
app.put('/:id/status', requireRole('delivery_partner', 'owner', 'manager'), handleDeliveryStatus);

export default app;
