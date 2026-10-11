import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';
import { format, subDays, addDays, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

app.get('/metrics', async (c) => {
  try {
    const businessToday = parseISO(formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'));
    const fromDate = c.req.query('from') || format(subDays(businessToday, 30), 'yyyy-MM-dd');
    const toDate = c.req.query('to') || format(businessToday, 'yyyy-MM-dd');
    const today = format(businessToday, 'yyyy-MM-dd');
    const plus3Days = format(addDays(businessToday, 3), 'yyyy-MM-dd');
    const plus7Days = format(addDays(businessToday, 7), 'yyyy-MM-dd');

    // Deliveries
    const deliveriesStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as scheduled,
        SUM(CASE WHEN status IN ('completed', 'delivered') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed,
        SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM deliveries
      WHERE delivery_date >= ? AND delivery_date <= ?
        AND dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = deliveries.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
    `).bind(fromDate, toDate).first<any>() || { scheduled: 0, completed: 0, pending: 0, missed: 0, partial: 0, cancelled: 0 };

    const quantities = await c.env.DB.prepare(`
      SELECT 
        SUM(planned_quantity) as planned,
        SUM(actual_quantity) as actual
      FROM delivery_items di
      JOIN deliveries d ON di.delivery_id = d.id
      WHERE d.delivery_date >= ? AND d.delivery_date <= ?
        AND d.dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = d.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
    `).bind(fromDate, toDate).first<any>() || { planned: 0, actual: 0 };

    const deliveries = {
      scheduled: deliveriesStats.scheduled,
      completed: deliveriesStats.completed,
      pending: deliveriesStats.pending,
      missed: deliveriesStats.missed,
      partial: deliveriesStats.partial,
      cancelled: deliveriesStats.cancelled,
      planned_quantity: quantities.planned || 0,
      actual_quantity: quantities.actual || 0,
      completion_pct: deliveriesStats.scheduled > 0 ? (deliveriesStats.completed / deliveriesStats.scheduled) * 100 : 0
    };

    // Customers
    const totalCust = await c.env.DB.prepare('SELECT COUNT(*) as c FROM customers').first<{c: number}>();
    const activeCust = await c.env.DB.prepare("SELECT COUNT(*) as c FROM customers WHERE status = 'active'").first<{c: number}>();
    const inactiveCust = await c.env.DB.prepare("SELECT COUNT(*) as c FROM customers WHERE status = 'inactive'").first<{c: number}>();
    const activeSubscriptions = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active' AND start_date <= ? AND end_date >= ?")
      .bind(today, today).first<{c: number}>();
    const newCust = await c.env.DB.prepare('SELECT COUNT(*) as c FROM customers WHERE created_at >= ? AND created_at <= ?').bind(fromDate + ' 00:00:00', toDate + ' 23:59:59').first<{c: number}>();
    const expiringSoon = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active' AND end_date >= ? AND end_date <= ?").bind(today, plus7Days).first<{c: number}>();
    
    // Using renewed status for renewed_in_period
    const renewed = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'renewed' AND updated_at >= ? AND updated_at <= ?").bind(fromDate + ' 00:00:00', toDate + ' 23:59:59').first<{c: number}>();
    const expired = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'expired'").first<{c: number}>();
    const paused = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'paused'").first<{c: number}>();

    const customers = {
      total: totalCust?.c || 0,
      active: activeCust?.c || 0,
      active_subscriptions: activeSubscriptions?.c || 0,
      inactive: inactiveCust?.c || 0,
      paused: paused?.c || 0,
      new_in_period: newCust?.c || 0,
      new_signups: newCust?.c || 0,
      expiring_soon: expiringSoon?.c || 0,
      renewed_in_period: renewed?.c || 0,
      expired: expired?.c || 0
    };

    // Operations
    const activePartners = await c.env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'delivery_partner' AND is_active = 1").first<{c: number}>();
    const totalRoutes = await c.env.DB.prepare("SELECT COUNT(*) as c FROM routes WHERE is_active = 1").first<{c: number}>();
    const unassignedDels = await c.env.DB.prepare(`
      SELECT COUNT(*) as c FROM deliveries
      WHERE delivery_date >= ? AND delivery_date <= ? AND assigned_partner_id IS NULL
        AND dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = deliveries.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
    `).bind(fromDate, toDate).first<{c: number}>();
    const assignedDels = deliveries.scheduled - (unassignedDels?.c || 0);
    const pendingDisp = await c.env.DB.prepare("SELECT COUNT(*) as c FROM dispatch_runs WHERE status = 'draft' AND delivery_date >= ? AND delivery_date <= ?").bind(fromDate, toDate).first<{c: number}>();
    const exceptions = await c.env.DB.prepare(`
      SELECT COUNT(*) as c FROM deliveries
      WHERE delivery_date >= ? AND delivery_date <= ? AND exception_reason IS NOT NULL
        AND dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = deliveries.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
    `).bind(fromDate, toDate).first<{c: number}>();
    
    const expToday = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active' AND end_date = ?").bind(today).first<{c: number}>();
    const exp3Days = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active' AND end_date > ? AND end_date <= ?").bind(today, plus3Days).first<{c: number}>();
    const exp7Days = await c.env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active' AND end_date > ? AND end_date <= ?").bind(plus3Days, plus7Days).first<{c: number}>();
    
    const expiredFollowups = await c.env.DB.prepare("SELECT COUNT(*) as c FROM follow_up_tasks WHERE status = 'pending' AND task_type = 'expiry_reminder'").first<{c: number}>();
    const failedGenerations = await c.env.DB.prepare(`
      SELECT COUNT(*) AS c FROM dispatch_generation_runs
      WHERE status IN ('failed', 'needs_review') AND delivery_date >= ? AND delivery_date <= ?
    `).bind(today, plus7Days).first<{ c: number }>();

    const operations = {
      active_partners: activePartners?.c || 0,
      total_routes: totalRoutes?.c || 0,
      assigned_deliveries: assignedDels,
      unassigned_deliveries: unassignedDels?.c || 0,
      total_volume: deliveries.planned_quantity,
      pending_dispatches: pendingDisp?.c || 0,
      exceptions: exceptions?.c || 0,
      expiring_today: expToday?.c || 0,
      expiring_3_days: exp3Days?.c || 0,
      expiring_7_days: exp7Days?.c || 0,
      expired_followup: expiredFollowups?.c || 0,
      failed_generations: failedGenerations?.c || 0
    };

    // Product Breakdown
    const { results: pb } = await c.env.DB.prepare(`
      SELECT 
        di.product_id,
        di.product_name,
        SUM(di.planned_quantity) as planned_quantity,
        SUM(di.actual_quantity) as actual_quantity
      FROM delivery_items di
      JOIN deliveries d ON di.delivery_id = d.id
      WHERE d.delivery_date >= ? AND d.delivery_date <= ?
        AND d.dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = d.delivery_date
          ORDER BY current.revision DESC LIMIT 1
        )
      GROUP BY di.product_id, di.product_name
    `).bind(fromDate, toDate).all<any>();

    const product_breakdown = pb.map(p => ({
      product_id: p.product_id,
      product_name: p.product_name,
      planned_quantity: p.planned_quantity || 0,
      actual_quantity: p.actual_quantity || 0
    }));

    return c.json({ deliveries, customers, operations, product_breakdown });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/charts', async (c) => {
  try {
    const type = c.req.query('type');
    const businessToday = parseISO(formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'));
    const fromDate = c.req.query('from') || format(subDays(businessToday, 30), 'yyyy-MM-dd');
    const toDate = c.req.query('to') || format(businessToday, 'yyyy-MM-dd');
    let results = [];

    if (!type) {
      const [deliveryDays, plannedVsActual, productVolume, completionRate] = await Promise.all([
        c.env.DB.prepare(`
          SELECT delivery_date as date, COUNT(*) as scheduled,
            SUM(CASE WHEN status IN ('completed', 'delivered') THEN 1 ELSE 0 END) as completed
          FROM deliveries
          WHERE delivery_date >= ? AND delivery_date <= ?
            AND dispatch_run_id = (
              SELECT current.id FROM dispatch_runs current
              WHERE current.delivery_date = deliveries.delivery_date
              ORDER BY current.revision DESC LIMIT 1
            )
          GROUP BY delivery_date ORDER BY delivery_date
        `).bind(fromDate, toDate).all(),
        c.env.DB.prepare(`
          SELECT d.delivery_date as date, SUM(di.planned_quantity) as planned,
            SUM(di.actual_quantity) as actual
          FROM delivery_items di
          JOIN deliveries d ON di.delivery_id = d.id
          WHERE d.delivery_date >= ? AND d.delivery_date <= ?
            AND d.dispatch_run_id = (
              SELECT current.id FROM dispatch_runs current
              WHERE current.delivery_date = d.delivery_date
              ORDER BY current.revision DESC LIMIT 1
            )
          GROUP BY d.delivery_date ORDER BY d.delivery_date
        `).bind(fromDate, toDate).all(),
        c.env.DB.prepare(`
          SELECT product_name as product, SUM(planned_quantity) as volume
          FROM delivery_items di
          JOIN deliveries d ON di.delivery_id = d.id
          WHERE d.delivery_date >= ? AND d.delivery_date <= ?
            AND d.dispatch_run_id = (
              SELECT current.id FROM dispatch_runs current
              WHERE current.delivery_date = d.delivery_date
              ORDER BY current.revision DESC LIMIT 1
            )
          GROUP BY product_name
        `).bind(fromDate, toDate).all(),
        c.env.DB.prepare(`
          SELECT delivery_date as date,
            CASE WHEN COUNT(*) = 0 THEN 0
              ELSE SUM(CASE WHEN status IN ('completed', 'delivered') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
            END as rate
          FROM deliveries
          WHERE delivery_date >= ? AND delivery_date <= ?
            AND dispatch_run_id = (
              SELECT current.id FROM dispatch_runs current
              WHERE current.delivery_date = deliveries.delivery_date
              ORDER BY current.revision DESC LIMIT 1
            )
          GROUP BY delivery_date ORDER BY delivery_date
        `).bind(fromDate, toDate).all(),
      ]);
      return c.json({
        deliveriesByDay: deliveryDays.results,
        plannedVsActual: plannedVsActual.results,
        productVolume: productVolume.results,
        completionRate: completionRate.results,
      });
    } else if (type === 'deliveries_by_day') {
      const { results: data } = await c.env.DB.prepare(`
        SELECT delivery_date as date, COUNT(*) as value
        FROM deliveries
        WHERE delivery_date >= ? AND delivery_date <= ?
          AND dispatch_run_id = (
            SELECT current.id FROM dispatch_runs current
            WHERE current.delivery_date = deliveries.delivery_date
            ORDER BY current.revision DESC LIMIT 1
          )
        GROUP BY delivery_date
        ORDER BY delivery_date
      `).bind(fromDate, toDate).all();
      results = data;
    } else if (type === 'planned_vs_actual') {
      const { results: data } = await c.env.DB.prepare(`
        SELECT d.delivery_date as date, SUM(di.planned_quantity) as planned, SUM(di.actual_quantity) as actual
        FROM delivery_items di
        JOIN deliveries d ON di.delivery_id = d.id
        WHERE d.delivery_date >= ? AND d.delivery_date <= ?
          AND d.dispatch_run_id = (
            SELECT current.id FROM dispatch_runs current
            WHERE current.delivery_date = d.delivery_date
            ORDER BY current.revision DESC LIMIT 1
          )
        GROUP BY d.delivery_date
        ORDER BY d.delivery_date
      `).bind(fromDate, toDate).all();
      results = data;
    } else if (type === 'product_volume') {
      const { results: data } = await c.env.DB.prepare(`
        SELECT product_name as name, SUM(planned_quantity) as value
        FROM delivery_items di
        JOIN deliveries d ON di.delivery_id = d.id
        WHERE d.delivery_date >= ? AND d.delivery_date <= ?
          AND d.dispatch_run_id = (
            SELECT current.id FROM dispatch_runs current
            WHERE current.delivery_date = d.delivery_date
            ORDER BY current.revision DESC LIMIT 1
          )
        GROUP BY product_name
      `).bind(fromDate, toDate).all();
      results = data;
    } else if (type === 'customer_growth') {
      const { results: data } = await c.env.DB.prepare(`
        SELECT DATE(created_at) as date, COUNT(*) as value
        FROM customers
        WHERE DATE(created_at) >= ? AND DATE(created_at) <= ?
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
      `).bind(fromDate, toDate).all();
      results = data;
    } else if (type === 'completion_perf') {
      const { results: data } = await c.env.DB.prepare(`
        SELECT u.name, 
          SUM(CASE WHEN d.status IN ('completed', 'delivered') THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as perf
        FROM deliveries d
        JOIN users u ON d.assigned_partner_id = u.id
        WHERE d.delivery_date >= ? AND d.delivery_date <= ?
          AND d.dispatch_run_id = (
            SELECT current.id FROM dispatch_runs current
            WHERE current.delivery_date = d.delivery_date
            ORDER BY current.revision DESC LIMIT 1
          )
        GROUP BY u.id, u.name
      `).bind(fromDate, toDate).all();
      results = data;
    } else {
      return c.json({ error: 'Invalid chart type' }, 400);
    }

    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
