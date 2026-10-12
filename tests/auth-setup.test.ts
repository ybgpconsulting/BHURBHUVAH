import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { randomUUID } from 'node:crypto';
import { app } from '../src/server/index';
import { verifyPassword } from '../src/server/middleware/auth';
import { Env } from '../src/server/types';

const bootstrapSecret = randomUUID();
const sessionSecret = randomUUID();
let miniflare: Miniflare;
let db: D1Database;

async function setupRequest(
  body: Record<string, string>,
  configuredSecret: string | undefined = bootstrapSecret,
) {
  return app.request('http://localhost/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, {
    DB: db,
    APP_ENV: 'staging',
    SESSION_SECRET: sessionSecret,
    SETUP_SECRET: configuredSecret,
  } satisfies Env['Bindings']);
}

const ownerDetails = (email = 'owner@example.test') => ({
  name: 'Initial Owner',
  email,
  password: 'test-owner-password-with-length',
  setupSecret: bootstrapSecret,
});

describe('Initial Owner bootstrap security', () => {
  beforeAll(async () => {
    miniflare = new Miniflare({
      workers: [{
        config: {
          name: 'milk-delivery-setup-test',
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
            DB: { type: 'd1', name: 'milk-delivery-setup-test-db', id: 'milk-delivery-setup-test-db' },
          },
        },
      }],
    });
    db = await miniflare.getD1Database('DB');
    await db.prepare(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'manager', 'delivery_partner')),
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `).run();
  }, 30000);

  beforeEach(async () => {
    await db.prepare('DELETE FROM users').run();
  });

  afterAll(async () => {
    await miniflare?.dispose();
  });

  it('rejects missing, incorrect, and unconfigured bootstrap secrets without creating a user', async () => {
    const details = ownerDetails();
    const missing = {
      name: details.name,
      email: details.email,
      password: details.password,
    };

    expect((await setupRequest(missing)).status).toBe(401);
    expect((await setupRequest({ ...details, setupSecret: 'incorrect-secret' })).status).toBe(401);
    expect((await setupRequest(details, '')).status).toBe(503);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>())
      .toEqual({ count: 0 });
  });

  it('creates the first Owner and permanently rejects another setup attempt', async () => {
    const details = ownerDetails();
    const response = await setupRequest(details);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const owner = await db.prepare('SELECT email, name, role, password_hash FROM users').first<{
      email: string;
      name: string;
      role: string;
      password_hash: string;
    }>();
    if (!owner) throw new Error('Initial Owner was not created');
    expect(owner).toMatchObject({ email: details.email, name: details.name, role: 'owner' });
    expect(owner.password_hash).not.toBe(details.password);
    expect(await verifyPassword(details.password, owner.password_hash)).toBe(true);

    const repeated = await setupRequest(ownerDetails('second-owner@example.test'));
    expect(repeated.status).toBe(409);
    expect(await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>())
      .toEqual({ count: 1 });
  });

  it('creates only one Owner when bootstrap requests race concurrently', async () => {
    const responses = await Promise.all([
      setupRequest(ownerDetails('first-racing-owner@example.test')),
      setupRequest(ownerDetails('second-racing-owner@example.test')),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").first<{ count: number }>())
      .toEqual({ count: 1 });
  });

  it('keeps unknown API routes in JSON instead of returning an SPA document', async () => {
    const response = await app.request('http://localhost/api/does-not-exist', {}, {
      DB: db,
      APP_ENV: 'staging',
      SESSION_SECRET: sessionSecret,
      SETUP_SECRET: bootstrapSecret,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Not Found' });
  });
});
