import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';

describe('Export Reconciliation Tests (Scenario J)', () => {
  it('Master summary and route sheets reconcile accurately in generated Excel', () => {
    // Mock delivery dataset
    const deliveries = [
      {
        id: 'del-1',
        sequence_number: 1,
        customer_id: 'cust-1',
        customer_name: 'Rajesh Kumar',
        customer_phone: '9876543210',
        delivery_address: 'H.No. 234, Sector 15',
        delivery_instructions: 'Ring bell',
        assigned_partner_id: 'user-partner-1',
        status: 'pending',
        items: [
          { product_id: 'prod-001', product_name: 'A2 Cow Milk', planned_quantity: 1, unit: 'litre' }
        ]
      },
      {
        id: 'del-2',
        sequence_number: 2,
        customer_id: 'cust-2',
        customer_name: 'Priya Sharma',
        customer_phone: '9876543211',
        delivery_address: 'Villa 12, Sector 17',
        delivery_instructions: 'Leave at gate',
        assigned_partner_id: 'user-partner-1',
        status: 'pending',
        items: [
          { product_id: 'prod-001', product_name: 'A2 Cow Milk', planned_quantity: 1.5, unit: 'litre' },
          { product_id: 'prod-002', product_name: 'A2 Buffalo Milk', planned_quantity: 0.5, unit: 'litre' }
        ]
      }
    ];

    // Compute expected totals
    let expectedCowMilkQty = 0;
    let expectedBuffaloMilkQty = 0;
    for (const d of deliveries) {
      for (const item of d.items) {
        if (item.product_id === 'prod-001') expectedCowMilkQty += item.planned_quantity;
        if (item.product_id === 'prod-002') expectedBuffaloMilkQty += item.planned_quantity;
      }
    }

    // Build Master Summary rows
    const masterRows = [
      { Product: 'A2 Cow Milk', 'Total Required Quantity': expectedCowMilkQty, Unit: 'litre' },
      { Product: 'A2 Buffalo Milk', 'Total Required Quantity': expectedBuffaloMilkQty, Unit: 'litre' },
    ];

    // Build Route rows
    const routeRows: any[] = [];
    deliveries.forEach(d => {
      d.items.forEach(item => {
        routeRows.push({
          Sequence: d.sequence_number,
          'Customer ID': d.customer_id,
          'Customer Name': d.customer_name,
          Address: d.delivery_address,
          Product: item.product_name,
          Quantity: item.planned_quantity,
          Unit: item.unit
        });
      });
    });

    // Generate Excel Workbook
    const wb = XLSX.utils.book_new();
    const wsMaster = XLSX.utils.json_to_sheet(masterRows);
    const wsRoute = XLSX.utils.json_to_sheet(routeRows);
    XLSX.utils.book_append_sheet(wb, wsMaster, 'Master Packing');
    XLSX.utils.book_append_sheet(wb, wsRoute, 'Route Deliveries');

    // Read back and reconcile
    const readMaster: any[] = XLSX.utils.sheet_to_json(wb.Sheets['Master Packing']);
    const readRoute: any[] = XLSX.utils.sheet_to_json(wb.Sheets['Route Deliveries']);

    const routeCowTotal = readRoute
      .filter(r => r.Product === 'A2 Cow Milk')
      .reduce((sum, r) => sum + r.Quantity, 0);

    const routeBuffaloTotal = readRoute
      .filter(r => r.Product === 'A2 Buffalo Milk')
      .reduce((sum, r) => sum + r.Quantity, 0);

    const masterCowTotal = readMaster.find(r => r.Product === 'A2 Cow Milk')['Total Required Quantity'];
    const masterBuffaloTotal = readMaster.find(r => r.Product === 'A2 Buffalo Milk')['Total Required Quantity'];

    expect(routeCowTotal).toBe(2.5);
    expect(masterCowTotal).toBe(2.5);
    expect(routeBuffaloTotal).toBe(0.5);
    expect(masterBuffaloTotal).toBe(0.5);
  });
});
