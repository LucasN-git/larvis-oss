import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE_COOKIE, checkState, cookieIsSecure, newState, readCookie, stateCookie } from '../api/_lib/oauthState.js';

test('state passt nur, wenn Cookie und Query übereinstimmen', () => {
  const s = newState();
  const cookie = `other=1; ${STATE_COOKIE}=${s}`;
  assert.equal(checkState(cookie, s), 'ok');
  assert.equal(checkState(cookie, newState()), 'mismatch');
  assert.equal(checkState(cookie, s.slice(1)), 'mismatch');
});

test('fehlender state in Query oder Cookie ist missing', () => {
  const s = newState();
  assert.equal(checkState(undefined, s), 'missing');
  assert.equal(checkState('other=1', s), 'missing');
  assert.equal(checkState(`${STATE_COOKIE}=${s}`, undefined), 'missing');
  assert.equal(checkState(`${STATE_COOKIE}=${s}`, ''), 'missing');
  assert.equal(checkState(`${STATE_COOKIE}=`, ''), 'missing');
  assert.equal(checkState(`${STATE_COOKIE}=${s}`, [s, s]), 'missing');
});

test('Cookie ist HttpOnly, Lax, kurzlebig und nur lokal ohne Secure', () => {
  assert.equal(cookieIsSecure('https://larvis.example/api/google/oauth-callback'), true);
  assert.equal(cookieIsSecure('http://localhost:3000/api/google/oauth-callback'), false);
  assert.equal(cookieIsSecure('http://127.0.0.1:3044/api/google/oauth-callback'), false);
  assert.equal(cookieIsSecure('http://localhost.evil.example/api/google/oauth-callback'), true);
  const c = stateCookie('abc', true);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Max-Age=600/);
  assert.match(c, /Path=\/api\/google/);
  assert.match(c, /Secure/);
  assert.doesNotMatch(stateCookie('abc', false), /Secure/);
  assert.equal(readCookie(c.split(';')[0], STATE_COOKIE), 'abc');
});
