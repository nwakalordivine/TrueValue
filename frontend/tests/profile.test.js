// Profile changes (profile.js, api.js uploads) and the picture-size helper, with an in-memory
// localStorage and a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = expSeconds => `${b64({ alg: 'HS256' })}.${b64({ exp: expSeconds })}.sig`;
const inAWeek = () => Math.floor(Date.now() / 1000) + 7 * 86400;
const user = { id: 'u1', email: 'a@example.com', username: 'Ann', avatar_url: null, preferences: null };

const session = await import('../src/services/session.js');
const profile = await import('../src/services/profile.js');
const { fitWithin } = await import('../src/services/imageResize.js');

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const signIn = () => session.setSession({ access_token: 'tok', refresh_token: jwt(inAWeek()), user });

test('fitWithin keeps the shape, caps the longest side at 512 and never enlarges', () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 512, height: 384 });
  assert.deepEqual(fitWithin(1080, 1920), { width: 288, height: 512 });
  assert.deepEqual(fitWithin(300, 200), { width: 300, height: 200 });
  assert.deepEqual(fitWithin(512, 512), { width: 512, height: 512 });
});

test('a picture upload is sent as FormData with the token and no JSON Content-Type', async () => {
  signIn();
  let sent;
  globalThis.fetch = async (url, opts) => {
    sent = { url, opts };
    return reply(200, { ...user, avatar_url: 'https://res.cloudinary.com/x/a.jpg' });
  };
  const updated = await profile.uploadAvatar(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
  assert.ok(sent.url.endsWith('/api/me/avatar'));
  assert.equal(sent.opts.method, 'POST');
  assert.ok(sent.opts.body instanceof FormData);
  assert.ok(sent.opts.body.get('file') instanceof Blob);
  assert.equal(sent.opts.headers['Content-Type'], undefined);
  assert.equal(sent.opts.headers.Authorization, 'Bearer tok');
  assert.equal(updated.avatar_url, 'https://res.cloudinary.com/x/a.jpg');
  assert.equal(session.currentUser().avatar_url, 'https://res.cloudinary.com/x/a.jpg');
});

test('an email already used by another account rejects with status 409 and the server message', async () => {
  signIn();
  globalThis.fetch = async () => reply(409, { detail: 'That email is already used by another account.' });
  await assert.rejects(profile.requestEmailChange(' Taken@Example.com '), err => {
    assert.equal(err.status, 409);
    assert.equal(err.message, 'That email is already used by another account.');
    return true;
  });
});

test('the new email is sent trimmed and lowercase, and confirming it updates the stored user', async () => {
  signIn();
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return url.endsWith('/confirm') ? reply(200, { ...user, email: 'new@example.com' }) : reply(200, { sent: true });
  };
  await profile.requestEmailChange(' New@Example.com ');
  await profile.confirmEmailChange('New@Example.com', '123456');
  assert.deepEqual(bodies, [{ new_email: 'new@example.com' }, { new_email: 'new@example.com', code: '123456' }]);
  assert.equal(session.currentUser().email, 'new@example.com');
});

test('renaming saves the new name and tells onAuthChange listeners', async () => {
  signIn();
  let sentBody;
  globalThis.fetch = async (url, opts) => { sentBody = JSON.parse(opts.body); return reply(200, { ...user, username: 'Annie' }); };
  const seen = [];
  const stop = session.onAuthChange(u => seen.push(u?.username));
  await profile.renameUser('  Annie ');
  stop();
  assert.deepEqual(sentBody, { username: 'Annie' });
  assert.equal(session.currentUser().username, 'Annie');
  assert.deepEqual(seen, ['Annie']);
});
