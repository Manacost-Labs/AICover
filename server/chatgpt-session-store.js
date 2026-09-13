import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('cover-chatgpt-sessions:v1', 'utf8');
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_TOKEN_BYTES = 128 * 1024;
const MAX_ACCOUNT_BYTES = 2 * 1024;

function encryptionKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('COVER_CHATGPT_SESSION_KEY must be a 32-byte base64url key.');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
    throw new Error('COVER_CHATGPT_SESSION_KEY must be a 32-byte base64url key.');
  }
  return decoded;
}

function boundedString(value, maximum) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= maximum
    ? value
    : undefined;
}

function safeTokens(value) {
  if (!value || typeof value !== 'object') return null;
  const accessToken = boundedString(value.accessToken, MAX_TOKEN_BYTES);
  const accountId = boundedString(value.accountId, MAX_ACCOUNT_BYTES);
  if (!accessToken || !accountId) return null;
  const tokens = { accessToken, accountId };
  const refreshToken = boundedString(value.refreshToken, MAX_TOKEN_BYTES);
  const idToken = boundedString(value.idToken, MAX_TOKEN_BYTES);
  const expiresAt = boundedString(value.expiresAt, 128);
  const lastRefresh = boundedString(value.lastRefresh, 128);
  if (refreshToken) tokens.refreshToken = refreshToken;
  if (idToken) tokens.idToken = idToken;
  if (typeof value.isFedRamp === 'boolean') tokens.isFedRamp = value.isFedRamp;
  if (expiresAt) tokens.expiresAt = expiresAt;
  if (lastRefresh) tokens.lastRefresh = lastRefresh;
  return tokens;
}

function safeSession(id, value, now) {
  if (!SESSION_ID.test(id) || !value || typeof value !== 'object') return null;
  const tokens = safeTokens(value.tokens);
  if (!tokens || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) return null;
  if (!Number.isFinite(value.tokenExpiresAt)) return null;
  if (value.bindingDigest != null && !DIGEST.test(value.bindingDigest)) return null;
  return {
    tokens,
    expiresAt: value.expiresAt,
    tokenExpiresAt: value.tokenExpiresAt,
    imageVerified: value.imageVerified === true,
    ...(value.bindingDigest ? { bindingDigest: value.bindingDigest } : {}),
    requests: [],
  };
}

function serializeSessions(sessions, now, maxSessions) {
  const records = [];
  for (const [id, value] of sessions) {
    const session = safeSession(id, value, now);
    if (!session) continue;
    records.push([id, session]);
    if (records.length >= maxSessions) break;
  }
  return Buffer.from(JSON.stringify({ version: VERSION, sessions: records }), 'utf8');
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.from(JSON.stringify({
    version: VERSION,
    algorithm: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  }), 'utf8');
}

function canonicalBase64Url(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encrypted store.');
  const decoded = Buffer.from(value, 'base64url');
  if (bytes != null && decoded.length !== bytes) throw new Error('Invalid encrypted store.');
  if (decoded.toString('base64url') !== value) throw new Error('Invalid encrypted store.');
  return decoded;
}

function decrypt(envelopeBytes, key) {
  if (envelopeBytes.length > MAX_STORE_BYTES) throw new Error('Encrypted store is too large.');
  const envelope = JSON.parse(envelopeBytes.toString('utf8'));
  if (envelope?.version !== VERSION || envelope?.algorithm !== 'A256GCM') throw new Error('Invalid encrypted store.');
  const iv = canonicalBase64Url(envelope.iv, 12);
  const tag = canonicalBase64Url(envelope.tag, 16);
  const ciphertext = canonicalBase64Url(envelope.ciphertext);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function assertRegularTarget(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) throw new Error(`ChatGPT session store is not a regular file: ${filePath}`);
    return stat;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(filePath, bytes) {
  const directoryPath = path.dirname(filePath);
  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const directoryStat = await fs.lstat(directoryPath);
  if (!directoryStat.isDirectory()) throw new Error(`ChatGPT session directory is not a real directory: ${directoryPath}`);
  await assertRegularTarget(filePath);
  const temporaryPath = path.join(directoryPath, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertRegularTarget(filePath);
    await fs.rename(temporaryPath, filePath);
    const directory = await fs.open(directoryPath, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

/**
 * Multi-user OAuth session persistence for Cover. Only transport fields are
 * serialized; pending logins, request history and AbortControllers stay in RAM.
 * Source: Node 22 crypto.createCipheriv/createDecipheriv and fsPromises.rename.
 */
export async function createEncryptedChatGptSessionStore({
  filePath,
  key,
  now = Date.now,
  maxSessions = 1_000,
  onWarning = message => console.warn(message),
} = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('COVER_CHATGPT_SESSION_FILE must be an absolute path.');
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 10_000) {
    throw new Error('maxSessions must be between 1 and 10000.');
  }
  const keyBytes = encryptionKey(key);
  const sessions = new Map();
  const target = await assertRegularTarget(filePath);
  if (target) {
    try {
      if (target.size > MAX_STORE_BYTES) throw new Error('Encrypted store is too large.');
      const payload = JSON.parse(decrypt(await fs.readFile(filePath), keyBytes).toString('utf8'));
      if (payload?.version !== VERSION || !Array.isArray(payload.sessions)) throw new Error('Invalid session payload.');
      for (const record of payload.sessions.slice(0, maxSessions)) {
        if (!Array.isArray(record) || record.length !== 2) continue;
        const session = safeSession(record[0], record[1], now());
        if (session) sessions.set(record[0], session);
      }
    } catch {
      sessions.clear();
      onWarning('ChatGPT session store could not be restored; starting empty.');
    }
  }

  let queue = Promise.resolve();
  const store = {
    sessions,
    persist() {
      const snapshot = serializeSessions(sessions, now(), maxSessions);
      const ciphertext = encrypt(snapshot, keyBytes);
      if (ciphertext.length > MAX_STORE_BYTES) {
        return Promise.reject(new Error('ChatGPT session store capacity exceeded.'));
      }
      const work = () => atomicWrite(filePath, ciphertext);
      const result = queue.then(work, work);
      queue = result.catch(() => {});
      return result;
    },
  };
  return store;
}
