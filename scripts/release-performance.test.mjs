import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { inventory } from './release-openrouter.mjs';
import { assertReleaseDriverPath, buildReviewedCandidate, publish, rollback } from './release-performance.mjs';

const TEST_COMMIT = 'b'.repeat(40);
process.env.COVER_RELEASE_COMMIT = TEST_COMMIT;
const digest = (data) => createHash('sha256').update(data).digest('hex');

async function put(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: 'wx' });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-performance-release-test-'));
  const saved = `${root}/backup`;
  const app = `${root}/app`;
  const previous = `${saved}/previous-dist`;
  const candidate = `${saved}/candidate-dist`;
  await put(`${previous}/index.html`, 'previous-index');
  await put(`${previous}/assets/old.js`, 'old-asset');
  await put(`${candidate}/index.html`, 'candidate-index');
  await put(`${candidate}/assets/geminiService-NewHash1.js`, 'export const generationReady = true;');
  await fs.cp(previous, `${app}/dist`, { recursive: true });
  await put(`${app}/server/index.js`, 'previous-server');
  await put(`${saved}/previous/index`, 'previous-index');
  await put(`${saved}/previous/server`, 'previous-server');
  await put(`${saved}/candidate/index`, 'candidate-index');
  await put(`${saved}/candidate/server`, 'candidate-server');
  await put(`${saved}/candidate/cache`, 'candidate-cache');
  await put(`${saved}/support/package-lock.json`, 'test-lock');
  const stat = await fs.stat(`${app}/server/index.js`);
  const owner = { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 };
  const manifest = {
    sourceCommit: TEST_COMMIT,
    build: { sourceCommit: TEST_COMMIT, packageLock: digest('test-lock') },
    files: {
      index: { previous: digest('previous-index'), candidate: digest('candidate-index'), owner },
      server: { previous: digest('previous-server'), candidate: digest('candidate-server'), owner },
      cache: { previous: null, candidate: digest('candidate-cache'), owner },
    },
    previousDist: await inventory(previous),
    candidateDist: await inventory(candidate),
    support: await inventory(`${saved}/support`),
  };
  await put(`${saved}/manifest.json`, `${JSON.stringify(manifest)}\n`);
  return {
    saved,
    app,
    manifest,
    targets: {
      index: `${app}/dist/index.html`,
      server: `${app}/server/index.js`,
      cache: `${app}/server/staticAssetCache.js`,
    },
  };
}

test('builds only the exact reviewed clean commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-performance-build-test-'));
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
  assert.deepEqual(calls.filter(([binary]) => binary === '/usr/bin/npm'), [
    ['/usr/bin/npm', '--version'],
    ['/usr/bin/npm', 'run', 'build'],
  ]);
});

test('post-capture commands reject a mutable checkout driver', () => {
  const backup = '/tmp/frozen-cover-release';
  assert.doesNotThrow(() => assertReleaseDriverPath('capture', '/mutable/release-performance.mjs', backup));
  assert.doesNotThrow(() => assertReleaseDriverPath('deploy', `${backup}/support/scripts/release-performance.mjs`, backup));
  assert.throws(
    () => assertReleaseDriverPath('rollback', '/mutable/release-performance.mjs', backup),
    /verified backup driver/,
  );
});

test('publishes backend before index and rollback restores the exact release', async () => {
  const release = await fixture();
  const events = [];
  await publish({ ...release, hooks: async (stage) => events.push(stage) });
  assert(events.indexOf('written:cache') < events.indexOf('written:server'));
  assert(events.indexOf('written:server') < events.indexOf('backend'));
  assert(events.indexOf('backend') < events.indexOf('index'));
  assert.equal(await fs.readFile(release.targets.index, 'utf8'), 'candidate-index');
  assert.equal(await fs.readFile(release.targets.cache, 'utf8'), 'candidate-cache');

  await rollback(release);
  assert.equal(await fs.readFile(release.targets.index, 'utf8'), 'previous-index');
  assert.equal(await fs.readFile(release.targets.server, 'utf8'), 'previous-server');
  await assert.rejects(fs.lstat(release.targets.cache), (error) => error.code === 'ENOENT');
  const retainedModule = await import(pathToFileURL(`${release.app}/dist/assets/geminiService-NewHash1.js`).href);
  assert.equal(retainedModule.generationReady, true, 'an already-open candidate tab must complete its deferred import');
});

test('a backend activation failure automatically restores assets and server files', async () => {
  const release = await fixture();
  await assert.rejects(publish({
    ...release,
    hooks: async (stage) => {
      if (stage === 'backend') throw new Error('simulated restart failure');
    },
  }), /previous release restored/);
  assert.equal(await fs.readFile(release.targets.server, 'utf8'), 'previous-server');
  await assert.rejects(fs.lstat(release.targets.cache), (error) => error.code === 'ENOENT');
  assert.equal(await fs.readFile(`${release.app}/dist/assets/geminiService-NewHash1.js`, 'utf8'), 'export const generationReady = true;');
});
