import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomic, createLiveHooks, hash, inventory, publish, rollback, validateArchive } from './release-openrouter.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
async function put(file, data, mode = 0o644) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: 'wx', mode });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-openrouter-release-test-'));
  const saved = `${root}/backup`;
  const app = `${root}/app`;
  const targets = {
    index: `${app}/dist/index.html`,
    server: `${app}/server/index.js`,
    openrouter: `${app}/server/openrouter-image.js`,
    drop: `${root}/etc/systemd/system/cover-image.service.d/40-openrouter.conf`,
    env: `${root}/etc/cover-image/openrouter.env`,
  };
  const manifest = { files: {}, previousDist: {}, candidateDist: {}, support: {}, baselineRestarts: 0 };
  for (const [key, target] of Object.entries(targets)) {
    const previous = ['drop', 'env'].includes(key) ? null : `previous-${key}`;
    const candidate = `candidate-${key}`;
    if (previous) {
      await put(target, previous);
      await put(`${saved}/previous/${key}`, previous);
    }
    await put(`${saved}/candidate/${key}`, candidate, key === 'env' ? 0o600 : 0o644);
    manifest.files[key] = {
      target,
      previous: previous ? digest(previous) : null,
      candidate: digest(candidate),
      owner: { uid: process.getuid(), gid: process.getgid(), mode: key === 'env' ? 0o600 : 0o644 },
    };
  }
  for (const directory of [`${app}/dist`, `${saved}/previous-dist`]) {
    await put(`${directory}/assets/old.js`, 'old-asset');
  }
  await put(`${saved}/previous-dist/index.html`, 'previous-index');
  await put(`${saved}/candidate-dist/index.html`, 'candidate-index');
  await put(`${saved}/candidate-dist/assets/new.js`, 'new-asset');
  await put(`${saved}/support/release-openrouter.mjs`, 'reviewed-script');
  manifest.previousDist = await inventory(`${saved}/previous-dist`);
  manifest.candidateDist = await inventory(`${saved}/candidate-dist`);
  manifest.support = await inventory(`${saved}/support`);
  await put(`${saved}/manifest.json`, JSON.stringify(manifest));
  return { root, saved, app, targets, manifest };
}

test('publishes backend before index and rollback restores exact previous files', async () => {
  const release = await fixture();
  const events = [];
  await publish({ ...release, hooks: async stage => events.push(stage) });
  for (const [key, descriptor] of Object.entries(release.manifest.files)) {
    assert.equal(await hash(release.targets[key]), descriptor.candidate);
  }
  assert(events.indexOf('backend') < events.indexOf('index'));
  assert.equal(await hash(`${release.app}/dist/assets/old.js`), digest('old-asset'));
  assert.equal(await hash(`${release.app}/dist/assets/new.js`), digest('new-asset'));

  await rollback(release);
  for (const [key, descriptor] of Object.entries(release.manifest.files)) {
    assert.equal(await hash(release.targets[key]), descriptor.previous);
  }
  assert.equal((await fs.readdir(release.saved)).filter(name => name.startsWith('retired-env-')).length, 1);
  assert.equal((await fs.readdir(release.saved)).filter(name => name.startsWith('retired-drop-')).length, 1);
});

for (const failure of ['written:env', 'written:drop', 'written:openrouter', 'written:server', 'backend', 'index', 'verify']) {
  test(`failure at ${failure} restores the previous release`, async () => {
    const release = await fixture();
    let restored = false;
    await assert.rejects(publish({
      ...release,
      hooks: async stage => {
        if (stage === failure) throw new Error('simulated release failure');
        if (stage === 'restore') restored = true;
      },
    }), /previous release restored/);
    assert.equal(restored, true);
    for (const [key, descriptor] of Object.entries(release.manifest.files)) {
      assert.equal(await hash(release.targets[key]), descriptor.previous);
    }
  });
}

test('foreign drift, corrupt archive, symlink and asset collision fail closed', async () => {
  const drift = await fixture();
  await fs.writeFile(drift.targets.server, 'another-release');
  await assert.rejects(publish(drift), /Release drift|Preflight drift/);
  assert.equal(await hash(drift.targets.index), drift.manifest.files.index.previous);

  const corrupt = await fixture();
  await fs.writeFile(`${corrupt.saved}/candidate/server`, 'corrupt');
  await assert.rejects(validateArchive(corrupt.saved), /archive drift/);

  const linked = await fixture();
  await fs.rename(linked.targets.openrouter, `${linked.targets.openrouter}.real`);
  await fs.symlink(`${linked.targets.openrouter}.real`, linked.targets.openrouter);
  await assert.rejects(publish(linked), /regular file/);

  const collision = await fixture();
  await put(`${collision.app}/dist/assets/new.js`, 'collision');
  await assert.rejects(publish(collision), /Asset collision/);
  assert.equal(await hash(collision.targets.index), collision.manifest.files.index.previous);
});

test('validated archive supports repeated publish and rollback cycles', async () => {
  const release = await fixture();
  // A fixed-path artifact from an interrupted older release must not block the
  // new unique-temporary-path implementation.
  await put(`${release.targets.server}.openrouter-release.tmp`, 'stale-temp');
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await publish(release);
    await rollback(release);
  }
  for (const [key, descriptor] of Object.entries(release.manifest.files)) {
    assert.equal(await hash(release.targets[key]), descriptor.previous);
  }
});

test('the live hook propagates final verification failure into publish rollback', async () => {
  const release = await fixture();
  const restarts = [];
  const hooks = createLiveHooks({
    restart: async enabled => { restarts.push(enabled); },
    verify: async () => { throw new Error('final live verification failed'); },
  });

  await assert.rejects(publish({ ...release, hooks }), /previous release restored/);
  assert.deepEqual(restarts, [true, false]);
  for (const [key, descriptor] of Object.entries(release.manifest.files)) {
    assert.equal(await hash(release.targets[key]), descriptor.previous);
  }
});

test('a post-rename write error still rolls back the first managed target', async () => {
  const release = await fixture();
  let first = true;
  let restored = false;
  const write = async (...args) => {
    await atomic(...args);
    if (first) {
      first = false;
      const error = new Error('directory fsync failed after rename');
      error.code = 'EIO';
      throw error;
    }
  };

  await assert.rejects(publish({
    ...release,
    write,
    hooks: async stage => { if (stage === 'restore') restored = true; },
  }), /previous release restored/);

  assert.equal(restored, true);
  for (const [key, descriptor] of Object.entries(release.manifest.files)) {
    assert.equal(await hash(release.targets[key]), descriptor.previous);
  }
});
