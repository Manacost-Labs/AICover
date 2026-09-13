import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inventory } from './release-openrouter.mjs';
import {
  buildReviewedCandidate,
  publish,
  rollback,
} from './release-composition-planner.mjs';

const TEST_COMMIT = 'a'.repeat(40);
process.env.COVER_RELEASE_COMMIT = TEST_COMMIT;

const digest = (data) => createHash('sha256').update(data).digest('hex');

async function put(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, { flag: 'wx' });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-composition-release-test-'));
  const saved = `${root}/backup`;
  const app = `${root}/app`;
  const previous = `${saved}/previous-dist`;
  const candidate = `${saved}/candidate-dist`;
  await put(`${previous}/index.html`, 'previous-index');
  await put(`${previous}/assets/old.js`, 'old-asset');
  await put(`${previous}/fonts/license.txt`, 'old-license');
  await put(`${candidate}/index.html`, 'candidate-index');
  await put(`${candidate}/assets/new.js`, 'new-asset');
  await put(`${candidate}/fonts/license.txt`, 'new-license');
  await fs.cp(previous, `${app}/dist`, { recursive: true });
  const stat = await fs.stat(`${app}/dist/index.html`);
  const manifest = {
    sourceCommit: TEST_COMMIT,
    build: { sourceCommit: TEST_COMMIT, packageLock: digest('test-lock') },
    index: {
      target: `${app}/dist/index.html`,
      previous: digest('previous-index'),
      candidate: digest('candidate-index'),
      owner: { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 },
    },
    previousDist: await inventory(previous),
    candidateDist: await inventory(candidate),
    support: {},
  };
  await put(`${saved}/support/package-lock.json`, 'test-lock');
  manifest.support = await inventory(`${saved}/support`);
  await put(`${saved}/manifest.json`, `${JSON.stringify(manifest)}\n`);
  return { saved, app, manifest };
}

test('builds only the exact reviewed clean commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-composition-build-test-'));
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

test('publishes index last and rollback restores the exact previous dist', async () => {
  const release = await fixture();
  const events = [];
  await publish({ ...release, hooks: async (stage) => events.push(stage) });

  assert(events.indexOf('assets') < events.indexOf('index'));
  assert.equal(await fs.readFile(`${release.app}/dist/index.html`, 'utf8'), 'candidate-index');
  assert.equal(await fs.readFile(`${release.app}/dist/assets/new.js`, 'utf8'), 'new-asset');
  assert.equal(await fs.readFile(`${release.app}/dist/fonts/license.txt`, 'utf8'), 'new-license');

  await rollback(release);
  assert.deepEqual(await inventory(`${release.app}/dist`), release.manifest.previousDist);
  await assert.rejects(fs.lstat(`${release.app}/dist/assets/new.js`), (error) => error.code === 'ENOENT');
});

test('a failure before index activation automatically removes candidate assets', async () => {
  const release = await fixture();
  await assert.rejects(publish({
    ...release,
    hooks: async (stage) => {
      if (stage === 'assets') throw new Error('simulated failure');
    },
  }), /previous release restored/);

  assert.deepEqual(await inventory(`${release.app}/dist`), release.manifest.previousDist);
});
