import { randomBytes, timingSafeEqual } from 'node:crypto';

export const STATE_COOKIE = 'larvis_google_oauth_state';
const COOKIE_PATH = '/api/google';
const MAX_AGE_SECONDS = 600;

export function newState(): string {
  return randomBytes(32).toString('base64url');
}

export function cookieIsSecure(redirectUri: string): boolean {
  return !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(redirectUri);
}

export function stateCookie(value: string, secure: boolean): string {
  return `${STATE_COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearStateCookie(secure: boolean): string {
  return `${STATE_COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function checkState(
  cookieHeader: string | string[] | undefined,
  queryState: unknown,
): 'ok' | 'missing' | 'mismatch' {
  const expected = readCookie(cookieHeader, STATE_COOKIE);
  if (typeof queryState !== 'string' || !queryState || !expected) return 'missing';
  const a = Buffer.from(queryState);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'mismatch';
}
