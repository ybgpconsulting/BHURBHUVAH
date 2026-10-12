import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { Env } from '../types';

const PASSWORD_HASH_ITERATIONS = 310000;
const LEGACY_PASSWORD_HASH_ITERATIONS = 100000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
}

function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, PASSWORD_HASH_BYTES, 'sha256', (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(new Uint8Array(derivedKey));
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(randomBytes(PASSWORD_SALT_BYTES));
  const derivedKey = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);
  return `pbkdf2-sha256$${PASSWORD_HASH_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(derivedKey)}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  let iterations: number;
  let saltHex: string;
  let expectedHex: string;

  if (hash.startsWith('pbkdf2-sha256$')) {
    const parts = hash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256'
      || parts[1] !== String(PASSWORD_HASH_ITERATIONS)) return false;
    iterations = PASSWORD_HASH_ITERATIONS;
    [, , saltHex, expectedHex] = parts;
  } else {
    const parts = hash.split(':');
    if (parts.length !== 2) return false;
    iterations = LEGACY_PASSWORD_HASH_ITERATIONS;
    [saltHex, expectedHex] = parts;
  }

  if (!/^(?:[a-f\d]{2}){16}$/i.test(saltHex)
    || !/^(?:[a-f\d]{2}){32}$/i.test(expectedHex)) return false;

  const [salt, expected] = [hexToBytes(saltHex), hexToBytes(expectedHex)];
  const actual = await derivePasswordHash(password, salt, iterations);
  return timingSafeEqual(actual, expected);
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
