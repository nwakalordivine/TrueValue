// Token handling in api.js and session.js, with an in-memory localStorage and a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

// A JWT-shaped token: only the payload's exp matters to the browser
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (expSeconds, id = Math.random()) => `${b64({ alg: 'HS256' })}.${b64({ exp: expSeconds, id })}.sig`;
const inAWeek = () => Math.floor(Date.now() / 1000) + 7 * 86400;
const user = { id: 'u1', email: 'a@example.com', username: 'Ann', avatar_url: null, preferences: null };

const session = await import('../src/services/session.js');
const { api } = await import('../src/api.js');

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const wait = ms => new Promise(r => setTimeout(r, ms));

test('two requests failing at the same time trigger one refresh, then both retry and succeed', async () => {
  session.setSession({ access_token: 'old', refresh_token: jwt(inAWeek()), user });
  const calls = { refresh: 0, me: [] };
  globalThis.fetch = async (url, opts) => {
    if (url.endsWith('/api/auth/refresh')) {
      calls.refresh++;
      await wait(20); // slow enough for both 401s to arrive while it runs
      return reply(200, { access_token: 'new', refresh_token: jwt(inAWeek()), user });
    }
    calls.me.push(opts.headers.Authorization);
    return opts.headers.Authorization === 'Bearer new' ? reply(200, user) : reply(401, { detail: 'Your session has expired.' });
  };
  const [a, b] = await Promise.all([api.me(), api.me()]);
  assert.equal(calls.refresh, 1);
  assert.deepEqual([a.id, b.id], ['u1', 'u1']);
  assert.deepEqual(calls.me.sort(), ['Bearer new', 'Bearer new', 'Bearer old', 'Bearer old']);
  assert.equal(session.accessToken(), 'new');
});

test('a failed refresh signs out locally and the request fails with 401', async () => {
  session.setSession({ access_token: 'old', refresh_token: jwt(inAWeek()), user });
  const seen = [];
  const stop = session.onAuthChange(u => seen.push(u));
  globalThis.fetch = async url => (url.endsWith('/api/auth/refresh')
    ? reply(401, { detail: 'Please sign in again.' }) : reply(401, { detail: 'Your session has expired.' }));
  await assert.rejects(api.me(), err => err.status === 401);
  stop();
  assert.equal(session.currentUser(), null);
  assert.equal(session.refreshToken(), null);
  assert.deepEqual(seen, [null]);
});

test('a network failure during refresh keeps the session (offline is not signed out)', async () => {
  session.setSession({ access_token: 'old', refresh_token: jwt(inAWeek()), user });
  globalThis.fetch = async url => {
    if (url.endsWith('/api/auth/refresh')) throw new TypeError('Failed to fetch');
    return reply(401, { detail: 'expired' });
  };
  await assert.rejects(api.me(), err => err.status === 401);
  assert.equal(session.currentUser()?.id, 'u1');
});

test('sign-in calls carry no token, and their 401s never trigger a refresh', async () => {
  session.setSession({ access_token: 'old', refresh_token: jwt(inAWeek()), user });
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push([url.replace(/^.*\/api/, '/api'), opts.headers.Authorization || null]);
    return reply(401, { detail: 'nope' });
  };
  await assert.rejects(api.requestCode('a@example.com', 'Ann'), err => err.status === 401);
  await assert.rejects(api.verifyCode('a@example.com', '123456', 'Ann'), err => err.status === 401);
  assert.deepEqual(seen, [['/api/auth/request-code', null], ['/api/auth/verify-code', null]]);
});

test('server messages come through without the "Value error, " prefix', async () => {
  globalThis.fetch = async () => reply(422, { detail: [{ msg: 'Value error, Username must be 2 to 30 characters.' }] });
  await assert.rejects(api.requestCode('a@example.com', 'A'), err => err.message === 'Username must be 2 to 30 characters.' && err.status === 422);
});

test('a stored session whose refresh token has expired is cleared when the page loads', async () => {
  store.set('truevalue-auth-v1', JSON.stringify({ access_token: 'a', refresh_token: jwt(Math.floor(Date.now() / 1000) - 60), user }));
  const fresh = await import('../src/services/session.js?page-load');
  assert.equal(fresh.currentUser(), null);
  assert.equal(store.has('truevalue-auth-v1'), false);
});
