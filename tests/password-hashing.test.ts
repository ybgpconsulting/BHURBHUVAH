import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/server/middleware/auth';

const password = 'correct-horse-battery-staple';

describe('PBKDF2 password hashing', () => {
  it('creates the existing PBKDF2-SHA256 format with 310,000 iterations and verifies it', async () => {
    const hash = await hashPassword(password);

    expect(hash).toMatch(/^pbkdf2-sha256\$310000\$[a-f\d]{32}\$[a-f\d]{64}$/i);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('incorrect-password', hash)).toBe(false);
  });

  it('uses a fresh cryptographically random salt for each hash', async () => {
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);
    const firstSalt = firstHash.split('$')[2];
    const secondSalt = secondHash.split('$')[2];

    expect(firstSalt).toMatch(/^[a-f\d]{32}$/i);
    expect(secondSalt).toMatch(/^[a-f\d]{32}$/i);
    expect(secondSalt).not.toBe(firstSalt);
    expect(secondHash.split('$')[3]).not.toBe(firstHash.split('$')[3]);
  });

  it('verifies the legacy 100,000-iteration salt:hash format', async () => {
    const legacySalt = '00112233445566778899aabbccddeeff';
    const legacyHash = 'pbkdf2-sha256$100000$00112233445566778899aabbccddeeff$'
      + '0000000000000000000000000000000000000000000000000000000000000000';
    const { pbkdf2 } = await import('node:crypto');
    const expected = await new Promise<Buffer>((resolve, reject) => {
      pbkdf2(password, Buffer.from(legacySalt, 'hex'), 100000, 32, 'sha256', (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });

    expect(await verifyPassword(password, `${legacySalt}:${expected.toString('hex')}`)).toBe(true);
    expect(await verifyPassword(password, legacyHash)).toBe(false);
  });

  it('rejects malformed and unsupported stored hashes without deriving a key', async () => {
    for (const hash of [
      '',
      'pbkdf2-sha256$310000$short$not-a-hash',
      'pbkdf2-sha256$100000$00112233445566778899aabbccddeeff$'
        + '0000000000000000000000000000000000000000000000000000000000000000',
      'pbkdf2-sha256$999999999999999999$00112233445566778899aabbccddeeff$'
        + '0000000000000000000000000000000000000000000000000000000000000000',
      '00112233445566778899aabbccddeeff',
      '00112233445566778899aabbccddeeff:abcd',
      '00112233445566778899aabbccddeeff:'
        + '0000000000000000000000000000000000000000000000000000000000000000:extra',
    ]) {
      await expect(verifyPassword(password, hash)).resolves.toBe(false);
    }
  });
});
