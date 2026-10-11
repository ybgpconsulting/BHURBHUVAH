import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { app, scheduled } from '../src/server/index';
import { getSessionKey, hashPassword } from '../src/server/middleware/auth';
import { getNextDeliveryDate, getUtcCronExpression } from '../src/server/dispatch-engine';
import { runDispatchGeneration } from '../src/server/dispatch-scheduler';
import * as XLSX from 'xlsx';

const sessionSecret = 'local-test-session-secret';
let miniflare: Miniflare;
let db: D1Database;
let ownerCookie: string;
let partnerOneCookie: string;
let partnerTwoCookie: string;
const env = (appEnv = 'development') => ({
  DB: db,
  APP_ENV: appEnv,
  SESSION_SECRET: appEnv === 'development' ? sessionSecret : undefined,
} as any);

async function request(path: string, init: RequestInit = {}, cookie?: string, appEnv = 'development') {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('Cookie', cookie);
  if (init.body) headers.set('Content-Type', 'application/json');
  return app.request(`http://localhost${path}`, { ...init, headers }, env(appEnv));
}

describe('Local Worker API and scheduled dispatch integration', () => {
  beforeAll(async () => {
    miniflare = new Miniflare({
      workers: [{
        config: {
          name: 'milk-delivery-test',
          compatibilityDate: '2025-01-01',
          manifest: {
            mainModule: 'index.mjs',
            modules: {
              'index.mjs': {
                type: 'esm',
                contents: 'export default { fetch() { return new Response("ok") } }',
              },
            },
          },
          env: {
            DB: { type: 'd1', name: 'milk-delivery-test-db', id: 'milk-delivery-test-db' },
          },
        },
      }],
    });
    db = await miniflare.getD1Database('DB');
    const initialSchema = (await readFile(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'))
      .replace(/^\s*--.*$/gm, '');
    const scheduledSchema = (await readFile(new URL('../migrations/0002_scheduled_dispatch.sql', import.meta.url), 'utf8'))
      .replace(/^\s*--.*$/gm, '');
    const renewalSchema = (await readFile(new URL('../migrations/0003_unique_subscription_renewal.sql', import.meta.url), 'utf8'))
      .replace(/^\s*--.*$/gm, '');
    for (const statement of initialSchema.split(';').map(sql => sql.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    for (const statement of scheduledSchema.split(';').map(sql => sql.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    for (const statement of renewalSchema.split(';').map(sql => sql.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }

    const passwordHash = await hashPassword('local-only-password-with-good-length');
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, name, role) VALUES ('owner', 'owner@example.test', ?, 'Owner', 'owner')")
        .bind(passwordHash),
      db.prepare("INSERT INTO users (id, email, password_hash, name, role) VALUES ('partner-1', 'one@example.test', ?, 'Partner One', 'delivery_partner')")
        .bind(passwordHash),
      db.prepare("INSERT INTO users (id, email, password_hash, name, role) VALUES ('partner-2', 'two@example.test', ?, 'Partner Two', 'delivery_partner')")
        .bind(passwordHash),
      db.prepare("INSERT INTO products (id, name, unit) VALUES ('milk', 'Milk', 'litre')"),
      db.prepare("INSERT INTO products (id, name, unit) VALUES ('buffalo-milk', 'Buffalo Milk', 'litre')"),
      db.prepare("INSERT INTO routes (id, name, assigned_partner_id) VALUES ('route-1', 'Route 1', 'partner-1')"),
      db.prepare("INSERT INTO routes (id, name, assigned_partner_id) VALUES ('route-2', 'Route 2', 'partner-2')"),
      db.prepare(`
        INSERT INTO customers (id, customer_code, name, phone, address, route_id)
        VALUES ('customer-1', 'C-1', 'Customer One', '111', 'Address One', 'route-1')
      `),
      db.prepare("INSERT INTO plan_templates (id, name, duration_days) VALUES ('plan', 'Plan', 10)"),
      db.prepare(`
        INSERT INTO subscriptions (id, customer_id, plan_template_id, start_date, end_date, delivery_days)
        VALUES ('sub-1', 'customer-1', 'plan', '2026-10-12', '2026-10-20', '1,2,3,4,5,6,7')
      `),
      db.prepare("INSERT INTO subscription_items (id, subscription_id, product_id, quantity) VALUES ('item-1', 'sub-1', 'milk', 1.5)"),
    ]);

    for (const [id, userId] of [['owner-session', 'owner'], ['partner-one-session', 'partner-1'], ['partner-two-session', 'partner-2']]) {
      await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(await getSessionKey(id, sessionSecret), userId, '2099-01-01T00:00:00.000Z').run();
    }
    ownerCookie = 'milk_session=owner-session';
    partnerOneCookie = 'milk_session=partner-one-session';
    partnerTwoCookie = 'milk_session=partner-two-session';
  }, 30000);

  afterAll(async () => {
    await miniflare?.dispose();
  });

  it('converts the configurable IST schedule and date boundary correctly', () => {
    expect(getUtcCronExpression('20:00')).toBe('30 14 * * *');
    expect(getUtcCronExpression('00:15')).toBe('45 18 * * *');
    expect(getNextDeliveryDate(new Date('2026-10-11T18:29:00.000Z'))).toBe('2026-10-12');
    expect(getNextDeliveryDate(new Date('2026-10-11T18:30:00.000Z'))).toBe('2026-10-13');
  });

  it('rejects unauthenticated and cross-role requests', async () => {
    expect((await request('/api/customers')).status).toBe(401);
    expect((await request('/api/customers', {}, partnerOneCookie)).status).toBe(403);
    expect((await request('/api/users', {}, partnerOneCookie)).status).toBe(403);
  });

  it('refuses non-development authentication without the HMAC session secret', async () => {
    expect((await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.test', password: 'local-only-password-with-good-length' }),
    }, undefined, 'staging')).status).toBe(503);
    expect((await request('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ name: 'Staging Owner', email: 'staging@example.test', password: 'local-only-password-with-good-length' }),
    }, undefined, 'staging')).status).toBe(503);
  });

  it('returns dashboard chart and customer list data in the shapes consumed by the UI', async () => {
    const chartsResponse = await request('/api/dashboard/charts?from=2026-10-12&to=2026-10-12', {}, ownerCookie);
    expect(chartsResponse.status).toBe(200);
    expect(Object.keys(await chartsResponse.json() as object)).toEqual([
      'deliveriesByDay', 'plannedVsActual', 'productVolume', 'completionRate',
    ]);

    const customersResponse = await request('/api/customers?page=1&pageSize=10', {}, ownerCookie);
    const customers = await customersResponse.json() as any;
    expect(customersResponse.status).toBe(200);
    expect(customers.data[0].customer_code).toBeDefined();
    expect(customers.pageSize).toBe(10);

    const createCustomerResponse = await request('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Customer Created In Test',
        phone: '333',
        address: 'Address Three',
        route_id: 'route-1',
      }),
    }, ownerCookie);
    expect(createCustomerResponse.status).toBe(201);
    const createdCustomer = await createCustomerResponse.json() as any;
    const editCustomerResponse = await request(`/api/customers/${createdCustomer.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Customer Edited In Test',
        phone: '333',
        address: 'Edited Address',
        area: 'Edited Area',
        route_id: 'route-2',
        status: 'active',
      }),
    }, ownerCookie);
    expect(editCustomerResponse.status).toBe(200);
    const editedCustomer = await db.prepare('SELECT name, address, area, route_id FROM customers WHERE id = ?')
      .bind(createdCustomer.id).first<any>();
    expect(editedCustomer).toMatchObject({
      name: 'Customer Edited In Test',
      address: 'Edited Address',
      area: 'Edited Area',
      route_id: 'route-2',
    });

    const subscriptionsResponse = await request('/api/subscriptions', {}, ownerCookie);
    const subscriptions = await subscriptionsResponse.json() as any[];
    expect(subscriptions[0].customer_name).toBe('Customer One');
    expect(subscriptions[0].product_name).toBe('Milk');
    const customerSubscriptions = await request('/api/customers/customer-1/subscriptions', {}, ownerCookie);
    const customerSubscriptionList = await customerSubscriptions.json() as any[];
    expect(customerSubscriptionList[0].plan_name).toBeDefined();
    expect(customerSubscriptionList[0].quantity).toBe(1.5);

    await db.prepare(`
      INSERT INTO follow_up_tasks
        (id, customer_id, subscription_id, task_type, status, created_by)
      VALUES ('renewal-task', 'customer-1', 'sub-1', 'expiry_reminder', 'pending', 'owner')
    `).run();
    const followupsResponse = await request('/api/followups?days=10', {}, ownerCookie);
    const followups = await followupsResponse.json() as any[];
    expect(followupsResponse.status).toBe(200);
    expect(followups[0].customer_name).toBe('Customer One');
    expect(followups[0].plan_name).toBeDefined();
    expect(followups[0].days_left).toBeGreaterThan(0);

    const updateResponse = await request('/api/followups/renewal-task', {
      method: 'PUT',
      body: JSON.stringify({ action: 'mark_contacted' }),
    }, ownerCookie);
    expect(updateResponse.status).toBe(200);
    const updated = await db.prepare("SELECT status, last_contact_date FROM follow_up_tasks WHERE id = 'renewal-task'").first<any>();
    expect(updated.status).toBe('contacted');
    expect(updated.last_contact_date).toBeDefined();
    const renewalFollowup = await request('/api/followups/renewal-task', {
      method: 'PUT',
      body: JSON.stringify({ action: 'record_renewal' }),
    }, ownerCookie);
    expect(renewalFollowup.status).toBe(200);
    const renewalFollowupResult = await renewalFollowup.json() as any;
    expect(renewalFollowupResult.renewal_id).toBeDefined();
    expect((await db.prepare("SELECT status FROM follow_up_tasks WHERE id = 'renewal-task'")
      .first<any>()).status).toBe('renewed');
  });

  it('edits subscription products by effective date without changing historical deliveries', async () => {
    const customerId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    await db.batch([
      db.prepare(`
        INSERT INTO customers (id, customer_code, name, phone, address, route_id)
        VALUES (?, ?, 'Edit Customer', '444', 'Edit Address', 'route-1')
      `).bind(customerId, customerId),
      db.prepare(`
        INSERT INTO subscriptions (id, customer_id, plan_template_id, start_date, end_date, delivery_days)
        VALUES (?, ?, 'plan', '2026-10-20', '2026-10-30', '1,2,3,4,5,6,7')
      `).bind(subscriptionId, customerId),
      db.prepare('INSERT INTO subscription_items (id, subscription_id, product_id, quantity) VALUES (?, ?, ?, 1.5)')
        .bind(crypto.randomUUID(), subscriptionId, 'milk'),
    ]);

    const beforeResponse = await request('/api/dispatch/generate', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-23' }),
    }, ownerCookie);
    expect(beforeResponse.status).toBe(200);
    const before = await beforeResponse.json() as any;
    const historicalDelivery = before.deliveries.find((delivery: any) => delivery.subscription_id === subscriptionId);
    expect(historicalDelivery).toBeDefined();

    const firstEdit = await request(`/api/subscriptions/${subscriptionId}`, {
      method: 'PUT',
      body: JSON.stringify({
        effective_date: '2026-10-24',
        items: [{ product_id: 'buffalo-milk', quantity: 2 }],
      }),
    }, ownerCookie);
    expect(firstEdit.status).toBe(200);

    const secondEdit = await request(`/api/subscriptions/${subscriptionId}`, {
      method: 'PUT',
      body: JSON.stringify({
        effective_date: '2026-10-24',
        items: [{ product_id: 'milk', quantity: 3 }],
      }),
    }, ownerCookie);
    expect(secondEdit.status).toBe(200);

    const afterResponse = await request('/api/dispatch/generate', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-24' }),
    }, ownerCookie);
    expect(afterResponse.status).toBe(200);
    const after = await afterResponse.json() as any;
    const futureDelivery = after.deliveries.find((delivery: any) => delivery.subscription_id === subscriptionId);
    expect(futureDelivery.items).toHaveLength(1);
    expect(futureDelivery.items[0]).toMatchObject({ product_id: 'milk', planned_quantity: 3 });

    const historicItem = await db.prepare(
      'SELECT product_id, planned_quantity FROM delivery_items WHERE delivery_id = ?',
    ).bind(historicalDelivery.id).first<any>();
    expect(historicItem).toMatchObject({ product_id: 'milk', planned_quantity: 1.5 });

    const pause = await request(`/api/subscriptions/${subscriptionId}/pause`, {
      method: 'POST',
      body: JSON.stringify({ effective_date: '2026-10-25', end_date: '2026-10-26' }),
    }, ownerCookie);
    expect(pause.status).toBe(200);
    const pausedDispatch = await request('/api/dispatch/generate', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-25' }),
    }, ownerCookie);
    expect((await pausedDispatch.json() as any).deliveries.some(
      (delivery: any) => delivery.subscription_id === subscriptionId,
    )).toBe(false);

    const resume = await request(`/api/subscriptions/${subscriptionId}/resume`, {
      method: 'POST',
      body: JSON.stringify({ effective_date: '2026-10-27' }),
    }, ownerCookie);
    expect(resume.status).toBe(200);
    const resumedDispatch = await request('/api/dispatch/generate', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-27' }),
    }, ownerCookie);
    const resumed = await resumedDispatch.json() as any;
    expect(resumed.deliveries.find((delivery: any) => delivery.subscription_id === subscriptionId).items[0])
      .toMatchObject({ product_id: 'milk', planned_quantity: 3 });

    const renewals = await Promise.all([
      request(`/api/subscriptions/${subscriptionId}/renew`, { method: 'POST' }, ownerCookie),
      request(`/api/subscriptions/${subscriptionId}/renew`, { method: 'POST' }, ownerCookie),
    ]);
    expect(renewals.map(response => response.status).sort()).toEqual([200, 201]);
    const renewalResults = await Promise.all(renewals.map(response => response.json() as Promise<any>));
    expect(renewalResults[0].id).toBe(renewalResults[1].id);
    const renewal = renewalResults.find(result => !result.already_renewed);
    expect(renewal).toBeDefined();
    expect(renewal.start_date).toBe('2026-10-31');
    const renewedItems = await db.prepare(
      'SELECT product_id, quantity FROM subscription_items WHERE subscription_id = ?',
    ).bind(renewal.id).all<any>();
    expect(renewedItems.results).toEqual([{ product_id: 'milk', quantity: 3 }]);
    const repeatedRenewal = await request(`/api/subscriptions/${subscriptionId}/renew`, { method: 'POST' }, ownerCookie);
    expect(repeatedRenewal.status).toBe(200);
    expect((await repeatedRenewal.json() as any).id).toBe(renewal.id);
  }, 30000);

  it('runs the scheduled handler in local D1 at the configured IST daily schedule and is idempotent', async () => {
    const expiredSubscriptionId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO subscriptions (id, customer_id, plan_template_id, start_date, end_date)
      VALUES (?, 'customer-1', 'plan', '2026-10-01', '2026-10-10')
    `).bind(expiredSubscriptionId).run();
    const waits: Promise<unknown>[] = [];
    const executionContext = { waitUntil: (promise: Promise<unknown>) => waits.push(promise) } as ExecutionContext;
    const controller = { scheduledTime: Date.parse('2026-10-11T14:30:00.000Z'), cron: '30 14 * * *' } as ScheduledController;
    await scheduled(controller, { DB: db, DISPATCH_AUTO_PUBLISH: 'false' }, executionContext);
    await Promise.all(waits);

    const generation = await db.prepare('SELECT delivery_date, status, result_json FROM dispatch_generation_runs').first<any>();
    expect(generation.delivery_date).toBe('2026-10-12');
    expect(generation.status).toBe('succeeded');
    expect((await db.prepare('SELECT status FROM subscriptions WHERE id = ?')
      .bind(expiredSubscriptionId).first<any>()).status).toBe('expired');
    const result = JSON.parse(generation.result_json);
    const run = await db.prepare('SELECT status FROM dispatch_runs WHERE id = ?').bind(result.dispatch_run_id).first<any>();
    expect(run.status).toBe('draft');

    const secondWaits: Promise<unknown>[] = [];
    await scheduled(controller, { DB: db, DISPATCH_AUTO_PUBLISH: 'false' }, {
      waitUntil: (promise: Promise<unknown>) => secondWaits.push(promise),
    } as ExecutionContext);
    await Promise.all(secondWaits);
    const count = await db.prepare('SELECT COUNT(*) AS count FROM deliveries WHERE dispatch_run_id = ?').bind(result.dispatch_run_id).first<any>();
    expect(count.count).toBe(1);
  });

  it('generates through the API, publishes only after review, and exposes assignments only to the assigned partner', async () => {
    const generatedResponse = await request('/api/dispatch/generate', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-13' }),
    }, ownerCookie);
    expect(generatedResponse.status).toBe(200);
    const generated = await generatedResponse.json() as any;

    const unassigned = await db.prepare("INSERT INTO routes (id, name) VALUES ('route-no-partner', 'No Partner')").run();
    expect(unassigned.success).toBe(true);
    const customerId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    await db.batch([
      db.prepare(`
        INSERT INTO customers (id, customer_code, name, phone, address, route_id)
        VALUES (?, ?, 'Customer Two', '222', 'Address Two', 'route-no-partner')
      `).bind(customerId, customerId),
      db.prepare(`
        INSERT INTO subscriptions (id, customer_id, plan_template_id, start_date, end_date, delivery_days)
        VALUES (?, ?, 'plan', '2026-10-13', '2026-10-20', '1,2,3,4,5,6,7')
      `).bind(subscriptionId, customerId),
      db.prepare('INSERT INTO subscription_items (id, subscription_id, product_id, quantity) VALUES (?, ?, ?, 2)')
        .bind(crypto.randomUUID(), subscriptionId, 'milk'),
    ]);
    const regenerated = await request('/api/dispatch/generate', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-10-13' }),
    }, ownerCookie);
    expect(regenerated.status).toBe(200);
    const detail = await regenerated.json() as any;
    const unassignedDelivery = detail.deliveries.find((delivery: any) => delivery.customer_id === customerId);
    expect(unassignedDelivery).toBeDefined();

    const invalidPublish = await request(`/api/dispatch/${generated.id}/lock`, { method: 'POST' }, ownerCookie);
    expect(invalidPublish.status).toBe(400);
    expect((await db.prepare('SELECT status FROM dispatch_runs WHERE id = ?').bind(generated.id).first<any>()).status).toBe('draft');

    await request(`/api/dispatch/${generated.id}/deliveries/${unassignedDelivery.id}/assignment`, {
      method: 'PUT',
      body: JSON.stringify({ route_id: 'route-2', assigned_partner_id: 'partner-2' }),
    }, ownerCookie);
    const published = await request(`/api/dispatch/${generated.id}/lock`, { method: 'POST' }, ownerCookie);
    expect(published.status).toBe(200);
    const lockedSubscriptionEdit = await request('/api/subscriptions/sub-1', {
      method: 'PUT',
      body: JSON.stringify({
        effective_date: '2026-10-13',
        items: [{ product_id: 'milk', quantity: 2 }],
      }),
    }, ownerCookie);
    expect(lockedSubscriptionEdit.status).toBe(409);

    const partnerOne = await request('/api/deliveries/my?date=2026-10-13', {}, partnerOneCookie);
    const partnerTwo = await request('/api/deliveries/my?date=2026-10-13', {}, partnerTwoCookie);
    const partnerOneData = await partnerOne.json() as any;
    const partnerTwoData = await partnerTwo.json() as any;
    expect(partnerOneData.deliveries.every((delivery: any) => delivery.assigned_partner_id === 'partner-1')).toBe(true);
    expect(partnerTwoData.deliveries.some((delivery: any) => delivery.customer_id === customerId)).toBe(true);

    const anotherDelivery = detail.deliveries.find((delivery: any) => delivery.assigned_partner_id === 'partner-1');
    const forbiddenUpdate = await request(`/api/deliveries/${anotherDelivery.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'completed' }),
    }, partnerTwoCookie);
    expect(forbiddenUpdate.status).toBe(403);

    const ownDelivery = partnerOneData.deliveries[0];
    const partial = await request(`/api/deliveries/${ownDelivery.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'partial',
        reason: 'Container was short',
        items: [{ id: ownDelivery.products[0].id, actual_quantity: 1 }],
      }),
    }, partnerOneCookie);
    expect(partial.status).toBe(200);
    expect((await db.prepare('SELECT status, actual_quantity FROM delivery_items WHERE id = ?')
      .bind(ownDelivery.products[0].id).first<any>()).actual_quantity).toBe(1);

    const completedDelivery = partnerTwoData.deliveries[0];
    const completed = await request(`/api/deliveries/${completedDelivery.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'completed' }),
    }, partnerTwoCookie);
    expect(completed.status).toBe(200);
    expect((await db.prepare('SELECT status FROM deliveries WHERE id = ?')
      .bind(completedDelivery.id).first<any>()).status).toBe('completed');
    expect((await db.prepare('SELECT status FROM delivery_items WHERE delivery_id = ?')
      .bind(completedDelivery.id).first<any>()).status).toBe('delivered');

    const revise = await request(`/api/dispatch/${generated.id}/revise`, { method: 'POST' }, ownerCookie);
    expect(revise.status).toBe(201);

    const metricsResponse = await request('/api/dashboard/metrics?from=2026-10-12&to=2026-10-13', {}, ownerCookie);
    const metrics = await metricsResponse.json() as any;
    const directTotals = await db.prepare(`
      SELECT COUNT(DISTINCT d.id) AS scheduled, SUM(CASE WHEN d.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        COALESCE(SUM(di.planned_quantity), 0) AS planned, COALESCE(SUM(di.actual_quantity), 0) AS actual
      FROM deliveries d JOIN dispatch_runs r ON r.id = d.dispatch_run_id
      LEFT JOIN delivery_items di ON di.delivery_id = d.id
      WHERE d.delivery_date BETWEEN ? AND ?
        AND d.dispatch_run_id = (
          SELECT current.id FROM dispatch_runs current
          WHERE current.delivery_date = d.delivery_date ORDER BY current.revision DESC LIMIT 1
        )
    `).bind('2026-10-12', '2026-10-13').first<any>();
    expect(metrics.deliveries.scheduled).toBe(directTotals.scheduled);
    expect(metrics.deliveries.completed).toBe(directTotals.completed);
    expect(metrics.deliveries.planned_quantity).toBe(directTotals.planned);
    expect(metrics.deliveries.actual_quantity).toBe(directTotals.actual);

    const xlsxResponse = await request(`/api/exports/packing-sheet/${generated.id}`, {}, ownerCookie);
    expect(xlsxResponse.status).toBe(200);
    expect(xlsxResponse.headers.get('content-type')).toContain('spreadsheetml');
    const workbook = XLSX.read(await xlsxResponse.arrayBuffer(), { type: 'array' });
    const packingRows = XLSX.utils.sheet_to_json(workbook.Sheets['Master Packing Sheet']) as any[];
    const exportedMilk = packingRows.find((row: any) => row.Product === 'Milk');
    const databaseMilk = await db.prepare(`
      SELECT COALESCE(SUM(di.planned_quantity), 0) AS quantity
      FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
      WHERE d.dispatch_run_id = ? AND di.product_name = 'Milk'
    `).bind(generated.id).first<any>();
    expect(exportedMilk['Total Required Quantity']).toBe(databaseMilk.quantity);

    const routeXlsxResponse = await request(
      `/api/exports/route-sheet/${generated.id}?route_id=route-1`,
      {},
      ownerCookie,
    );
    expect(routeXlsxResponse.status).toBe(200);
    const routeWorkbook = XLSX.read(await routeXlsxResponse.arrayBuffer(), { type: 'array' });
    const routeRows = XLSX.utils.sheet_to_json(routeWorkbook.Sheets['Route Delivery Sheet']) as any[];
    expect(routeRows.length).toBeGreaterThan(0);
    expect(routeRows.every((row: any) => row.Route === 'Route 1')).toBe(true);

    const pdfResponse = await request(`/api/exports/packing-pdf/${generated.id}`, {}, ownerCookie);
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers.get('content-type')).toContain('application/pdf');
    expect((await pdfResponse.arrayBuffer()).byteLength).toBeGreaterThan(100);

    const routePdfResponse = await request(
      `/api/exports/packing-pdf/${generated.id}?route_id=route-1`,
      {},
      ownerCookie,
    );
    expect(routePdfResponse.status).toBe(200);
    expect(routePdfResponse.headers.get('content-type')).toContain('application/pdf');
    expect((await routePdfResponse.arrayBuffer()).byteLength).toBeGreaterThan(100);
  }, 30000);

  it('records failed generations and permits a safe manual retry', async () => {
    const deliveryDate = '2026-10-21';
    const customerId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    await db.batch([
      db.prepare(`
        INSERT INTO customers (id, customer_code, name, phone, address, route_id)
        VALUES (?, ?, 'Retry Customer', '333', 'Address Three', 'route-1')
      `).bind(customerId, customerId),
      db.prepare(`
        INSERT INTO subscriptions (id, customer_id, plan_template_id, start_date, end_date)
        VALUES (?, ?, 'plan', ?, ?)
      `).bind(subscriptionId, customerId, deliveryDate, deliveryDate),
      db.prepare('INSERT INTO subscription_items (id, subscription_id, product_id, quantity) VALUES (?, ?, ?, 1)')
        .bind(crypto.randomUUID(), subscriptionId, 'milk'),
      db.prepare("UPDATE users SET is_active = 0 WHERE id = 'owner'"),
    ]);

    await expect(runDispatchGeneration(db, new Date('2026-10-20T14:30:00.000Z'), 'cron', deliveryDate)).rejects.toThrow();
    expect((await db.prepare('SELECT status FROM dispatch_generation_runs WHERE delivery_date = ?')
      .bind(deliveryDate).first<any>()).status).toBe('failed');
    await db.prepare("UPDATE users SET is_active = 1 WHERE id = 'owner'").run();

    const retry = await runDispatchGeneration(db, new Date(), 'manual_retry', deliveryDate);
    expect(retry.status).toBe('succeeded');
    const repeated = await runDispatchGeneration(db, new Date(), 'cron', deliveryDate);
    expect(repeated.skipped).toBe(true);
    expect((await db.prepare(`
      SELECT COUNT(*) AS count FROM deliveries WHERE dispatch_run_id = ? AND subscription_id = ?
    `).bind(retry.result.dispatch_run_id, subscriptionId).first<any>()).count).toBe(1);
  });

  it('uses secure cookie attributes and rejects cross-origin mutation requests', async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@example.test', password: 'local-only-password-with-good-length' }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    expect(login.headers.get('set-cookie')).toContain('SameSite=Lax');
    const crossOrigin = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    }, ownerCookie);
    expect(crossOrigin.status).toBe(403);
  });
});
