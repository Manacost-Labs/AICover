import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEncryptedChatGptSessionStore } from './chatgpt-session-store.js';

const sessionId = 'a'.repeat(43);
const key = crypto.randomBytes(32).toString('base64url');

async function fixture(t, now = 1_000) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-chatgpt-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    filePath: path.join(root, 'sessions.enc'),
    now: () => now,
  };
}

test('encrypts connected sessions and restores only the OAuth fields required by the transport', async t => {
  const options = await fixture(t);
  const store = await createEncryptedChatGptSessionStore({ ...options, key });
  store.sessions.set(sessionId, {
    tokens: {
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
      idToken: 'private-id',
      accountId: 'account-a',
      isFedRamp: false,
      raw: { mustNotPersist: true },
    },
    expiresAt: 9_000,
    tokenExpiresAt: 8_000,
    imageVerified: true,
    bindingDigest: 'b'.repeat(64),
    requests: [1, 2, 3],
    controller: new AbortController(),
  });
  await store.persist();

  const ciphertext = await fs.readFile(options.filePath, 'utf8');
  assert.equal(ciphertext.includes('private-access'), false);
  assert.equal(ciphertext.includes('private-refresh'), false);
  assert.equal(ciphertext.includes('account-a'), false);
  assert.equal((await fs.stat(options.filePath)).mode & 0o777, 0o600);

  const restored = await createEncryptedChatGptSessionStore({ ...options, key });
  assert.deepEqual(restored.sessions.get(sessionId), {
    tokens: {
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
      idToken: 'private-id',
      accountId: 'account-a',
      isFedRamp: false,
    },
    expiresAt: 9_000,
    tokenExpiresAt: 8_000,
    imageVerified: true,
    bindingDigest: 'b'.repeat(64),
    requests: [],
  });
});

test('fails closed to an empty store when ciphertext is damaged or a record is invalid', async t => {
  const warnings = [];
  const options = await fixture(t);
  await fs.writeFile(options.filePath, '{"version":1,"ciphertext":"damaged"}', { mode: 0o600 });

  const damaged = await createEncryptedChatGptSessionStore({ ...options, key, onWarning: message => warnings.push(message) });
  assert.equal(damaged.sessions.size, 0);
  assert.deepEqual(warnings, ['ChatGPT session store could not be restored; starting empty.']);

  damaged.sessions.set('not-a-session-id', { tokens: { accessToken: 'x', accountId: 'y' }, expiresAt: 9_000 });
  damaged.sessions.set(sessionId, { tokens: { accessToken: '', accountId: 'y' }, expiresAt: 9_000 });
  await damaged.persist();
  const restored = await createEncryptedChatGptSessionStore({ ...options, key });
  assert.equal(restored.sessions.size, 0);
});

test('drops expired records and rejects weak keys or symlink storage targets', async t => {
  const options = await fixture(t, 10_000);
  const store = await createEncryptedChatGptSessionStore({ ...options, key });
  store.sessions.set(sessionId, {
    tokens: { accessToken: 'private-access', accountId: 'account-a' },
    expiresAt: 9_999,
    tokenExpiresAt: 9_000,
    imageVerified: false,
    bindingDigest: 'b'.repeat(64),
    requests: [],
  });
  await store.persist();
  assert.equal((await createEncryptedChatGptSessionStore({ ...options, key })).sessions.size, 0);

  await assert.rejects(
    createEncryptedChatGptSessionStore({ ...options, filePath: path.join(path.dirname(options.filePath), 'weak.enc'), key: 'weak' }),
    /32-byte base64url key/,
  );

  const target = path.join(path.dirname(options.filePath), 'target');
  const linked = path.join(path.dirname(options.filePath), 'linked.enc');
  await fs.writeFile(target, 'x');
  await fs.symlink(target, linked);
  await assert.rejects(createEncryptedChatGptSessionStore({ ...options, filePath: linked, key }), /regular file/);
});

test('refuses an oversized encrypted envelope before replacing the last valid store', async t => {
  const options = await fixture(t);
  const store = await createEncryptedChatGptSessionStore({ ...options, key, maxSessions: 29 });
  store.sessions.set(sessionId, {
    tokens: { accessToken: 'valid-access', accountId: 'account-a' },
    expiresAt: 9_000,
    tokenExpiresAt: 8_000,
    imageVerified: false,
    requests: [],
  });
  await store.persist();
  const validCiphertext = await fs.readFile(options.filePath);

  // The plaintext stays below 8 MiB, while AES-GCM envelope base64 expansion
  // puts the actual persisted bytes above the restore boundary.
  for (let index = 0; index < 28; index++) {
    const id = Buffer.alloc(32, index).toString('base64url');
    store.sessions.set(id, {
      tokens: {
        accessToken: `access-${index}-${'x'.repeat(120_000)}`,
        refreshToken: `refresh-${index}-${'y'.repeat(120_000)}`,
        accountId: `account-${index}`,
      },
      expiresAt: 9_000,
      tokenExpiresAt: 8_000,
      imageVerified: false,
      requests: [],
    });
  }

  await assert.rejects(store.persist(), /capacity exceeded/);
  assert.deepEqual(await fs.readFile(options.filePath), validCiphertext);
});
