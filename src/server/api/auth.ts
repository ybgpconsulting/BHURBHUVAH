import { Hono } from 'hono';
import { Env } from '../types';
import { hashPassword, verifyPassword, generateSessionId, getSessionKey, requireAuth } from '../middleware/auth';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const app = new Hono<Env>();

async function matchesSetupSecret(candidate: unknown, configured: string): Promise<boolean> {
  if (typeof candidate !== 'string' || candidate.length > 1024) return false;

  const encoder = new TextEncoder();
  const [candidateDigest, configuredDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(configured)),
  ]);
  const candidateBytes = new Uint8Array(candidateDigest);
  const configuredBytes = new Uint8Array(configuredDigest);
  let difference = 0;
  for (let i = 0; i < configuredBytes.length; i++) {
    difference |= candidateBytes[i] ^ configuredBytes[i];
  }
  return difference === 0;
}

app.post('/login', async (c) => {
  const data = await c.req.json<{ email?: string; password?: string }>();
  const email = data.email?.trim().toLowerCase();
  const password = data.password;
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);
  if (c.env.APP_ENV !== 'development' && !c.env.SESSION_SECRET) {
    return c.json({ error: 'Authentication is unavailable until SESSION_SECRET is configured' }, 503);
  }

  const ipAddress = c.req.header('CF-Connecting-IP') || 'local';
  const keyData = new TextEncoder().encode(`${email}\0${ipAddress}`);
  const keyDigest = await crypto.subtle.digest('SHA-256', keyData);
  const attemptKey = Array.from(new Uint8Array(keyDigest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cutoff).run();
  const attempts = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE attempt_key = ? AND attempted_at >= ?')
    .bind(attemptKey, cutoff).first<{ count: number }>();
  if ((attempts?.count || 0) >= 5) return c.json({ error: 'Too many login attempts. Try again later.' }, 429);

  const user = await c.env.DB.prepare('SELECT id, email, password_hash, name, role, is_active FROM users WHERE email = ?')
    .bind(email).first<{ id: string; email: string; password_hash: string; name: string; role: string; is_active: number }>();
  if (!user || !(await verifyPassword(password, user.password_hash)) || user.is_active === 0) {
    await c.env.DB.prepare('INSERT INTO login_attempts (id, attempt_key, attempted_at) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), attemptKey, new Date().toISOString()).run();
    return c.json({ error: 'Invalid credentials or inactive account' }, 401);
  }

  await c.env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').bind(attemptKey).run();
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sessionKey = await getSessionKey(sessionId, c.env.SESSION_SECRET);

  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sessionKey, user.id, expiresAt.toISOString())
    .run();

  setCookie(c, 'milk_session', sessionId, {
    httpOnly: true,
    secure: c.env.APP_ENV !== 'development',
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
    maxAge: 30 * 24 * 60 * 60,
  });

  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'milk_session');
  if (sessionId) {
    const sessionKey = await getSessionKey(sessionId, c.env.SESSION_SECRET);
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionKey).run();
  }
  deleteCookie(c, 'milk_session', { path: '/', secure: c.env.APP_ENV !== 'development', sameSite: 'Lax' });
  return c.json({ success: true });
});

app.get('/me', requireAuth, (c) => {
  return c.json({ user: c.get('user') });
});

app.post('/setup', async (c) => {
  if (c.env.APP_ENV !== 'development' && !c.env.SESSION_SECRET) {
    return c.json({ error: 'Authentication is unavailable until SESSION_SECRET is configured' }, 503);
  }
  if (!c.env.SETUP_SECRET) {
    return c.json({ error: 'Initial setup is unavailable until SETUP_SECRET is configured' }, 503);
  }

  const { email, password, name, setupSecret } = await c.req.json<{
    email?: string;
    password?: string;
    name?: string;
    setupSecret?: string;
  }>();
  if (!(await matchesSetupSecret(setupSecret, c.env.SETUP_SECRET))) {
    return c.json({ error: 'Invalid setup secret' }, 401);
  }

  const count = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  if (count && count.count > 0) {
    return c.json({ error: 'Setup already complete' }, 409);
  }

  if (!email?.trim() || !password || !name?.trim()) return c.json({ error: 'Missing fields' }, 400);
  if (password.length < 12) return c.json({ error: 'Password must be at least 12 characters' }, 400);

  const hash = await hashPassword(password);
  const id = crypto.randomUUID();

  const result = await c.env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, name, role)
    SELECT ?, ?, ?, ?, 'owner'
    WHERE NOT EXISTS (SELECT 1 FROM users)
  `).bind(id, email.trim().toLowerCase(), hash, name.trim()).run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Setup already complete' }, 409);
  }

  return c.json({ success: true });
});

export default app;
