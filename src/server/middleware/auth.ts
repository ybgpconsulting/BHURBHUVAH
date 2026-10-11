import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { Env } from '../types';

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 310000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2-sha256$310000$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [algorithm, iterationText, saltHex, expectedHex] = hash.startsWith('pbkdf2-sha256$')
    ? hash.split('$')
    : ['legacy', '100000', ...hash.split(':')];
  const iterations = Number(iterationText);
  if (!saltHex || !expectedHex || !Number.isInteger(iterations) || iterations < 100000
    || !/^(?:[a-f\d]{2}){16}$/i.test(saltHex) || !/^(?:[a-f\d]{2}){32}$/i.test(expectedHex)) return false;
  if (algorithm !== 'legacy' && algorithm !== 'pbkdf2-sha256') return false;

  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  const actual = new Uint8Array(derivedBits);
  const expected = new Uint8Array(expectedHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    difference |= (actual[i] || 0) ^ (expected[i] || 0);
  }
  return difference === 0;
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export async function getSessionKey(sessionId: string, secret?: string): Promise<string> {
  if (!secret) return sessionId;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionId));
  return Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const authMiddleware = async (c: Context<Env>, next: Next) => {
  const sessionId = getCookie(c, 'milk_session');
  
  if (sessionId) {
    const sessionKey = await getSessionKey(sessionId, c.env.SESSION_SECRET);
    const session = await c.env.DB.prepare(
      'SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1'
    ).bind(sessionKey, new Date().toISOString()).first<{ id: string; email: string; name: string; role: string }>();
    c.set('user', session || null);
  } else {
    c.set('user', null);
  }
  
  await next();
};

export const requireAuth = async (c: Context<Env>, next: Next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
};

export const requireRole = (...roles: string[]) => {
  return async (c: Context<Env>, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
};
