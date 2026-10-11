import { Hono } from 'hono';
import { Env } from '../types';
import { requireAuth, requireRole } from '../middleware/auth';
import * as xlsx from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable/es';
import { format } from 'date-fns';

const app = new Hono<Env>();

app.use('*', requireAuth);
app.use('*', requireRole('owner', 'manager'));

async function getDispatchExportData(db: D1Database, id: string, routeId?: string, partnerId?: string) {
  const run = await db.prepare('SELECT * FROM dispatch_runs WHERE id = ?').bind(id).first<any>();
  if (!run) return null;

  let delQuery = `
    SELECT d.*, c.customer_code, r.name as route_name, u.name as partner_name
    FROM deliveries d
    JOIN customers c ON d.customer_id = c.id
    LEFT JOIN routes r ON d.route_id = r.id
    LEFT JOIN users u ON d.assigned_partner_id = u.id
    WHERE d.dispatch_run_id = ?
  `;
  const params: any[] = [id];
  if (routeId) {
    delQuery += ' AND d.route_id = ?';
    params.push(routeId);
  }
  if (partnerId) {
    delQuery += ' AND d.assigned_partner_id = ?';
    params.push(partnerId);
  }
  delQuery += ' ORDER BY d.route_id, d.sequence_number, c.customer_code';

  const { results: deliveries } = await db.prepare(delQuery).bind(...params).all<any>();
  const { results: items } = await db.prepare(`
    SELECT di.* 
    FROM delivery_items di 
    JOIN deliveries d ON di.delivery_id = d.id 
    WHERE d.dispatch_run_id = ?
  `).bind(id).all<any>();

  return { run, deliveries, items };
}

function buildWorkbook(run: any, deliveries: any[], items: any[]) {
  const wb = xlsx.utils.book_new();

  // Master Packing Sheet
  const productStats: Record<string, { qty: number; lines: number; unit: string }> = {};
  for (const d of deliveries) {
    const dItems = items.filter((i: any) => i.delivery_id === d.id);
    for (const item of dItems) {
      if (!productStats[item.product_name]) {
        productStats[item.product_name] = { qty: 0, lines: 0, unit: item.unit || 'litre' };
      }
      productStats[item.product_name].qty += item.planned_quantity;
      productStats[item.product_name].lines += 1;
    }
  }

  const packingData = Object.keys(productStats).map(p => ({
    'Dispatch Date': run.delivery_date,
    'Product': p,
    'Total Required Quantity': productStats[p].qty,
    'Unit': productStats[p].unit,
    'Total Scheduled Line Items': productStats[p].lines,
  }));
  const wsPacking = xlsx.utils.json_to_sheet(packingData.length ? packingData : [{ Note: 'No items' }]);
  xlsx.utils.book_append_sheet(wb, wsPacking, 'Master Packing Sheet');

  // Route Delivery Sheet
  const routeData: any[] = [];
  let seq = 1;
  for (const d of deliveries) {
    const dItems = items.filter((i: any) => i.delivery_id === d.id);
    for (const item of dItems) {
      routeData.push({
        'Sequence Number': d.sequence_number || seq++,
        'Customer ID': d.customer_code,
        'Customer Name': d.customer_name,
        'Phone Number': d.customer_phone || '',
        'Delivery Address': d.delivery_address,
        'Route': d.route_name || 'Unassigned',
        'Product': item.product_name,
        'Quantity': item.planned_quantity,
        'Unit': item.unit || 'litre',
        'Delivery Instructions': d.delivery_instructions || '',
        'Assigned Delivery Partner': d.partner_name || 'Unassigned',
        'Delivery Status': d.status,
        'Actual Delivered Quantity': item.actual_quantity ?? '',
        'Exception Notes': d.exception_reason || d.notes || '',
      });
    }
  }

  const wsRoute = xlsx.utils.json_to_sheet(routeData.length ? routeData : [{ Note: 'No deliveries' }]);
  xlsx.utils.book_append_sheet(wb, wsRoute, 'Route Delivery Sheet');

  return wb;
}

const handleXlsxExport = async (c: any) => {
  try {
    const id = c.req.param('id') || c.req.param('dispatch_run_id');
    const routeId = c.req.query('route_id');
    const partnerId = c.req.query('partner_id');

    const data = await getDispatchExportData(c.env.DB, id, routeId, partnerId);
    if (!data) return c.json({ error: 'Not found' }, 404);

    const wb = buildWorkbook(data.run, data.deliveries, data.items);
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
    const filename = `Dispatch_${data.run.delivery_date}_${timestamp}.xlsx`;

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
};

app.get('/dispatch/:id', handleXlsxExport);
app.get('/packing-sheet/:dispatch_run_id', handleXlsxExport);
app.get('/route-sheet/:dispatch_run_id', handleXlsxExport);
app.get('/partner-sheet/:dispatch_run_id', handleXlsxExport);

app.get('/packing-pdf/:dispatch_run_id', async (c) => {
  try {
    const id = c.req.param('dispatch_run_id');
    const routeId = c.req.query('route_id');
    const data = await getDispatchExportData(c.env.DB, id, routeId);
    if (!data) return c.json({ error: 'Not found' }, 404);

    const doc = new jsPDF();
    doc.setFontSize(16);
    const routeName = routeId ? data.deliveries[0]?.route_name || 'Route' : null;
    doc.text(`Daily Dispatch Sheet - ${data.run.delivery_date}${routeName ? ` - ${routeName}` : ''}`, 14, 18);
    doc.setFontSize(10);
    doc.text(`Status: ${data.run.status.toUpperCase()} | Generated: ${new Date().toISOString()}`, 14, 25);

    const rows: any[] = [];
    let seq = 1;
    for (const d of data.deliveries) {
      const dItems = data.items.filter((i: any) => i.delivery_id === d.id);
      for (const item of dItems) {
        rows.push([
          d.sequence_number || seq++,
          d.customer_code,
          d.customer_name,
          d.route_name || '-',
          item.product_name,
          `${item.planned_quantity} ${item.unit}`,
          d.partner_name || 'Unassigned',
          d.status,
        ]);
      }
    }

    autoTable(doc, {
      startY: 30,
      head: [['#', 'Code', 'Customer', 'Route', 'Product', 'Qty', 'Partner', 'Status']],
      body: rows,
    });

    const pdfBuffer = doc.output('arraybuffer');
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Dispatch_${data.run.delivery_date}${routeId ? `_route_${routeId}` : ''}.pdf"`,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default app;
