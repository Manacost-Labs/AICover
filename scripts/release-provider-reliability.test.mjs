import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hash, inventory } from './release-openrouter.mjs';
import { buildReviewedCandidate, publish, rollback, validateArchive } from './release-provider-reliability.mjs';

const TEST_COMMIT = 'a'.repeat(40);
process.env.COVER_RELEASE_COMMIT = TEST_COMMIT;

const digest = (data) => createHash('sha256').update(data).digest('hex');
async function put(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: 'wx' });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-provider-release-test-'));
  const saved = `${root}/backup`;
  const app = `${root}/app`;
  const targets = {
    index: `${app}/dist/index.html`, server: `${app}/server/index.js`,
    openrouter: `${app}/server/openrouter-image.js`, models: `${app}/server/openrouter-models.js`,
  };
  const manifest = {
    sourceCommit: TEST_COMMIT,
    build: { sourceCommit: TEST_COMMIT, packageLock: digest('test-lock') },
    providerAudit: { ok: true, errors: [] },
    files: {}, previousDist: {}, candidateDist: {}, support: {}, baselineRestarts: 0,
  };
  for (const [key, target] of Object.entries(targets)) {
    const previous = `previous-${key}`;
    const candidate = `candidate-${key}`;
    await put(target, previous);
    await put(`${saved}/previous/${key}`, previous);
    await put(`${saved}/candidate/${key}`, candidate);
    manifest.files[key] = {
      target, previous: digest(previous), candidate: digest(candidate),
      owner: { uid: process.getuid(), gid: process.getgid(), mode: 0o644 },
    };
  }
  await put(`${app}/dist/assets/old.js`, 'old');
  await put(`${saved}/previous-dist/index.html`, 'previous-index');
  await put(`${saved}/previous-dist/assets/old.js`, 'old');
  await put(`${saved}/candidate-dist/index.html`, 'candidate-index');
  await put(`${saved}/candidate-dist/assets/new.js`, 'new');
  await put(`${saved}/support/evidence`, 'verified');
  await put(`${saved}/support/package-lock.json`, 'test-lock');
  manifest.previousDist = await inventory(`${saved}/previous-dist`);
  manifest.candidateDist = await inventory(`${saved}/candidate-dist`);
  manifest.support = await inventory(`${saved}/support`);
  await put(`${saved}/manifest.json`, JSON.stringify(manifest));
  return { saved, app, targets, manifest };
}

test('builds only the exact reviewed clean commit and rechecks it afterward', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-provider-build-test-'));
  await put(`${root}/package-lock.json`, 'locked');
  const calls = [];
  const execImpl = (binary, args) => {
    calls.push([binary, ...args]);
    if (binary === 'git' && args[0] === 'status') return '';
    if (binary === 'git' && args[0] === 'rev-parse') return `${TEST_COMMIT}\n`;
    if (binary === '/usr/bin/npm' && args[0] === '--version') return '10.9.0\n';
    if (binary === '/usr/bin/npm' && args[0] === 'run') return '';
    throw new Error(`Unexpected command: ${binary}`);
  };
  const build = await buildReviewedCandidate({
    source: root,
    expectedCommit: TEST_COMMIT,
    execImpl,
    statImpl: async () => ({ uid: process.getuid(), gid: process.getgid() }),
  });
  assert.equal(build.sourceCommit, TEST_COMMIT);
  assert.equal(build.npmVersion, '10.9.0');
  assert.deepEqual(calls.filter(([binary]) => binary === '/usr/bin/npm'), [
    ['/usr/bin/npm', '--version'],
    ['/usr/bin/npm', 'run', 'build'],
  ]);
  assert.equal(calls.filter(([binary, command]) => binary === 'git' && command === 'rev-parse').length, 2);
  assert.equal(calls.filter(([binary, command]) => binary === 'git' && command === 'status').length, 2);
});

test('rejects a clean commit that does not match the reviewed SHA before building', async () => {
  let built = false;
  await assert.rejects(buildReviewedCandidate({
    source: '/candidate',
    expectedCommit: TEST_COMMIT,
    execImpl: (binary, args) => {
      if (binary === 'git' && args[0] === 'status') return '';
      if (binary === 'git' && args[0] === 'rev-parse') return `${'b'.repeat(40)}\n`;
      if (binary === '/usr/bin/npm') built = true;
      return '';
    },
    statImpl: async () => ({ uid: process.getuid(), gid: process.getgid() }),
  }), /exact reviewed commit/);
  assert.equal(built, false);
});

test('publishes backend before the index and restores the exact baseline', async () => {
  const release = await fixture();
  const events = [];
  await publish({ ...release, hooks: async (stage) => events.push(stage) });
  assert(events.indexOf('backend') < events.indexOf('index'));
  for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.candidate);
  await rollback(release);
  for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.previous);
});

test('a failed live preflight does not add assets or mutate a target', async () => {
  const release = await fixture();
  await assert.rejects(publish({
    ...release,
    preflight: async () => { throw new Error('static guard drift'); },
  }), /static guard drift/);
  for (const [key, descriptor] of Object.entries(release.manifest.files)) {
    assert.equal(await hash(release.targets[key]), descriptor.previous);
  }
  await assert.rejects(fs.lstat(`${release.app}/dist/assets/new.js`), (error) => error.code === 'ENOENT');
});

for (const failure of ['written:models', 'written:openrouter', 'written:server', 'backend', 'index', 'verify']) {
  test(`failure at ${failure} restores the previous release`, async () => {
    const release = await fixture();
    await assert.rejects(publish({ ...release, hooks: async (stage) => {
      if (stage === failure) throw new Error('simulated failure');
    } }), /previous release restored/);
    for (const [key, descriptor] of Object.entries(release.manifest.files)) assert.equal(await hash(release.targets[key]), descriptor.previous);
  });
}

test('foreign drift and a corrupt archive fail closed', async () => {
  const drift = await fixture();
  await fs.writeFile(drift.targets.server, 'foreign-release');
  await assert.rejects(publish(drift), /Release drift|Preflight drift/);

  const corrupt = await fixture();
  await fs.writeFile(`${corrupt.saved}/candidate/models`, 'corrupt');
  await assert.rejects(validateArchive(corrupt.saved), /archive drift/);
});
