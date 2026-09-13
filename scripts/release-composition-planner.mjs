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
export const BACKUP = '/var/backups/cover-image/20260913-zul16-composition-planner';

const LOCK = '/run/lock/cover-foundation-release.lock';
const SERVICE = 'cover-image.service';
const SESSION_FILE = '/var/lib/cover-image/chatgpt/sessions.enc';
const REVIEWED_COMMIT_ENV = 'COVER_RELEASE_COMMIT';
const BUILD_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const EXPECTED_INDEX = '6ef93d85dce4688f89024b6cdb34f9b366f5069bbfb50dc59717e379d42eecec';

const STATIC_GUARDS = Object.freeze({
  [`${APP}/package.json`]: '5f4a16a31bc9379bd8df6a6ccb45ca92bbe31399d3fb848756de3c90b2987798',
  [`${APP}/package-lock.json`]: '17ef5a762eebad14e1f45d1983f6e464b38222c7ef2823398b7d602837829e94',
  [`${APP}/server/index.js`]: '05dd9d12f272c48f2e17684a27df35819ff8c49a6d5215ef52e8c39c00217d53',
  [`${APP}/server/openrouter-image.js`]: '75bcc427491e0d174d3b41a3eef36483c680a076a7026792f9c6abe65f7b160a',
  [`${APP}/server/openrouter-models.js`]: '450137cac88bbadbce5af40fa3982e2d7b51798e6fbf4216fdd224c02bd85223',
  '/etc/systemd/system/cover-image.service': '2364e2c3a5328d9b562433c8935393ecb93b88e91627200f97aef7240ebd2434',
  '/etc/systemd/system/cover-image.service.d/30-chatgpt.conf': 'e325a4a991b3203ba93ef4b6b0857f15d7f6bba3c61161d188ebd0997fa94eb6',
  '/etc/systemd/system/cover-image.service.d/35-chatgpt-session.conf': '4febf75e7730af3714c1612428fc811366897a9e6aa0a2e1f024afa9f36f5954',
  '/etc/systemd/system/cover-image.service.d/40-openrouter.conf': 'e74473a1a7c972633f7fa784076931d9897aa47be6727ed39832be532ecb5c28',
});

const digest = (data) => createHash('sha256').update(data).digest('hex');
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

async function regular(file) {
  assert((await fs.lstat(file)).isFile(), `Not a regular file: ${file}`);
}

async function owner(file) {
  const stat = await fs.stat(file);
  return { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 };
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
  assert.equal(await hash(`${APP}/dist/index.html`), EXPECTED_INDEX, 'Production index baseline drift');
  await assert.rejects(fs.lstat(BACKUP), (error) => error.code === 'ENOENT', 'Backup path already exists');
  const build = await buildReviewedCandidate({ expectedCommit: reviewedCommit });
  await regular(`${SOURCE}/dist/index.html`);
  await regular(`${APP}/dist/index.html`);

  const previousIndex = await fs.readFile(`${APP}/dist/index.html`);
  const candidateIndex = await fs.readFile(`${SOURCE}/dist/index.html`);
  const indexOwner = await owner(`${APP}/dist/index.html`);
  await fs.mkdir(BACKUP, { mode: 0o700 });
  await fs.cp(`${APP}/dist`, `${BACKUP}/previous-dist`, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${SOURCE}/dist`, `${BACKUP}/candidate-dist`, { recursive: true, force: false, errorOnExist: true });

  const supportFiles = [
    'package-lock.json',
    'docs/COMPOSITION_PLANNER_RELEASE.md',
    'scripts/release-composition-planner.mjs',
    'scripts/release-composition-planner.test.mjs',
    'src/services/compositionPlanner.ts',
    'src/services/compositionPlanner.test.ts',
    'src/services/geminiService.ts',
    'src/services/geminiService.test.ts',
    'src/services/chatgptImages.test.ts',
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
    index: {
      target: `${APP}/dist/index.html`,
      previous: digest(previousIndex),
      candidate: digest(candidateIndex),
      owner: indexOwner,
    },
    previousDist: await inventory(`${BACKUP}/previous-dist`),
    candidateDist: await inventory(`${BACKUP}/candidate-dist`),
    support: await inventory(`${BACKUP}/support`),
    baselinePid: Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()),
    baselineRestarts: Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()),
    sessionHash: await hash(SESSION_FILE),
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
  assert.deepEqual(await inventory(`${saved}/previous-dist`), manifest.previousDist, 'Previous dist archive drift');
  assert.deepEqual(await inventory(`${saved}/candidate-dist`), manifest.candidateDist, 'Candidate dist archive drift');
  assert.deepEqual(await inventory(`${saved}/support`), manifest.support, 'Support archive drift');
  assert.equal(await hash(`${saved}/support/package-lock.json`), manifest.build?.packageLock, 'Archived lockfile drift');
  assert.equal(await hash(`${saved}/previous-dist/index.html`), manifest.index.previous, 'Previous index archive drift');
  assert.equal(await hash(`${saved}/candidate-dist/index.html`), manifest.index.candidate, 'Candidate index archive drift');
  return manifest;
}

async function addCandidateAssets(saved, app, manifest) {
  for (const [relative, candidateHash] of Object.entries(manifest.candidateDist)) {
    if (relative === 'index.html') continue;
    const target = `${app}/dist/${relative}`;
    const source = `${saved}/candidate-dist/${relative}`;
    const previousHash = manifest.previousDist[relative] ?? null;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    if (previousHash === null) {
      await atomic(target, await fs.readFile(source), null, {
        ...manifest.index.owner,
        mode: 0o644,
      });
    } else if (previousHash !== candidateHash) {
      await atomic(target, await fs.readFile(source), previousHash, await owner(target));
    }
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
    const currentHash = await hash(target);
    if (previousHash !== null) {
      assert([previousHash, candidateHash].includes(currentHash), `Asset rollback drift: ${relative}`);
      if (currentHash === candidateHash && candidateHash !== previousHash) {
        await atomic(target, await fs.readFile(`${saved}/previous-dist/${relative}`), candidateHash, await owner(target));
      }
    } else if (currentHash !== null) {
      assert.equal(currentHash, candidateHash, `New asset rollback drift: ${relative}`);
      await fs.unlink(target);
    }
  }
}

export async function rollback({ saved = BACKUP, app = APP, hooks = async () => {} } = {}) {
  const manifest = await validateArchive(saved);
  const index = `${app}/dist/index.html`;
  const currentIndex = await hash(index);
  assert([manifest.index.previous, manifest.index.candidate].includes(currentIndex), 'Index rollback drift');
  if (currentIndex === manifest.index.candidate && manifest.index.candidate !== manifest.index.previous) {
    await atomic(index, await fs.readFile(`${saved}/previous-dist/index.html`), manifest.index.candidate, await owner(index));
  }
  await restorePreviousAssets(saved, app, manifest);
  assert.deepEqual(await inventory(`${app}/dist`), manifest.previousDist, 'Previous dist was not fully restored');
  await hooks('restore');
  return { rolledBack: true, restoredIndex: manifest.index.previous };
}

export async function publish({
  saved = BACKUP,
  app = APP,
  hooks = async () => {},
  preflight = async () => {},
} = {}) {
  const manifest = await validateArchive(saved);
  await preflight();
  assert.deepEqual(await inventory(`${app}/dist`), manifest.previousDist, 'Production dist drift before activation');
  let mutated = false;
  try {
    mutated = true;
    await addCandidateAssets(saved, app, manifest);
    await hooks('assets');
    const index = `${app}/dist/index.html`;
    await atomic(index, await fs.readFile(`${saved}/candidate-dist/index.html`), manifest.index.previous, await owner(index));
    await hooks('index');
    await hooks('verify');
    return { deployed: true, candidateIndex: manifest.index.candidate, backup: saved };
  } catch (error) {
    if (mutated) await rollback({ saved, app, hooks });
    throw new Error(`Activation failed; previous release restored (${error.code || error.name}).`);
  }
}

async function checkLocal(expectedIndex, fetchImpl = globalThis.fetch) {
  const get = (url, timeout = 4_000) => fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
  assert.equal((await get('http://127.0.0.1:3127/api/health')).status, 200);
  const index = await get('http://127.0.0.1:3127/');
  assert.equal(index.status, 200);
  assert.equal(digest(Buffer.from(await index.arrayBuffer())), expectedIndex);
}

async function verifyPublicGate(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('https://cover.hs-manacost.ru/', {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://hearthpulse.net/api/auth/cover/start');
}

export async function verifyLive(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  await assertStaticGuards();
  assert.equal(await hash(`${APP}/dist/index.html`), manifest.index.candidate, 'Active index drift');
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    assert.equal(await hash(`${APP}/dist/${relative}`), expected, `Active candidate drift: ${relative}`);
  }
  assert.equal(execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim(), 'active');
  assert.equal(Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()), manifest.baselinePid, 'Frontend-only release restarted the service');
  assert.equal(Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()), manifest.baselineRestarts, 'Service restart count changed');
  assert.equal(await hash(SESSION_FILE), manifest.sessionHash, 'ChatGPT session store changed during frontend activation');
  await checkLocal(manifest.index.candidate);
  await verifyPublicGate();
  return { verified: true, sourceCommit: manifest.sourceCommit, serviceRestarted: false, sessionPersistence: true };
}

export async function rehearse(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-composition-release-'));
  const archive = `${root}/backup`;
  const app = `${root}/app`;
  await fs.cp(saved, archive, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${archive}/previous-dist`, `${app}/dist`, { recursive: true, force: false, errorOnExist: true });
  await publish({ saved: archive, app });
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    assert.equal(await hash(`${app}/dist/${relative}`), expected, `Rehearsal candidate drift: ${relative}`);
  }
  await rollback({ saved: archive, app });
  assert.deepEqual(await inventory(`${app}/dist`), manifest.previousDist);
  return { rehearsal: root, publishRollback: 'passed', productionTouched: false };
}

const liveHooks = async (stage) => {
  if (stage === 'verify') await verifyLive();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  assert(['capture', 'rehearse', 'deploy', 'verify', 'rollback'].includes(mode), `Usage: ${REVIEWED_COMMIT_ENV}=<reviewed-sha> release-composition-planner.mjs capture|rehearse|deploy|verify|rollback`);
  expectedReviewedCommit();
  assert.equal(process.getuid(), 0, 'Release commands require root');
  if (process.env.COVER_RELEASE_LOCK_HELD !== '1') {
    execFileSync('flock', ['-n', LOCK, 'env', 'COVER_RELEASE_LOCK_HELD=1', process.execPath, fileURLToPath(import.meta.url), mode], { stdio: 'inherit' });
    process.exit(0);
  }
  if (mode === 'capture') console.log(JSON.stringify(await capture()));
  if (mode === 'rehearse') console.log(JSON.stringify(await rehearse()));
  if (mode === 'deploy') console.log(JSON.stringify({ ...await publish({ hooks: liveHooks, preflight: assertStaticGuards }), verified: true }));
  if (mode === 'verify') console.log(JSON.stringify(await verifyLive()));
  if (mode === 'rollback') console.log(JSON.stringify(await rollback()));
}
