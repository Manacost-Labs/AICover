import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { atomic, hash, inventory } from './release-openrouter.mjs';
import { checkLocal, publish, rollback, validateArchive } from './release-seedream-icons-motion.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
async function put(file, data, mode = 0o644) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: 'wx', mode });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-seedream-release-test-'));
  const saved = `${root}/backup`;
  const app = `${root}/app`;
  const targets = {
    index: `${app}/dist/index.html`, server: `${app}/server/index.js`,
    openrouter: `${app}/server/openrouter-image.js`, models: `${app}/server/openrouter-models.js`,
  };
  const manifest = { files: {}, previousDist: {}, candidateDist: {}, support: {}, baselineRestarts: 0 };
  for (const [key, target] of Object.entries(targets)) {
    const previous = key === 'models' ? null : `previous-${key}`;
    const candidate = `candidate-${key}`;
    if (previous) { await put(target, previous); await put(`${saved}/previous/${key}`, previous); }
    await put(`${saved}/candidate/${key}`, candidate);
    manifest.files[key] = {
      target, previous: previous ? digest(previous) : null, candidate: digest(candidate),
      owner: { uid: process.getuid(), gid: process.getgid(), mode: 0o644 },
    };
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

function localFetchFixture(indexBody) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push([url, init.method || 'GET']);
    if (url.endsWith('/api/health')) return Response.json({ ok: true });
    if (url.endsWith('/api/runtime-capabilities')) return Response.json({ gemini: true, openrouter: true });
    if (url.endsWith('/api/chatgpt/session')) return Response.json({ enabled: true, connected: true });
    if (url.endsWith('/api/thumbnail/openrouter-models')) return Response.json({ models: [
      'openai/gpt-image-2', 'meta/muse-image', 'recraft/recraft-v4-styles-pro',
      'bytedance-seed/seedream-5-0-lite', 'bytedance-seed/seedream-5-0-pro',
      'x-ai/grok-imagine-image-2.0', 'qwen/qwen-image-3-pro', 'krea/krea-2-large',
      'sourceful/riverflow-v2.5-pro', 'sourceful/riverflow-v2.5-fast',
    ].map(id => ({ id, availability: id.startsWith('bytedance-seed/') ? 'available' : 'unknown' })) });
    if (url.endsWith('/api/thumbnail/openrouter-generate') && init.method === 'POST') {
      return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
    }
    if (url.endsWith('/api/thumbnail/openrouter-generate') && init.method === 'GET') return new Response(null, { status: 405 });
    if (url.endsWith('/')) return new Response(indexBody);
    throw new Error(`Unexpected request: ${url}`);
  };
  return { calls, fetchImpl };
}

test('local candidate probe verifies Seedream endpoints and rollback probe skips the candidate-only route', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const candidate = localFetchFixture('candidate-index');
    globalThis.fetch = candidate.fetchImpl;
    await checkLocal(digest('candidate-index'), true);
    assert.equal(candidate.calls.some(([url]) => url.endsWith('/api/thumbnail/openrouter-models')), true);

    const baseline = localFetchFixture('previous-index');
    globalThis.fetch = baseline.fetchImpl;
    await checkLocal(digest('previous-index'), false);
    assert.equal(baseline.calls.some(([url]) => url.endsWith('/api/thumbnail/openrouter-models')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publishes backend before the index and restores exact previous files', async () => {
  const release = await fixture();
  const events = [];
  await publish({ ...release, hooks: async stage => events.push(stage) });
  assert(events.indexOf('backend') < events.indexOf('index'));
  for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.candidate);
  await rollback(release);
  for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.previous);
  assert.equal((await fs.readdir(release.saved)).filter(name => name.startsWith('retired-models-')).length, 1);
});

for (const failure of ['written:models', 'written:openrouter', 'written:server', 'backend', 'index', 'verify']) {
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

test('foreign drift, corrupt archive, symlink, asset collision and post-rename failure fail closed', async () => {
  const drift = await fixture();
  await fs.writeFile(drift.targets.server, 'another-release');
  await assert.rejects(publish(drift), /Release drift|Preflight drift/);

  const corrupt = await fixture();
  await fs.writeFile(`${corrupt.saved}/candidate/models`, 'corrupt');
  await assert.rejects(validateArchive(corrupt.saved), /archive drift/);

  const linked = await fixture();
  await fs.rename(linked.targets.openrouter, `${linked.targets.openrouter}.real`);
  await fs.symlink(`${linked.targets.openrouter}.real`, linked.targets.openrouter);
  await assert.rejects(publish(linked), /regular file/);

  const collision = await fixture();
  await put(`${collision.app}/dist/assets/new.js`, 'collision');
  await assert.rejects(publish(collision), /Asset collision/);

  const afterRename = await fixture();
  let first = true;
  await assert.rejects(publish({ ...afterRename, write: async (...args) => {
    await atomic(...args);
    if (first) { first = false; throw Object.assign(new Error('fsync failure'), { code: 'EIO' }); }
  } }), /previous release restored/);
  for (const [key, descriptor] of Object.entries(afterRename.manifest.files)) assert.equal(await hash(afterRename.targets[key]), descriptor.previous);
});
