import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createChatGptRouter } from './chatgpt-router.js';

const origin = 'https://cover.test';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=';

async function fixture(t, overrides = {}) {
  const calls = [];
  const oauth = {
    createLogin: async ({ state, redirectUri }) => ({ state, redirectUri, codeVerifier: 'server-only-verifier', authorizationUrl: `https://auth.openai.com/oauth/authorize?state=${encodeURIComponent(state)}` }),
    exchange: async ({ code }) => ({ accessToken: `private-${code}`, accountId: code, expiresIn: 3600, refreshToken: `refresh-${code}` }),
    refresh: async () => { throw new Error('not expected'); },
    request: async (session, path) => {
      calls.push({ accountId: session.accountId, path });
      return path.startsWith('/models') ? Response.json({ models: [{ slug: 'gpt-image-2' }, { slug: 'gpt-image-next' }] }) : Response.json({ data: [{ b64_json: png }] });
    },
    ...overrides.oauth,
  };
  const app = express();
  app.use('/api/chatgpt', createChatGptRouter({ origin, enabled: true, ...overrides, oauth }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/chatgpt`;
  const request = (path, body, cookie = '', requestOrigin = origin) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: requestOrigin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function login(code) {
    const start = await request('/login', {});
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const body = await start.json();
    const state = new URL(body.authorizationUrl).searchParams.get('state');
    const completed = await request('/callback', { code, state }, cookie);
    assert.equal(completed.status, 200);
    return { cookie: completed.headers.get('set-cookie').split(';')[0], pendingCookie: cookie, state, completed };
  }
  return { request, login, calls, base };
}

function memorySessionStore(seed = new Map()) {
  let durable = new Map(seed);
  return {
    sessions: new Map(seed),
    persist: async function persist() {
      durable = new Map([...this.sessions].map(([id, session]) => [id, structuredClone({
        ...session,
        controller: undefined,
      })]));
    },
    snapshot: () => new Map(durable),
  };
}

test('disabled feature does not start OAuth or expose credentials', async t => {
  const f = await fixture(t, { enabled: false });
  assert.deepEqual(await (await f.request('/session')).json(), { enabled: false, connected: false, imageVerified: false });
  assert.equal((await f.request('/login', {})).status, 503);
});

test('rejects foreign origins, missing connection, wrong state and replay', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/login', {}, '', 'https://evil.test')).status, 403);
  assert.equal((await f.request('/images', { prompt: 'x' })).status, 401);
  const start = await f.request('/login', {});
  const cookie = start.headers.get('set-cookie').split(';')[0];
  assert.match(start.headers.get('set-cookie'), /HttpOnly/);
  assert.match(start.headers.get('set-cookie'), /Secure/);
  const body = await start.json();
  assert.equal(JSON.stringify(body).includes('verifier'), false);
  const state = new URL(body.authorizationUrl).searchParams.get('state');
  assert.equal((await f.request('/callback', { code: 'a', state: 'bad' }, cookie)).status, 400);
  const complete = await f.request('/callback', { code: 'a', state }, cookie);
  assert.equal(complete.status, 200);
  assert.equal((await f.request('/callback', { code: 'a', state }, cookie)).status, 400);
});

test('sessions isolate accounts, rotate cookies and erase credentials on disconnect', async t => {
  const f = await fixture(t);
  const a = await f.login('account-a');
  const b = await f.login('account-b');
  assert.notEqual(a.cookie, a.pendingCookie);
  for (const user of [a, b]) {
    const result = await f.request('/images', { prompt: 'test' }, user.cookie);
    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(await result.json()).includes('private-'), false);
  }
  assert.deepEqual(f.calls.map(call => call.accountId), ['account-a', 'account-b']);
  const state = await (await f.request('/session', undefined, a.cookie)).json();
  assert.deepEqual(state, { enabled: true, connected: true, imageVerified: true });
  assert.equal((await f.request('/disconnect', {}, a.cookie)).status, 200);
  assert.equal((await f.request('/images', { prompt: 'test' }, a.cookie)).status, 401);
  assert.equal((await f.request('/images', { prompt: 'test' }, b.cookie)).status, 200);
});

test('restores a connected account after router restart and binds it to the current Cover login', async t => {
  const firstStore = memorySessionStore();
  const first = await fixture(t, { sessionStore: firstStore, bindingCookie: 'cover_admin_session' });
  const start = await first.request('/login', {}, 'cover_admin_session=cover-a');
  const pendingCookie = start.headers.get('set-cookie').split(';')[0];
  const state = new URL((await start.json()).authorizationUrl).searchParams.get('state');
  const completed = await first.request('/callback', { code: 'account-a', state }, `${pendingCookie}; cover_admin_session=cover-a`);
  assert.equal(completed.status, 200);
  const connectedCookie = completed.headers.get('set-cookie').split(';')[0];

  const restoredStore = memorySessionStore(firstStore.snapshot());
  const restored = await fixture(t, { sessionStore: restoredStore, bindingCookie: 'cover_admin_session' });
  assert.equal((await (await restored.request('/session', undefined, `${connectedCookie}; cover_admin_session=cover-a`)).json()).connected, true);
  assert.equal((await (await restored.request('/session', undefined, `${connectedCookie}; cover_admin_session=cover-b`)).json()).connected, false);
  assert.equal((await restored.request('/images', { prompt: 'test' }, `${connectedCookie}; cover_admin_session=cover-b`)).status, 401);

  assert.equal((await restored.request('/disconnect', {}, `${connectedCookie}; cover_admin_session=cover-a`)).status, 200);
  assert.equal(restoredStore.snapshot().size, 0);
});

test('discovery uses raw upstream catalog, not SDK-injected models, and does not mark verified', async t => {
  const f = await fixture(t);
  const a = await f.login('a');
  const response = await f.request('/models', {}, a.cookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).models.length, 2);
  assert.match(f.calls[0].path, /client_version=/);
  assert.equal((await (await f.request('/session', undefined, a.cookie)).json()).imageVerified, false);
});

test('provider errors are sanitized and a 401 disconnects only the affected account', async t => {
  const f = await fixture(t, { oauth: { request: async () => Response.json({ error: { message: 'sensitive-token' } }, { status: 401 }) } });
  const a = await f.login('a');
  const response = await f.request('/images', { prompt: 'test' }, a.cookie);
  assert.equal(response.status, 401);
  assert.equal((await response.text()).includes('sensitive-token'), false);
  assert.equal((await (await f.request('/session', undefined, a.cookie)).json()).connected, false);
});

test('login expiration and bounded concurrent image requests fail closed', async t => {
  let now = 1000;
  let release;
  const f = await fixture(t, { now: () => now, oauth: { request: () => new Promise(resolve => { release = () => resolve(Response.json({ data: [{ b64_json: png }] })); }) } });
  const start = await f.request('/login', {});
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const state = new URL((await start.json()).authorizationUrl).searchParams.get('state');
  now += 11 * 60 * 1000;
  assert.equal((await f.request('/callback', { code: 'a', state }, cookie)).status, 400);
  const a = await f.login('a');
  const first = f.request('/images', { prompt: 'test' }, a.cookie);
  while (!release) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal((await f.request('/images', { prompt: 'test' }, a.cookie)).status, 429);
  release();
  assert.equal((await first).status, 200);
});

test('refresh rotates the access token but preserves the authenticated account', async t => {
  let now = 1000;
  const observed = [];
  const f = await fixture(t, {
    now: () => now,
    oauth: {
      refresh: async ({ refreshToken }) => ({ accessToken: 'rotated-access-token', refreshToken: `${refreshToken}-rotated`, accountId: 'account-a', expiresIn: 3600 }),
      request: async (tokens) => {
        observed.push(tokens);
        return Response.json({ data: [{ b64_json: png }] });
      },
    },
  });
  const a = await f.login('account-a');
  now += 3600 * 1000;

  assert.equal((await f.request('/images', { prompt: 'test' }, a.cookie)).status, 200);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].accountId, 'account-a');
  assert.equal(observed[0].accessToken, 'rotated-access-token');
});

test('refresh refuses an account swap and a disconnected in-flight refresh cannot restore a session', async t => {
  let now = 1000;
  let releaseRefresh;
  let requestCalls = 0;
  const f = await fixture(t, {
    now: () => now,
    oauth: {
      refresh: () => new Promise(resolve => { releaseRefresh = resolve; }),
      request: async () => { requestCalls++; return Response.json({ data: [{ b64_json: png }] }); },
    },
  });
  const a = await f.login('account-a');
  now += 3600 * 1000;
  const inFlight = f.request('/images', { prompt: 'test' }, a.cookie);
  while (!releaseRefresh) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal((await f.request('/disconnect', {}, a.cookie)).status, 200);
  releaseRefresh({ accessToken: 'late-token', accountId: 'account-a', expiresIn: 3600 });
  assert.notEqual((await inFlight).status, 200);
  assert.equal(requestCalls, 0);
  assert.equal((await (await f.request('/session', undefined, a.cookie)).json()).connected, false);

  const b = await f.login('account-b');
  now += 3600 * 1000;
  // Make the next request refresh immediately and return a different account.
  releaseRefresh = undefined;
  const swapped = f.request('/images', { prompt: 'test' }, b.cookie);
  while (!releaseRefresh) await new Promise(resolve => setTimeout(resolve, 2));
  releaseRefresh({ accessToken: 'wrong-account-token', accountId: 'another-account', expiresIn: 3600 });
  assert.equal((await swapped).status, 401);
  assert.equal((await (await f.request('/session', undefined, b.cookie)).json()).connected, false);
});

test('absolute session expiry, malformed JSON, and non-JSON requests fail closed', async t => {
  let now = 1000;
  const f = await fixture(t, { now: () => now });
  const a = await f.login('account-a');
  now += 8 * 60 * 60 * 1000;
  assert.equal((await (await f.request('/session', undefined, a.cookie)).json()).connected, false);
  assert.equal((await f.request('/images', { prompt: 'test' }, a.cookie)).status, 401);

  const malformed = await fetch(`${f.base}/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  const nonJson = await fetch(`${f.base}/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'text/plain' },
    body: 'not json',
  });
  assert.equal(nonJson.status, 415);
});

test('SDK-shaped provider failures are sanitized and a 429 is not retried', async t => {
  let calls = 0;
  const f = await fixture(t, { oauth: { request: async () => {
    calls++;
    throw Object.assign(new Error('secret SDK provider detail'), { status: 429, code: 'rate_limit' });
  } } });
  const a = await f.login('account-a');
  const response = await f.request('/images', { prompt: 'test' }, a.cookie);
  const text = await response.text();
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.equal(text.includes('secret SDK provider detail'), false);
  assert.equal(text.includes('rate_limit'), false);
});
