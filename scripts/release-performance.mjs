import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs, { constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomic, hash, inventory } from './release-openrouter.mjs';

export const SOURCE = '/srv/projects/web/AI-cover-worktrees/openrouter-images-20260912';
export const APP = '/var/www/koloda/data/www/cover.hs-manacost.ru/repo';
export const BACKUP = '/var/backups/cover-image/20260913-zul17-performance';

const LOCK = '/run/lock/cover-foundation-release.lock';
const SERVICE = 'cover-image.service';
const SESSION_FILE = '/var/lib/cover-image/chatgpt/sessions.enc';
const SESSION_DIR = '/var/lib/cover-image/chatgpt';
const REVIEWED_COMMIT_ENV = 'COVER_RELEASE_COMMIT';
const BUILD_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

const EXPECTED_BASELINE = Object.freeze({
  index: '95f4d48b6d317bbeb5e514cad6ea46216f9285a3a741a300ce0f992629c63ade',
  server: '05dd9d12f272c48f2e17684a27df35819ff8c49a6d5215ef52e8c39c00217d53',
  cache: null,
});

const STATIC_GUARDS = Object.freeze({
  [`${APP}/package.json`]: '5f4a16a31bc9379bd8df6a6ccb45ca92bbe31399d3fb848756de3c90b2987798',
  [`${APP}/package-lock.json`]: '17ef5a762eebad14e1f45d1983f6e464b38222c7ef2823398b7d602837829e94',
  [`${APP}/server/openrouter-image.js`]: '75bcc427491e0d174d3b41a3eef36483c680a076a7026792f9c6abe65f7b160a',
  [`${APP}/server/openrouter-models.js`]: '450137cac88bbadbce5af40fa3982e2d7b51798e6fbf4216fdd224c02bd85223',
  '/etc/systemd/system/cover-image.service': '2364e2c3a5328d9b562433c8935393ecb93b88e91627200f97aef7240ebd2434',
  '/etc/systemd/system/cover-image.service.d/30-chatgpt.conf': 'e325a4a991b3203ba93ef4b6b0857f15d7f6bba3c61161d188ebd0997fa94eb6',
  '/etc/systemd/system/cover-image.service.d/35-chatgpt-session.conf': '4febf75e7730af3714c1612428fc811366897a9e6aa0a2e1f024afa9f36f5954',
  '/etc/systemd/system/cover-image.service.d/40-openrouter.conf': 'e74473a1a7c972633f7fa784076931d9897aa47be6727ed39832be532ecb5c28',
});

export const liveTargets = Object.freeze({
  index: `${APP}/dist/index.html`,
  server: `${APP}/server/index.js`,
  cache: `${APP}/server/staticAssetCache.js`,
});

const sourceTargets = Object.freeze({
  index: `${SOURCE}/dist/index.html`,
  server: `${SOURCE}/server/index.js`,
  cache: `${SOURCE}/server/staticAssetCache.js`,
});

const digest = (data) => createHash('sha256').update(data).digest('hex');
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

async function regular(file) {
  assert((await fs.lstat(file)).isFile(), `Not a regular file: ${file}`);
}

async function owner(file, fallback) {
  try {
    const stat = await fs.stat(file);
    return { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT' && fallback) return fallback;
    throw error;
  }
}

async function save(file, data, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, data, { flag: 'wx', mode });
}

async function assertStaticGuards() {
  for (const [file, expected] of Object.entries(STATIC_GUARDS)) {
    assert.equal(await hash(file), expected, `Static guard drift: ${file}`);
  }
}

export function expectedReviewedCommit(env = process.env) {
  const value = String(env[REVIEWED_COMMIT_ENV] || '').trim();
  assert.match(value, /^[0-9a-f]{40}$/, `${REVIEWED_COMMIT_ENV} must contain the exact reviewed commit SHA`);
  return value;
}

export async function buildReviewedCandidate({
  source = SOURCE,
  expectedCommit = expectedReviewedCommit(),
  execImpl = execFileSync,
  statImpl = fs.stat,
  hashImpl = hash,
} = {}) {
  const runGit = (args) => String(execImpl('git', args, { cwd: source, encoding: 'utf8' })).trim();
  assert.equal(runGit(['status', '--porcelain']), '', 'Candidate worktree must be committed and clean');
  const sourceCommit = runGit(['rev-parse', 'HEAD']);
  assert.equal(sourceCommit, expectedCommit, 'Candidate HEAD is not the exact reviewed commit');
  const sourceOwner = await statImpl(source);
  const runOptions = {
    cwd: source,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 180_000,
    env: { PATH: BUILD_PATH, NODE_ENV: 'production', CI: '1' },
    ...(process.getuid() === 0 ? { uid: sourceOwner.uid, gid: sourceOwner.gid } : {}),
  };
  const npmVersion = String(execImpl('/usr/bin/npm', ['--version'], runOptions)).trim();
  execImpl('/usr/bin/npm', ['run', 'build'], runOptions);
  assert.equal(runGit(['rev-parse', 'HEAD']), sourceCommit, 'Candidate HEAD changed during build');
  assert.equal(runGit(['status', '--porcelain']), '', 'Candidate worktree changed during build');
  return {
    command: 'npm run build',
    sourceCommit,
    nodeVersion: process.version,
    npmVersion,
    packageLock: await hashImpl(`${source}/package-lock.json`),
  };
}

export async function capture() {
  assert.equal(process.getuid(), 0, 'Capture requires root');
  const reviewedCommit = expectedReviewedCommit();
  await assertStaticGuards();
  await assert.rejects(fs.lstat(BACKUP), (error) => error.code === 'ENOENT', 'Backup path already exists');
  for (const [key, expected] of Object.entries(EXPECTED_BASELINE)) {
    assert.equal(await hash(liveTargets[key]), expected, `Production baseline drift: ${key}`);
  }

  const build = await buildReviewedCandidate({ expectedCommit: reviewedCommit });
  for (const file of Object.values(sourceTargets)) await regular(file);
  const serverOwner = await owner(liveTargets.server);

  await fs.mkdir(BACKUP, { mode: 0o700 });
  await fs.cp(`${APP}/dist`, `${BACKUP}/previous-dist`, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${SOURCE}/dist`, `${BACKUP}/candidate-dist`, { recursive: true, force: false, errorOnExist: true });

  const files = {};
  for (const key of Object.keys(liveTargets)) {
    const previousHash = await hash(liveTargets[key]);
    const candidate = await fs.readFile(sourceTargets[key]);
    const metadata = await owner(liveTargets[key], { ...serverOwner, mode: 0o644 });
    if (previousHash !== null) await save(`${BACKUP}/previous/${key}`, await fs.readFile(liveTargets[key]), metadata.mode);
    await save(`${BACKUP}/candidate/${key}`, candidate, metadata.mode);
    files[key] = {
      target: liveTargets[key],
      previous: previousHash,
      candidate: digest(candidate),
      owner: metadata,
    };
  }

  const supportFiles = [
    'package-lock.json',
    'package.json',
    'docs/PERFORMANCE_RELEASE_V2.md',
    'scripts/measure-performance.mjs',
    'scripts/release-openrouter.mjs',
    'scripts/release-performance.mjs',
    'scripts/release-performance.test.mjs',
    'server/staticAssetCache.js',
    'server/staticAssetCache.test.js',
    'src/services/generationContracts.ts',
    'src/services/generationServiceLoader.ts',
    'src/services/generationServiceLoader.test.ts',
    'src/services/geminiService.ts',
    'src/App.tsx',
    'src/components/tabs/CreateTab.tsx',
    'src/features/image-tools/useImageTools.ts',
    'vite.config.ts',
  ];
  for (const relative of supportFiles) {
    const destination = `${BACKUP}/support/${relative}`;
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(`${SOURCE}/${relative}`, destination, constants.COPYFILE_EXCL);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    source: SOURCE,
    sourceCommit: reviewedCommit,
    build,
    files,
    previousDist: await inventory(`${BACKUP}/previous-dist`),
    candidateDist: await inventory(`${BACKUP}/candidate-dist`),
    support: await inventory(`${BACKUP}/support`),
    baselinePid: Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()),
    baselineRestarts: Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()),
    sessionStore: await sessionStoreState(),
    staticGuards: STATIC_GUARDS,
  };
  assert.deepEqual(manifest.previousDist, await inventory(`${APP}/dist`));
  assert.deepEqual(manifest.candidateDist, await inventory(`${SOURCE}/dist`));
  await save(`${BACKUP}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { backup: BACKUP, sourceCommit: reviewedCommit, candidateFiles: Object.keys(manifest.candidateDist).length };
}

export async function validateArchive(saved = BACKUP) {
  const manifest = await json(`${saved}/manifest.json`);
  const reviewedCommit = expectedReviewedCommit();
  assert.equal(manifest.sourceCommit, reviewedCommit, 'Archived candidate is not the exact reviewed commit');
  assert.equal(manifest.build?.sourceCommit, reviewedCommit, 'Archived build provenance does not match reviewed commit');
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    if (descriptor.previous === null) {
      assert.equal(await hash(`${saved}/previous/${key}`), null, `Unexpected previous archive: ${key}`);
    } else {
      assert.equal(await hash(`${saved}/previous/${key}`), descriptor.previous, `Previous archive drift: ${key}`);
    }
    assert.equal(await hash(`${saved}/candidate/${key}`), descriptor.candidate, `Candidate archive drift: ${key}`);
  }
  assert.deepEqual(await inventory(`${saved}/previous-dist`), manifest.previousDist, 'Previous dist archive drift');
  assert.deepEqual(await inventory(`${saved}/candidate-dist`), manifest.candidateDist, 'Candidate dist archive drift');
  assert.deepEqual(await inventory(`${saved}/support`), manifest.support, 'Support archive drift');
  assert.equal(await hash(`${saved}/support/package-lock.json`), manifest.build?.packageLock, 'Archived package lock drift');
  return manifest;
}

async function addCandidateAssets(saved, app, manifest) {
  assert.deepEqual(await inventory(`${app}/dist`), manifest.previousDist, 'Production dist drift before activation');
  for (const [relative, candidateHash] of Object.entries(manifest.candidateDist)) {
    if (relative === 'index.html') continue;
    const target = `${app}/dist/${relative}`;
    const previousHash = manifest.previousDist[relative] ?? null;
    if (previousHash === candidateHash) continue;
    const metadata = previousHash === null
      ? { ...manifest.files.index.owner, mode: 0o644 }
      : await owner(target);
    await atomic(target, await fs.readFile(`${saved}/candidate-dist/${relative}`), previousHash, metadata);
    assert.equal(await hash(target), candidateHash, `Candidate asset activation failed: ${relative}`);
  }
}

async function restorePreviousAssets(saved, app, manifest) {
  const relatives = new Set([...Object.keys(manifest.previousDist), ...Object.keys(manifest.candidateDist)]);
  relatives.delete('index.html');
  for (const relative of relatives) {
    const target = `${app}/dist/${relative}`;
    const previousHash = manifest.previousDist[relative] ?? null;
    const candidateHash = manifest.candidateDist[relative] ?? null;
    const activeHash = await hash(target);
    if (previousHash !== null) {
      assert([previousHash, candidateHash].includes(activeHash), `Asset rollback drift: ${relative}`);
      if (activeHash !== previousHash) {
        await atomic(target, await fs.readFile(`${saved}/previous-dist/${relative}`), candidateHash, await owner(target));
      }
    } else if (activeHash !== null) {
      assert.equal(activeHash, candidateHash, `New asset rollback drift: ${relative}`);
      // Keep fingerprinted candidate assets for tabs that loaded the candidate
      // index before rollback and may request a deferred chunk afterward.
    }
  }
}

async function assertPreviousReleaseAvailable(app, manifest) {
  for (const [relative, previousHash] of Object.entries(manifest.previousDist)) {
    assert.equal(await hash(`${app}/dist/${relative}`), previousHash, `Previous release asset was not restored: ${relative}`);
  }
  for (const [relative, candidateHash] of Object.entries(manifest.candidateDist)) {
    if (manifest.previousDist[relative] !== undefined) continue;
    assert.equal(await hash(`${app}/dist/${relative}`), candidateHash, `Candidate-only deferred asset was not retained: ${relative}`);
  }
}

async function restoreFile(target, descriptor, previousFile) {
  const current = await hash(target);
  assert([descriptor.previous, descriptor.candidate].includes(current), `Release drift: ${target}`);
  if (current === descriptor.previous) return;
  if (descriptor.previous === null) {
    await fs.unlink(target);
    return;
  }
  await atomic(target, await fs.readFile(previousFile), descriptor.candidate, descriptor.owner);
}

export async function rollback({ saved = BACKUP, app = APP, targets = liveTargets, hooks = async () => {} } = {}) {
  const manifest = await validateArchive(saved);
  await restoreFile(targets.index, manifest.files.index, `${saved}/previous/index`);
  await restoreFile(targets.server, manifest.files.server, `${saved}/previous/server`);
  await restoreFile(targets.cache, manifest.files.cache, `${saved}/previous/cache`);
  await restorePreviousAssets(saved, app, manifest);
  await assertPreviousReleaseAvailable(app, manifest);
  await hooks('restore');
  if (targets.server === liveTargets.server) {
    await validateSessionStore(manifest.sessionStore);
    assert.equal(execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim(), 'active');
  }
  return { rolledBack: true, restoredIndex: manifest.files.index.previous };
}

export async function publish({
  saved = BACKUP,
  app = APP,
  targets = liveTargets,
  hooks = async () => {},
  preflight = async () => {},
} = {}) {
  const manifest = await validateArchive(saved);
  await preflight();
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    assert.equal(await hash(targets[key]), descriptor.previous, `Preflight drift: ${key}`);
  }
  let mutated = false;
  try {
    mutated = true;
    await addCandidateAssets(saved, app, manifest);
    for (const key of ['cache', 'server']) {
      const descriptor = manifest.files[key];
      await atomic(targets[key], await fs.readFile(`${saved}/candidate/${key}`), descriptor.previous, descriptor.owner);
      await hooks(`written:${key}`);
    }
    await hooks('backend');
    const index = manifest.files.index;
    await atomic(targets.index, await fs.readFile(`${saved}/candidate/index`), index.previous, index.owner);
    await hooks('index');
    await hooks('verify');
    return { deployed: true, candidateIndex: index.candidate, backup: saved };
  } catch (error) {
    if (mutated) await rollback({ saved, app, targets, hooks });
    throw new Error(`Activation failed; previous release restored (${error.code || error.name}).`);
  }
}

async function checkLocal(
  expectedIndex,
  manifest,
  expectedAssetCache = 'public, max-age=31536000, immutable',
  fetchImpl = globalThis.fetch,
) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const get = (url, timeout = 3_000) => fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
      assert.equal((await get('http://127.0.0.1:3127/api/health')).status, 200);
      const asset = Object.keys(manifest.candidateDist).find((relative) => /^assets\/index-.*\.js$/.test(relative));
      assert(asset, 'Candidate entry asset is missing');
      const assetResponse = await get(`http://127.0.0.1:3127/${asset}`);
      assert.equal(assetResponse.status, 200);
      assert.equal(assetResponse.headers.get('cache-control'), expectedAssetCache);
      if (expectedAssetCache.includes('immutable')) {
        assert.equal(assetResponse.headers.get('x-content-type-options'), 'nosniff');
      }
      if (expectedIndex) {
        const index = await get('http://127.0.0.1:3127/');
        assert.equal(digest(Buffer.from(await index.arrayBuffer())), expectedIndex);
        assert.match(index.headers.get('cache-control') || '', /no-(cache|store)/);
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function verifyPublicGate(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('https://cover.hs-manacost.ru/', { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://hearthpulse.net/api/auth/cover/start');
}

export async function verifyLive(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  await assertStaticGuards();
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    assert.equal(await hash(liveTargets[key]), descriptor.candidate, `Active release drift: ${key}`);
  }
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    assert.equal(await hash(`${APP}/dist/${relative}`), expected, `Active candidate drift: ${relative}`);
  }
  assert.equal(execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim(), 'active');
  assert.equal(Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()), manifest.baselineRestarts);
  const currentPid = Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim());
  assert.notEqual(currentPid, 0, 'Service has no active PID');
  assert.notEqual(currentPid, manifest.baselinePid, 'Backend release did not restart the service');
  await validateSessionStore(manifest.sessionStore);
  await checkLocal(manifest.files.index.candidate, manifest);
  await verifyPublicGate();
  return { verified: true, sourceCommit: manifest.sourceCommit, immutableAssets: true, sessionPersistence: true };
}

function command(binary, args) {
  try { execFileSync(binary, args, { stdio: 'pipe', timeout: 30_000 }); }
  catch { throw new Error(`Release command failed: ${binary} ${args[0] || ''}`); }
}

export const liveHooks = async (stage) => {
  const manifest = await validateArchive();
  if (stage === 'backend') {
    command('systemctl', ['restart', SERVICE]);
    await checkLocal(null, manifest);
  }
  if (stage === 'restore') {
    command('systemctl', ['restart', SERVICE]);
    const previousManifest = { ...manifest, candidateDist: manifest.previousDist };
    await checkLocal(
      manifest.files.index.previous,
      previousManifest,
      'no-cache, no-store, must-revalidate',
    );
  }
  if (stage === 'verify') await verifyLive();
};

async function sessionStoreState() {
  const directory = await fs.stat(SESSION_DIR);
  const file = await fs.stat(SESSION_FILE);
  return {
    directoryMode: directory.mode & 0o777,
    fileMode: file.mode & 0o777,
  };
}

async function validateSessionStore(expected) {
  const current = await sessionStoreState();
  assert.deepEqual(current, expected, 'ChatGPT session store permissions changed');
}

export function assertReleaseDriverPath(mode, executable, backup = BACKUP) {
  if (mode === 'capture') return;
  assert.equal(
    path.resolve(executable),
    path.resolve(`${backup}/support/scripts/release-performance.mjs`),
    'Post-capture release commands must run from the verified backup driver',
  );
}

export async function rehearse(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-performance-release-'));
  const archive = `${root}/backup`;
  const app = `${root}/app`;
  await fs.cp(saved, archive, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${archive}/previous-dist`, `${app}/dist`, { recursive: true, force: false, errorOnExist: true });
  const targets = {
    index: `${app}/dist/index.html`,
    server: `${app}/server/index.js`,
    cache: `${app}/server/staticAssetCache.js`,
  };
  await fs.mkdir(`${app}/server`, { recursive: true });
  await fs.copyFile(`${archive}/previous/server`, targets.server, constants.COPYFILE_EXCL);
  await publish({ saved: archive, app, targets });
  for (const [key, descriptor] of Object.entries(manifest.files)) assert.equal(await hash(targets[key]), descriptor.candidate);
  await rollback({ saved: archive, app, targets });
  for (const [key, descriptor] of Object.entries(manifest.files)) assert.equal(await hash(targets[key]), descriptor.previous);
  return { rehearsal: root, publishRollback: 'passed', productionTouched: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  assert(['capture', 'rehearse', 'deploy', 'verify', 'rollback'].includes(mode), `Usage: ${REVIEWED_COMMIT_ENV}=<reviewed-sha> release-performance.mjs capture|rehearse|deploy|verify|rollback`);
  expectedReviewedCommit();
  assertReleaseDriverPath(mode, fileURLToPath(import.meta.url));
  assert.equal(process.getuid(), 0, 'Release commands require root');
  if (process.env.COVER_RELEASE_LOCK_HELD !== '1') {
    execFileSync('flock', ['-n', LOCK, 'env', 'COVER_RELEASE_LOCK_HELD=1', process.execPath, fileURLToPath(import.meta.url), mode], { stdio: 'inherit' });
    process.exit(0);
  }
  if (mode === 'capture') console.log(JSON.stringify(await capture()));
  if (mode === 'rehearse') console.log(JSON.stringify(await rehearse()));
  if (mode === 'deploy') console.log(JSON.stringify({ ...await publish({ hooks: liveHooks, preflight: assertStaticGuards }), verified: true }));
  if (mode === 'verify') console.log(JSON.stringify(await verifyLive()));
  if (mode === 'rollback') console.log(JSON.stringify(await rollback({ hooks: liveHooks })));
}
