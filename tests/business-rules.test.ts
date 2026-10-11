import { describe, it, expect, beforeEach } from 'vitest';
import { parseISO, getDay, addDays, format } from 'date-fns';

describe('Business Rules and Delivery Generation Logic', () => {
  // Mock products
  const products = [
    { id: 'prod-001', name: 'A2 Cow Milk', unit: 'litre' },
    { id: 'prod-002', name: 'A2 Buffalo Milk', unit: 'litre' },
  ];

  // Helper simulating the core dispatch generation engine
  function simulateDispatch({
    date,
    subscriptions,
    subscriptionItems,
    changes,
  }: {
    date: string;
    subscriptions: any[];
    subscriptionItems: any[];
    changes: any[];
  }) {
    const parsedDate = parseISO(date);
    let jsDay = getDay(parsedDate);
    const isoDay = jsDay === 0 ? 7 : jsDay;

    // Filter active & valid date subscriptions
    const validSubs = subscriptions.filter(sub => {
      if (sub.status !== 'active') return false;
      if (sub.start_date > date || sub.end_date < date) return false;
      const days = sub.delivery_days.split(',').map(Number);
      return days.includes(isoDay);
    });

    const approvedChanges = changes.filter(c => c.status === 'approved');
    const skipChanges = approvedChanges.filter(c => c.change_type === 'skip' && c.effective_date === date);
    const pauseChanges = approvedChanges.filter(c => c.change_type === 'pause');
    const qtyChanges = approvedChanges.filter(c => c.change_type === 'quantity_change');
    const prodChanges = approvedChanges.filter(c => c.change_type === 'product_change');
    const oneTimeAdds = approvedChanges.filter(c => c.change_type === 'one_time_add' && c.effective_date === date);

    const generatedDeliveries: any[] = [];

    for (const sub of validSubs) {
      // Rule 4: Single day skip check
      if (skipChanges.some(c => c.subscription_id === sub.id)) continue;
      // Rule 3: Pause check
      if (pauseChanges.some(c => c.subscription_id === sub.id && c.effective_date <= date && (!c.end_date || c.end_date >= date))) continue;

      const items = subscriptionItems.filter(si => si.subscription_id === sub.id);
      const deliveryItems = items.map(item => {
        let finalProductId = item.product_id;
        let finalQty = item.quantity;

        // Rule 5: Quantity change
        const specificQtyChange = qtyChanges.find(c => c.subscription_id === sub.id && c.product_id === item.product_id && c.effective_date <= date);
        if (specificQtyChange) finalQty = specificQtyChange.new_quantity;

        // Rule 6: Product change
        const specificProdChange = prodChanges.find(c => c.subscription_id === sub.id && c.effective_date <= date);
        if (specificProdChange) {
          finalProductId = specificProdChange.new_product_id;
          finalQty = specificProdChange.new_quantity || finalQty;
        }

        const prod = products.find(p => p.id === finalProductId);
        return {
          productId: finalProductId,
          productName: prod?.name,
          quantity: finalQty,
        };
      });

      generatedDeliveries.push({
        customerId: sub.customer_id,
        subscriptionId: sub.id,
        date,
        items: deliveryItems,
      });
    }

    // Process one time adds
    for (const add of oneTimeAdds) {
      const prod = products.find(p => p.id === add.product_id);
      generatedDeliveries.push({
        customerId: add.customer_id,
        subscriptionId: null,
        date,
        isExtra: true,
        items: [{
          productId: add.product_id,
          productName: prod?.name,
          quantity: add.new_quantity,
        }]
      });
    }

    return generatedDeliveries;
  }

  it('Scenario A: Normal recurring delivery - generates correct quantity for active plan', () => {
    const subs = [{
      id: 'sub-1',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-10',
      delivery_days: '1,2,3,4,5,6,7',
    }];
    const items = [{
      subscription_id: 'sub-1',
      product_id: 'prod-001',
      quantity: 1.0,
    }];

    const deliveries = simulateDispatch({
      date: '2026-10-05',
      subscriptions: subs,
      subscriptionItems: items,
      changes: [],
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].items[0].quantity).toBe(1.0);
    expect(deliveries[0].items[0].productId).toBe('prod-001');
  });

  it('generates independent deliveries for overlapping subscriptions belonging to one customer', () => {
    const subscriptions = [
      {
        id: 'sub-cow',
        customer_id: 'cust-shared',
        status: 'active',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        delivery_days: '1,2,3,4,5,6,7',
      },
      {
        id: 'sub-buffalo',
        customer_id: 'cust-shared',
        status: 'active',
        start_date: '2026-10-05',
        end_date: '2026-10-20',
        delivery_days: '1,2,3,4,5,6,7',
      },
    ];
    const deliveries = simulateDispatch({
      date: '2026-10-12',
      subscriptions,
      subscriptionItems: [
        { subscription_id: 'sub-cow', product_id: 'prod-001', quantity: 1 },
        { subscription_id: 'sub-buffalo', product_id: 'prod-002', quantity: 0.5 },
      ],
      changes: [],
    });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map(delivery => delivery.items[0].productId).sort()).toEqual(['prod-001', 'prod-002']);
  });

  it('respects a subscription delivery-weekday schedule', () => {
    const subscription = [{
      id: 'sub-weekdays',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-31',
      delivery_days: '1,3,5',
    }];
    const items = [{ subscription_id: 'sub-weekdays', product_id: 'prod-001', quantity: 1 }];
    expect(simulateDispatch({
      date: '2026-10-06',
      subscriptions: subscription,
      subscriptionItems: items,
      changes: [],
    })).toHaveLength(0);
    expect(simulateDispatch({
      date: '2026-10-07',
      subscriptions: subscription,
      subscriptionItems: items,
      changes: [],
    })).toHaveLength(1);
  });

  it('Scenario B: Skip tomorrow - skips selected date without affecting others', () => {
    const subs = [{
      id: 'sub-1',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-10',
      delivery_days: '1,2,3,4,5,6,7',
    }];
    const items = [{
      subscription_id: 'sub-1',
      product_id: 'prod-001',
      quantity: 1.0,
    }];
    const changes = [{
      id: 'chg-skip',
      subscription_id: 'sub-1',
      change_type: 'skip',
      effective_date: '2026-10-06',
      status: 'approved',
    }];

    // On 2026-10-06 it should be skipped
    const dayOfSkip = simulateDispatch({
      date: '2026-10-06',
      subscriptions: subs,
      subscriptionItems: items,
      changes,
    });
    expect(dayOfSkip).toHaveLength(0);

    // On 2026-10-07 it should deliver normally
    const dayAfter = simulateDispatch({
      date: '2026-10-07',
      subscriptions: subs,
      subscriptionItems: items,
      changes,
    });
    expect(dayAfter).toHaveLength(1);
    expect(dayAfter[0].items[0].quantity).toBe(1.0);
  });

  it('Scenario C: Quantity change effective tomorrow - updates future deliveries while keeping past unchanged', () => {
    const subs = [{
      id: 'sub-1',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-10',
      delivery_days: '1,2,3,4,5,6,7',
    }];
    const items = [{
      subscription_id: 'sub-1',
      product_id: 'prod-001',
      quantity: 1.0,
    }];
    const changes = [{
      id: 'chg-qty',
      subscription_id: 'sub-1',
      product_id: 'prod-001',
      change_type: 'quantity_change',
      effective_date: '2026-10-06',
      new_quantity: 2.0,
      status: 'approved',
    }];

    const beforeEffective = simulateDispatch({
      date: '2026-10-05',
      subscriptions: subs,
      subscriptionItems: items,
      changes,
    });
    expect(beforeEffective[0].items[0].quantity).toBe(1.0);

    const afterEffective = simulateDispatch({
      date: '2026-10-06',
      subscriptions: subs,
      subscriptionItems: items,
      changes,
    });
    expect(afterEffective[0].items[0].quantity).toBe(2.0);
  });

  it('Scenario D: Product change effective tomorrow - changes product to buffalo milk', () => {
    const subs = [{
      id: 'sub-1',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-10',
      delivery_days: '1,2,3,4,5,6,7',
    }];
    const items = [{
      subscription_id: 'sub-1',
      product_id: 'prod-001',
      quantity: 1.0,
    }];
    const changes = [{
      id: 'chg-prod',
      subscription_id: 'sub-1',
      change_type: 'product_change',
      effective_date: '2026-10-06',
      new_product_id: 'prod-002',
      new_quantity: 1.5,
      status: 'approved',
    }];

    const onDate = simulateDispatch({
      date: '2026-10-06',
      subscriptions: subs,
      subscriptionItems: items,
      changes,
    });
    expect(onDate[0].items[0].productId).toBe('prod-002');
    expect(onDate[0].items[0].productName).toBe('A2 Buffalo Milk');
    expect(onDate[0].items[0].quantity).toBe(1.5);
  });

  it('Scenario E: Pause and resume - excludes pause date range', () => {
    const subs = [{
      id: 'sub-1',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-15',
      delivery_days: '1,2,3,4,5,6,7',
    }];
    const items = [{
      subscription_id: 'sub-1',
      product_id: 'prod-001',
      quantity: 1.0,
    }];
    const changes = [{
      id: 'chg-pause',
      subscription_id: 'sub-1',
      change_type: 'pause',
      effective_date: '2026-10-05',
      end_date: '2026-10-07',
      status: 'approved',
    }];

    // Paused days
    expect(simulateDispatch({ date: '2026-10-05', subscriptions: subs, subscriptionItems: items, changes })).toHaveLength(0);
    expect(simulateDispatch({ date: '2026-10-06', subscriptions: subs, subscriptionItems: items, changes })).toHaveLength(0);
    expect(simulateDispatch({ date: '2026-10-07', subscriptions: subs, subscriptionItems: items, changes })).toHaveLength(0);

    // Resumed day
    const resumed = simulateDispatch({ date: '2026-10-08', subscriptions: subs, subscriptionItems: items, changes });
    expect(resumed).toHaveLength(1);
    expect(resumed[0].items[0].quantity).toBe(1.0);
  });

  it('Scenario F: Expiry - deliveries cease after end_date', () => {
    const subs = [{
      id: 'sub-1',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-10',
      delivery_days: '1,2,3,4,5,6,7',
    }];
    const items = [{
      subscription_id: 'sub-1',
      product_id: 'prod-001',
      quantity: 1.0,
    }];

    // Final day
    expect(simulateDispatch({ date: '2026-10-10', subscriptions: subs, subscriptionItems: items, changes: [] })).toHaveLength(1);
    // Day after expiry
    expect(simulateDispatch({ date: '2026-10-11', subscriptions: subs, subscriptionItems: items, changes: [] })).toHaveLength(0);
  });

  it('Scenario G: Multiple products for same customer - independent correct line items', () => {
    const subs = [{
      id: 'sub-1',
      customer_id: 'cust-1',
      status: 'active',
      start_date: '2026-10-01',
      end_date: '2026-10-15',
      delivery_days: '1,2,3,4,5,6,7',
    }];
    const items = [
      { subscription_id: 'sub-1', product_id: 'prod-001', quantity: 2.0 },
      { subscription_id: 'sub-1', product_id: 'prod-002', quantity: 1.0 },
    ];

    const deliveries = simulateDispatch({
      date: '2026-10-08',
      subscriptions: subs,
      subscriptionItems: items,
      changes: [],
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].items).toHaveLength(2);
    expect(deliveries[0].items[0].quantity).toBe(2.0);
    expect(deliveries[0].items[1].quantity).toBe(1.0);
  });
});
