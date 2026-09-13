import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { atomic, hash, inventory } from './release-openrouter.mjs';
import { publish, rollback } from './release-model-session.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
async function put(file, data, mode = 0o644) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: 'wx', mode });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-model-session-test-'));
  const saved = `${root}/backup`;
  const app = `${root}/app`;
  const targets = {
    index: `${app}/dist/index.html`, server: `${app}/server/index.js`, openrouter: `${app}/server/openrouter-image.js`,
    router: `${app}/server/chatgpt-router.js`, store: `${app}/server/chatgpt-session-store.js`,
    drop: `${root}/etc/systemd/35-chatgpt-session.conf`, env: `${root}/etc/cover-image/chatgpt-session.env`,
  };
  const manifest = { files: {}, previousDist: {}, candidateDist: {}, support: {}, baselineRestarts: 0 };
  for (const [key, target] of Object.entries(targets)) {
    const previous = ['store', 'drop', 'env'].includes(key) ? null : `previous-${key}`;
    const candidate = key === 'env'
      ? `COVER_CHATGPT_SESSION_KEY=${'a'.repeat(43)}\nCOVER_CHATGPT_SESSION_FILE=/var/lib/cover-image/chatgpt/sessions.enc\n`
      : `candidate-${key}`;
    if (previous) { await put(target, previous); await put(`${saved}/previous/${key}`, previous); }
    await put(`${saved}/candidate/${key}`, candidate, key === 'env' ? 0o600 : 0o644);
    manifest.files[key] = { target, previous: previous ? digest(previous) : null, candidate: digest(candidate), owner: { uid: process.getuid(), gid: process.getgid(), mode: key === 'env' ? 0o600 : 0o644 } };
  }
  await put(`${app}/dist/assets/old.js`, 'old-asset');
  await put(`${saved}/previous-dist/index.html`, 'previous-index');
  await put(`${saved}/previous-dist/assets/old.js`, 'old-asset');
  await put(`${saved}/candidate-dist/index.html`, 'candidate-index');
  await put(`${saved}/candidate-dist/assets/new.js`, 'new-asset');
  await put(`${saved}/support/reviewed`, 'yes');
  manifest.previousDist = await inventory(`${saved}/previous-dist`);
  manifest.candidateDist = await inventory(`${saved}/candidate-dist`);
  manifest.support = await inventory(`${saved}/support`);
  await put(`${saved}/manifest.json`, JSON.stringify(manifest));
  return { root, saved, app, targets, manifest };
}

test('publishes backend before index and restores the exact previous release', async () => {
  const release = await fixture();
  const events = [];
  await publish({ ...release, hooks: async stage => events.push(stage) });
  assert(events.indexOf('backend') < events.indexOf('index'));
  for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.candidate);
  await rollback(release);
  for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.previous);
});

for (const failure of ['written:env', 'written:drop', 'written:store', 'written:router', 'written:openrouter', 'written:server', 'backend', 'index', 'verify']) {
  test(`failure at ${failure} restores the previous release`, async () => {
    const release = await fixture();
    let restored = false;
    await assert.rejects(publish({ ...release, hooks: async stage => {
      if (stage === failure) throw new Error('simulated failure');
      if (stage === 'restore') restored = true;
    } }), /previous release restored/);
    assert.equal(restored, true);
    for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.previous);
  });
}

test('foreign drift, corrupt archive, symlink and post-rename failure fail closed', async () => {
  const drift = await fixture();
  await fs.writeFile(drift.targets.router, 'another-release');
  await assert.rejects(publish(drift), /Release drift|Preflight drift/);

  const corrupt = await fixture();
  await fs.writeFile(`${corrupt.saved}/candidate/store`, 'corrupt');
  await assert.rejects(publish(corrupt), /archive drift/);

  const linked = await fixture();
  await fs.rename(linked.targets.server, `${linked.targets.server}.real`);
  await fs.symlink(`${linked.targets.server}.real`, linked.targets.server);
  await assert.rejects(publish(linked), /regular file/);

  const afterRename = await fixture();
  let first = true;
  await assert.rejects(publish({ ...afterRename, write: async (...args) => {
    await atomic(...args);
    if (first) { first = false; throw Object.assign(new Error('fsync failure'), { code: 'EIO' }); }
  } }), /previous release restored/);
  for (const [key, descriptor] of Object.entries(afterRename.manifest.files)) assert.equal(await hash(afterRename.targets[key]), descriptor.previous);
});
