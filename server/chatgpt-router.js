import crypto from 'node:crypto';
import express from 'express';
import { createOpenAIOAuthRequest, exchangeOpenAIOAuthCode, refreshOpenAIOAuthTokens, createOpenAIOAuthTransport } from '@openai-oauth/core';
import { buildImageRequest, readImageResponse, readBoundedJson, discoverImageModels, imageError, PUBLIC_ERROR } from './chatgpt-images.js';

const COOKIE = '__Secure-cover_chatgpt';
const COOKIE_PATH = '/api/chatgpt';
const LOGIN_TTL = 10 * 60 * 1000;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const requestError = (status, code, message) => Object.assign(new Error(message), { status, code, [PUBLIC_ERROR]: true });
const randomId = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest();
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(digest(a), digest(b));
const fetchNoRedirect = (input, init) => fetch(input, { ...init, redirect: 'error' });

// Every request receives an explicit per-browser session. There is no global
// ChatGPT account and no discovery of credentials from developer tooling.
const defaultOAuth = {
  createLogin: createOpenAIOAuthRequest,
  exchange: options => exchangeOpenAIOAuthCode({ ...options, fetch: fetchNoRedirect }),
  refresh: options => refreshOpenAIOAuthTokens({ ...options, fetch: fetchNoRedirect }),
  request: (session, path, init) => createOpenAIOAuthTransport({ auth: session, codexVersion: '0.144.1', fetch: fetchNoRedirect }).request(path, init),
};

function safeOAuthTokens(value) {
  if (!value || typeof value.accessToken !== 'string' || !value.accessToken || typeof value.accountId !== 'string' || !value.accountId) {
    return null;
  }
  return {
    accessToken: value.accessToken,
    accountId: value.accountId,
    ...(typeof value.refreshToken === 'string' && value.refreshToken ? { refreshToken: value.refreshToken } : {}),
    ...(typeof value.idToken === 'string' && value.idToken ? { idToken: value.idToken } : {}),
    ...(typeof value.isFedRamp === 'boolean' ? { isFedRamp: value.isFedRamp } : {}),
    ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.lastRefresh === 'string' ? { lastRefresh: value.lastRefresh } : {}),
  };
}

export function createChatGptRouter({
  origin,
  enabled = false,
  oauth = defaultOAuth,
  now = Date.now,
  maxSessions = 1000,
  sessionStore,
  bindingCookie,
} = {}) {
  const router = express.Router();
  const sessions = sessionStore?.sessions || new Map();
  if (!(sessions instanceof Map) || sessionStore && typeof sessionStore.persist !== 'function') {
    throw new Error('Invalid ChatGPT session store.');
  }
  const persist = sessionStore ? () => sessionStore.persist() : async () => {};
  const loginBuckets = new Map();
  if (enabled && (typeof origin !== 'string' || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin)) {
    throw new Error('COVER_CHATGPT_ORIGIN must be an exact HTTPS origin.');
  }
  const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: COOKIE_PATH };
  const readNamedCookie = (req, name, pattern, maximum = 4_096) => {
    const encoded = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    if (typeof encoded !== 'string' || encoded.length > maximum) return undefined;
    try {
      const value = decodeURIComponent(encoded);
      return pattern.test(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const readCookie = req => readNamedCookie(req, COOKIE, /^[A-Za-z0-9_-]{43}$/, 64);
  const bindingFor = req => {
    if (!bindingCookie) return undefined;
    const value = readNamedCookie(req, bindingCookie, /^[A-Za-z0-9_.-]+$/, 2_048);
    return value ? crypto.createHash('sha256').update(value).digest('hex') : undefined;
  };
  function erase(id) {
    const session = sessions.get(id);
    session?.controller?.abort();
    if (session) { session.tokens = undefined; session.pending = undefined; }
    sessions.delete(id);
  }
  function cleanup() {
    let changed = false;
    for (const [id, session] of sessions) if (session.expiresAt <= now()) { erase(id); changed = true; }
    for (const [ip, timestamps] of loginBuckets) if (!timestamps.some(time => now() - time < LOGIN_TTL)) loginBuckets.delete(ip);
    return changed;
  }
  function sessionFor(req, required = true) {
    let session = sessions.get(readCookie(req));
    if (session && bindingCookie) {
      const bindingDigest = bindingFor(req);
      if (!bindingDigest || !equal(bindingDigest, session.bindingDigest)) session = undefined;
    }
    if (required && !session?.tokens) throw imageError(401);
    return session;
  }
  const wrap = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
  router.use((req, res, next) => Promise.resolve().then(async () => {
    if (cleanup()) await persist();
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    if (req.method !== 'GET' && req.headers.origin !== origin) return next(requestError(403, 'ORIGIN_DENIED', 'Запрос разрешён только из Cover.'));
    if (req.method !== 'GET' && !req.is('application/json')) return next(requestError(415, 'JSON_REQUIRED', 'Ожидается JSON.'));
    if (!enabled && req.path !== '/session') return next(requestError(503, 'CHATGPT_DISABLED', 'Подключение ChatGPT пока не включено на сервере.'));
    next();
  }).catch(next));
  // Mounted BEFORE the legacy app-wide parser to keep the new input bounded.
  router.use(express.json({ limit: '34mb', strict: true }));
  router.get('/session', (req, res) => {
    const session = sessionFor(req, false);
    res.json({ enabled, connected: Boolean(session?.tokens), imageVerified: Boolean(session?.imageVerified) });
  });
  router.post('/login', wrap(async (req, res) => {
    const bindingDigest = bindingFor(req);
    if (bindingCookie && !bindingDigest) throw imageError(401);
    const ip = req.ip || req.socket.remoteAddress;
    const bucket = (loginBuckets.get(ip) || []).filter(time => now() - time < LOGIN_TTL);
    if (bucket.length >= 10 || loginBuckets.size >= 1000 && !loginBuckets.has(ip)) throw imageError(429);
    bucket.push(now()); loginBuckets.set(ip, bucket);
    if (sessions.size >= maxSessions) throw requestError(503, 'CHATGPT_CAPACITY', 'Слишком много подключений. Попробуйте позже.');
    const state = 'oo2_' + Buffer.from(JSON.stringify({ type: 'openai-oauth-callback', version: 1, nonce: randomId(), callbackUrl: `${origin}/chatgpt/callback` })).toString('base64url');
    const pending = await oauth.createLogin({ state, redirectUri: REDIRECT_URI });
    // State/verifier never supplied by the browser. Any previous session in this
    // browser is revoked explicitly when starting a new connection.
    erase(readCookie(req));
    const id = randomId();
    sessions.set(id, { pending, expiresAt: now() + LOGIN_TTL, imageVerified: false, requests: [], ...(bindingDigest ? { bindingDigest } : {}) });
    try { await persist(); } catch { erase(id); throw requestError(503, 'CHATGPT_SESSION_STORAGE', 'Не удалось сохранить подключение ChatGPT.'); }
    res.cookie(COOKIE, id, { ...cookieOptions, maxAge: LOGIN_TTL });
    res.json({ authorizationUrl: pending.authorizationUrl });
  }));
  router.post('/callback', wrap(async (req, res) => {
    const oldId = readCookie(req);
    const current = sessionFor(req, false);
    const { code, state } = req.body || {};
    if (!current?.pending || !equal(state, current.pending.state) || typeof code !== 'string' || !code || code.length > 4096) {
      throw requestError(400, 'OAUTH_STATE_INVALID', 'Ссылка входа истекла или недействительна. Начните подключение заново.');
    }
    const pending = current.pending;
    current.pending = undefined; // consume once BEFORE the asynchronous exchange
    let tokens;
    try {
      const exchanged = await oauth.exchange({ code, codeVerifier: pending.codeVerifier, redirectUri: REDIRECT_URI, signal: AbortSignal.timeout(20000) });
      tokens = safeOAuthTokens(exchanged);
      if (!tokens) throw imageError(401);
      tokens.expiresIn = exchanged.expiresIn;
    } catch { erase(oldId); throw imageError(401); }
    if (sessions.get(oldId) !== current) throw imageError(401); // disconnect during exchange
    erase(oldId);
    const id = randomId();
    const expiresIn = tokens.expiresIn;
    delete tokens.expiresIn;
    sessions.set(id, { tokens, expiresAt: now() + SESSION_TTL, tokenExpiresAt: now() + (expiresIn || 3600) * 1000, imageVerified: false, requests: [], ...(current.bindingDigest ? { bindingDigest: current.bindingDigest } : {}) });
    try { await persist(); } catch { erase(id); throw requestError(503, 'CHATGPT_SESSION_STORAGE', 'Не удалось сохранить подключение ChatGPT.'); }
    res.cookie(COOKIE, id, { ...cookieOptions, maxAge: SESSION_TTL });
    res.json({ connected: true });
  }));
  router.post('/disconnect', wrap(async (req, res) => {
    erase(readCookie(req));
    await persist();
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ connected: false });
  }));

  async function run(req, res, operation) {
    const id = readCookie(req);
    const session = sessionFor(req);
    if (session.controller) throw imageError(429);
    const requests = session.requests.filter(time => now() - time < LOGIN_TTL);
    if (requests.length >= 12) throw imageError(429);
    requests.push(now()); session.requests = requests;
    const controller = new AbortController();
    session.controller = controller;
    const timer = setTimeout(() => controller.abort(), 180000);
    const closed = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', closed);
    try {
      if (session.tokenExpiresAt <= now() + 60000) {
        if (!session.tokens.refreshToken) throw imageError(401);
        let refreshed;
        try { refreshed = await oauth.refresh({ refreshToken: session.tokens.refreshToken, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }); }
        catch { throw imageError(401); }
        if (!refreshed?.accessToken || refreshed.accountId && refreshed.accountId !== session.tokens?.accountId) throw imageError(401);
        session.tokens = safeOAuthTokens({ ...session.tokens, ...refreshed, accountId: session.tokens.accountId, refreshToken: refreshed.refreshToken || session.tokens.refreshToken });
        if (!session.tokens) throw imageError(401);
        session.tokenExpiresAt = now() + (refreshed.expiresIn || 3600) * 1000;
        await persist();
      }
      if (sessions.get(id) !== session || !session.tokens || controller.signal.aborted) throw imageError(401);
      const result = await operation(session, controller.signal);
      if (sessions.get(id) !== session || controller.signal.aborted) throw imageError(401);
      await persist();
      res.json(result);
    } catch (error) {
      const aborted = controller.signal.aborted;
      if (error.status === 401) { erase(id); await persist(); res.clearCookie(COOKIE, cookieOptions); }
      if (aborted) throw requestError(504, 'CHATGPT_TIMEOUT', 'Запрос ChatGPT прерван или занял слишком много времени.');
      throw error;
    } finally {
      clearTimeout(timer); res.off('close', closed); session.controller = undefined;
    }
  }
  router.post('/images', wrap(async (req, res) => {
    sessionFor(req);
    const request = buildImageRequest(req.body);
    return run(req, res, async (session, signal) => {
      const imageUrl = await readImageResponse(await oauth.request(session.tokens, request.path, { method: 'POST', ...request, signal }));
      session.imageVerified = true;
      return { imageUrl };
    });
  }));
  router.post('/models', wrap((req, res) => run(req, res, async (session, signal) => {
    const response = await oauth.request(session.tokens, '/models?client_version=0.144.1', { signal });
    const models = discoverImageModels(await readBoundedJson(response, 2 * 1024 * 1024));
    return { models: models.map(model => ({ ...model, verified: model.id === 'gpt-image-2' && session.imageVerified })) };
  })));
  router.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Неизвестный запрос ChatGPT.' } }));
  router.use((error, _req, res, _next) => {
    const known = error[PUBLIC_ERROR] === true;
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : known ? error.status : 502;
    res.status(status).json({ error: { code: known ? error.code : 'CHATGPT_REQUEST_FAILED', message: known ? error.message : status === 413 ? 'Исходные файлы слишком большие.' : 'Не удалось выполнить запрос ChatGPT.' } });
  });
  return router;
}
