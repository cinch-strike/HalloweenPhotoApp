import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export type Role = 'admin' | 'kiosk';

export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(passcode, salt, 32).toString('hex')}`;
}

export function verifyPasscode(passcode: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(passcode, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function issueToken(role: Role, ttlSeconds: number, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ role, exp: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function readToken(token: string | undefined, secret: string, now = Date.now()): Role | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { role, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof exp !== 'number' || exp * 1000 < now) return null;
    return role === 'admin' || role === 'kiosk' ? role : null;
  } catch {
    return null;
  }
}
