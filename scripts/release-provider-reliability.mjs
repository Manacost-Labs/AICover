import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs, { constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomic, hash, inventory } from './release-openrouter.mjs';
import { auditProviderContracts } from './verify-provider-contracts.mjs';

export const SOURCE = '/srv/projects/web/AI-cover-worktrees/openrouter-images-20260912';
export const APP = '/var/www/koloda/data/www/cover.hs-manacost.ru/repo';
export const BACKUP = '/var/backups/cover-image/20260913-provider-reliability';

const LOCK = '/run/lock/cover-foundation-release.lock';
const SERVICE = 'cover-image.service';
const SESSION_FILE = '/var/lib/cover-image/chatgpt/sessions.enc';
const SESSION_DIR = '/var/lib/cover-image/chatgpt';
const REVIEWED_COMMIT_ENV = 'COVER_RELEASE_COMMIT';
const BUILD_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

const EXPECTED_BASELINE = Object.freeze({
  index: 'fa8d50cb041adb0fc88e32e1752e409ce0b4ed44471945bd0b43f7329036b079',
  server: 'bbaef641d9646289e304fac36c20fea385169f1022f568ce2de9839be307bdfc',
  openrouter: '52c80d9f0278baf8e5b78f16b5a048db0511c079f7c68d208bde27488c5cef6f',
  models: 'ffdcbd26b7c00414851b901b85026a10e2d884feeaf3063307f26f7f1e5f55f9',
});

const STATIC_GUARDS = Object.freeze({
  [`${APP}/package.json`]: '5f4a16a31bc9379bd8df6a6ccb45ca92bbe31399d3fb848756de3c90b2987798',
  [`${APP}/package-lock.json`]: '17ef5a762eebad14e1f45d1983f6e464b38222c7ef2823398b7d602837829e94',
  '/etc/systemd/system/cover-image.service': '2364e2c3a5328d9b562433c8935393ecb93b88e91627200f97aef7240ebd2434',
  '/etc/systemd/system/cover-image.service.d/30-chatgpt.conf': 'e325a4a991b3203ba93ef4b6b0857f15d7f6bba3c61161d188ebd0997fa94eb6',
  '/etc/systemd/system/cover-image.service.d/35-chatgpt-session.conf': '4febf75e7730af3714c1612428fc811366897a9e6aa0a2e1f024afa9f36f5954',
  '/etc/systemd/system/cover-image.service.d/40-openrouter.conf': 'e74473a1a7c972633f7fa784076931d9897aa47be6727ed39832be532ecb5c28',
  '/etc/cover-image/chatgpt.env': '79e0806c6ab9411371dd1c789e3464a5867cda40c76ec3ebaef166ffba5e341d',
  '/etc/cover-image/chatgpt-session.env': '501577817328047bc2e9016c564c13f6f7d3a5c15e7f6d19d443e1f727320934',
  '/etc/cover-image/openrouter.env': 'ec876f71a7466012916411a99495c532fba4b70ca585b273b00575e642c142b5',
});

export const liveTargets = Object.freeze({
  index: `${APP}/dist/index.html`,
  server: `${APP}/server/index.js`,
  openrouter: `${APP}/server/openrouter-image.js`,
  models: `${APP}/server/openrouter-models.js`,
});

const sourceTargets = Object.freeze({
  index: `${SOURCE}/dist/index.html`,
  server: `${SOURCE}/server/index.js`,
  openrouter: `${SOURCE}/server/openrouter-image.js`,
  models: `${SOURCE}/server/openrouter-models.js`,
});

const MODEL_IDS = Object.freeze([
  'openai/gpt-image-2', 'meta/muse-image', 'recraft/recraft-v4-styles-pro',
  'bytedance-seed/seedream-5-0-lite', 'bytedance-seed/seedream-5-0-pro',
  'x-ai/grok-imagine-image-2.0', 'qwen/qwen-image-3-pro', 'krea/krea-2-large',
  'sourceful/riverflow-v2.5-pro', 'sourceful/riverflow-v2.5-fast',
]);
const GEMINI_IDS = Object.freeze([
  'gemini-2.5-flash-image', 'gemini-3.1-flash-image',
  'gemini-3-pro-image', 'gemini-3.1-flash-lite-image',
]);

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
  await assert.rejects(fs.lstat(BACKUP), (error) => error.code === 'ENOENT', 'Backup path already exists');

  for (const [key, expected] of Object.entries(EXPECTED_BASELINE)) {
    assert.equal(await hash(liveTargets[key]), expected, `Production baseline drift: ${key}`);
  }
  const build = await buildReviewedCandidate({ expectedCommit: reviewedCommit });
  const providerAudit = await auditProviderContracts();
  assert.equal(providerAudit.ok, true, `Provider contract audit failed: ${providerAudit.errors.join('; ')}`);
  const sourceCommit = build.sourceCommit;
  for (const file of Object.values(sourceTargets)) await regular(file);

  await fs.mkdir(BACKUP, { mode: 0o700 });
  const files = {};
  for (const key of Object.keys(liveTargets)) {
    const previous = await fs.readFile(liveTargets[key]);
    const candidate = await fs.readFile(sourceTargets[key]);
    const metadata = await owner(liveTargets[key]);
    await save(`${BACKUP}/previous/${key}`, previous, metadata.mode);
    await save(`${BACKUP}/candidate/${key}`, candidate, metadata.mode);
    files[key] = {
      target: liveTargets[key],
      previous: digest(previous),
      candidate: digest(candidate),
      owner: metadata,
    };
  }

  await fs.cp(`${APP}/dist`, `${BACKUP}/previous-dist`, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${SOURCE}/dist`, `${BACKUP}/candidate-dist`, { recursive: true, force: false, errorOnExist: true });
  const manifest = {
    createdAt: new Date().toISOString(),
    source: SOURCE,
    sourceCommit,
    build,
    providerAudit,
    files,
    previousDist: await inventory(`${BACKUP}/previous-dist`),
    candidateDist: await inventory(`${BACKUP}/candidate-dist`),
    baselineRestarts: Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()),
    staticGuards: STATIC_GUARDS,
    support: {},
  };
  assert.deepEqual(manifest.previousDist, await inventory(`${APP}/dist`));
  assert.deepEqual(manifest.candidateDist, await inventory(`${SOURCE}/dist`));

  for (const relative of [
    'docs/OPENROUTER_IMAGES.md', 'docs/PROVIDER_RELIABILITY.md',
    'scripts/release-provider-reliability.mjs', 'scripts/release-provider-reliability.test.mjs',
    'scripts/verify-provider-contracts.mjs', 'scripts/verify-provider-contracts.test.mjs',
    'package-lock.json',
    'server/openrouter-image.test.js', 'server/openrouter-models.test.js',
    'src/services/geminiService.test.ts', 'src/services/openRouterImages.test.ts',
    'src/components/tabs/CreateTab.test.ts', 'src/components/tabs/ImageToolsTab.test.ts',
  ]) {
    const target = `${BACKUP}/support/${relative}`;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.copyFile(`${SOURCE}/${relative}`, target, constants.COPYFILE_EXCL);
  }
  manifest.support = await inventory(`${BACKUP}/support`);
  await save(`${BACKUP}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { backup: BACKUP, sourceCommit, files: Object.keys(manifest.candidateDist).length };
}

export async function validateArchive(saved = BACKUP) {
  const manifest = await json(`${saved}/manifest.json`);
  const reviewedCommit = expectedReviewedCommit();
  assert.equal(manifest.sourceCommit, reviewedCommit, 'Archived candidate is not the exact reviewed commit');
  assert.equal(manifest.build?.sourceCommit, reviewedCommit, 'Archived build provenance does not match reviewed commit');
  assert.equal(manifest.providerAudit?.ok, true, 'Captured provider contract audit did not pass');
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    assert.equal(await hash(`${saved}/previous/${key}`), descriptor.previous, `Previous archive drift: ${key}`);
    assert.equal(await hash(`${saved}/candidate/${key}`), descriptor.candidate, `Candidate archive drift: ${key}`);
  }
  assert.deepEqual(await inventory(`${saved}/previous-dist`), manifest.previousDist, 'Previous dist archive drift');
  assert.deepEqual(await inventory(`${saved}/candidate-dist`), manifest.candidateDist, 'Candidate dist archive drift');
  assert.deepEqual(await inventory(`${saved}/support`), manifest.support, 'Support archive drift');
  assert.equal(await hash(`${saved}/support/package-lock.json`), manifest.build?.packageLock, 'Archived build lockfile drift');
  return manifest;
}

async function currentTargetHash(target, descriptor) {
  await regular(target);
  const current = await hash(target);
  assert([descriptor.previous, descriptor.candidate].includes(current), `Release drift: ${target}`);
  return current;
}

async function addCandidateAssets(saved, app, manifest) {
  const current = await inventory(`${app}/dist`);
  assert.deepEqual(current, manifest.previousDist, 'Previous dist drift before asset activation');
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    if (relative === 'index.html') continue;
    const target = `${app}/dist/${relative}`;
    const source = `${saved}/candidate-dist/${relative}`;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    const previous = manifest.previousDist[relative];
    if (previous) {
      if (previous === expected) continue;
      const metadata = await owner(target);
      await atomic(target, await fs.readFile(source), previous, metadata);
    } else {
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      await fs.chown(target, manifest.files.index.owner.uid, manifest.files.index.owner.gid);
      await fs.chmod(target, 0o644);
    }
  }
}

async function restorePreviousAssets(saved, app, manifest) {
  const current = await inventory(`${app}/dist`);
  const relatives = new Set([...Object.keys(manifest.previousDist), ...Object.keys(manifest.candidateDist)]);
  relatives.delete('index.html');
  for (const relative of relatives) {
    const target = `${app}/dist/${relative}`;
    const previous = manifest.previousDist[relative];
    const candidate = manifest.candidateDist[relative];
    const active = current[relative];
    if (previous) {
      assert(active === previous || active === candidate, `Asset rollback drift: ${relative}`);
      if (active === candidate && candidate !== previous) {
        const metadata = await owner(target);
        await atomic(target, await fs.readFile(`${saved}/previous-dist/${relative}`), candidate, metadata);
      }
    } else if (active != null) {
      assert.equal(active, candidate, `New asset rollback drift: ${relative}`);
      await fs.unlink(target);
    }
  }
}

export async function rollback({ saved = BACKUP, app, targets = liveTargets, hooks = async () => {} } = {}) {
  const usesLiveTargets = Object.keys(liveTargets).every((key) => targets[key] === liveTargets[key]);
  assert(app || usesLiveTargets, 'Custom rollback targets require an explicit app path');
  const rollbackApp = app || APP;
  const manifest = await validateArchive(saved);
  const restoreOrder = ['models', 'openrouter', 'server', 'index'].filter((key) => manifest.files[key]);
  for (const key of restoreOrder) {
    const descriptor = manifest.files[key];
    const current = await currentTargetHash(targets[key], descriptor);
    if (current !== descriptor.previous) {
      await atomic(targets[key], await fs.readFile(`${saved}/previous/${key}`), descriptor.candidate, descriptor.owner);
    }
  }
  await restorePreviousAssets(saved, rollbackApp, manifest);
  assert.deepEqual(await inventory(`${rollbackApp}/dist`), manifest.previousDist, 'Previous dist was not fully restored');
  await hooks('restore');
  return { rolledBack: true, restoredIndex: manifest.files.index.previous };
}

export async function publish({
  saved = BACKUP,
  app = APP,
  targets = liveTargets,
  hooks = async () => {},
  preflight = async () => {},
  write = atomic,
} = {}) {
  const manifest = await validateArchive(saved);
  await preflight();
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    assert.equal(await currentTargetHash(targets[key], descriptor), descriptor.previous, `Preflight drift: ${key}`);
  }
  let mutated = false;
  try {
    mutated = true;
    await addCandidateAssets(saved, app, manifest);
    for (const key of ['models', 'openrouter', 'server']) {
      const descriptor = manifest.files[key];
      await write(targets[key], await fs.readFile(`${saved}/candidate/${key}`), descriptor.previous, descriptor.owner);
      await hooks(`written:${key}`);
    }
    await hooks('backend');
    const index = manifest.files.index;
    await write(targets.index, await fs.readFile(`${saved}/candidate/index`), index.previous, index.owner);
    await hooks('index');
    await hooks('verify');
    return { deployed: true, candidateIndex: index.candidate, backup: saved };
  } catch (error) {
    if (mutated) await rollback({ saved, app, targets, hooks });
    throw new Error(`Activation failed; previous release restored (${error.code || error.name}).`);
  }
}

export async function checkLocal(expectedIndex, fetchImpl = globalThis.fetch) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const get = (url, timeout = 3_000) => fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
      assert.equal((await get('http://127.0.0.1:3127/api/health')).status, 200);
      const capabilities = await (await get('http://127.0.0.1:3127/api/runtime-capabilities')).json();
      assert.equal(capabilities.gemini, true);
      assert.equal(capabilities.openrouter, true);
      const session = await (await get('http://127.0.0.1:3127/api/chatgpt/session')).json();
      assert.equal(session.enabled, true);

      const rejected = await fetchImpl('http://127.0.0.1:3127/api/thumbnail/openrouter-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://cover.hs-manacost.ru' },
        body: JSON.stringify({ model: 'attacker/not-allowed', prompt: 'must not reach provider', references: [] }),
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).code, 'INVALID_REQUEST');
      assert.equal((await fetchImpl('http://127.0.0.1:3127/api/thumbnail/openrouter-generate', { method: 'GET', signal: AbortSignal.timeout(2_000) })).status, 405);
      if (expectedIndex) {
        const index = await get('http://127.0.0.1:3127/');
        assert.equal(digest(Buffer.from(await index.arrayBuffer())), expectedIndex);
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

export async function checkProviderMetadata(fetchImpl = globalThis.fetch) {
  const get = (url, timeout = 10_000) => fetchImpl(url, { signal: AbortSignal.timeout(timeout) });
  const catalogResponse = await get('http://127.0.0.1:3127/api/thumbnail/openrouter-models');
  assert.equal(catalogResponse.status, 200, 'OpenRouter catalog metadata');
  const catalog = (await catalogResponse.json()).models;
  assert.deepEqual(catalog.map((row) => row.id), MODEL_IDS);
  for (const row of catalog) {
    assert.equal(row.availability, row.id === 'meta/muse-image' ? 'unavailable' : 'available', `${row.id} availability`);
  }
  for (const id of GEMINI_IDS) {
    const response = await get(`http://127.0.0.1:3127/api/gemini/v1beta/models/${id}`);
    assert.equal(response.status, 200, `${id} metadata`);
    assert.equal((await response.json()).supportedGenerationMethods.includes('generateContent'), true, `${id} generateContent`);
  }
}

async function verifyPublicGate(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl('https://cover.hs-manacost.ru/', { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://hearthpulse.net/api/auth/cover/start');
}

let activationSessionHash;
export async function verifyLive(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  await assertStaticGuards();
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    assert.equal(await hash(liveTargets[key]), descriptor.candidate, `Active release drift: ${key}`);
  }
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    assert.equal(await hash(`${APP}/dist/${relative}`), expected, `Candidate asset drift: ${relative}`);
  }
  assert.equal((await fs.stat(SESSION_DIR)).mode & 0o777, 0o700);
  try { assert.equal((await fs.stat(SESSION_FILE)).mode & 0o777, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim(), 'active');
  assert.equal(Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()), manifest.baselineRestarts);
  await checkLocal(manifest.files.index.candidate);
  await verifyPublicGate();
  if (activationSessionHash !== undefined) assert.equal(await hash(SESSION_FILE), activationSessionHash, 'ChatGPT session store changed during activation');
  return { verified: true, sourceCommit: manifest.sourceCommit, providerContracts: true, sessionPersistence: true };
}

function command(binary, args) {
  try { execFileSync(binary, args, { stdio: 'pipe', timeout: 30_000 }); }
  catch { throw new Error(`Release command failed: ${binary} ${args[0] || ''}`); }
}

export const liveHooks = async (stage) => {
  const manifest = await validateArchive();
  if (stage === 'backend') {
    activationSessionHash = await hash(SESSION_FILE);
    command('systemctl', ['restart', SERVICE]);
    await checkLocal();
  }
  if (stage === 'restore') {
    command('systemctl', ['restart', SERVICE]);
    await checkLocal(manifest.files.index.previous);
  }
  if (stage === 'verify') await verifyLive();
};

export async function rehearse(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-provider-release-'));
  const archive = `${root}/backup`;
  const app = `${root}/app`;
  await fs.cp(saved, archive, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${archive}/previous-dist`, `${app}/dist`, { recursive: true, force: false, errorOnExist: true });
  const targets = {
    index: `${app}/dist/index.html`, server: `${app}/server/index.js`,
    openrouter: `${app}/server/openrouter-image.js`, models: `${app}/server/openrouter-models.js`,
  };
  for (const key of Object.keys(targets)) {
    if (key === 'index') continue;
    await fs.mkdir(path.dirname(targets[key]), { recursive: true });
    await fs.copyFile(`${archive}/previous/${key}`, targets[key], constants.COPYFILE_EXCL);
  }
  await publish({ saved: archive, app, targets });
  for (const [key, descriptor] of Object.entries(manifest.files)) assert.equal(await hash(targets[key]), descriptor.candidate);
  await rollback({ saved: archive, app, targets });
  for (const [key, descriptor] of Object.entries(manifest.files)) assert.equal(await hash(targets[key]), descriptor.previous);
  return { rehearsal: root, publishRollback: 'passed', productionTouched: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  assert(['capture', 'rehearse', 'deploy', 'verify', 'rollback'].includes(mode), `Usage: ${REVIEWED_COMMIT_ENV}=<reviewed-sha> release-provider-reliability.mjs capture|rehearse|deploy|verify|rollback`);
  expectedReviewedCommit();
  assert.equal(process.getuid(), 0, 'Release commands require root');
  if (process.env.COVER_RELEASE_LOCK_HELD !== '1') {
    execFileSync('flock', ['-n', LOCK, 'env', 'COVER_RELEASE_LOCK_HELD=1', process.execPath, fileURLToPath(import.meta.url), mode], { stdio: 'inherit' });
    process.exit(0);
  }
  if (mode === 'capture') console.log(JSON.stringify(await capture()));
  if (mode === 'rehearse') console.log(JSON.stringify(await rehearse()));
  if (mode === 'deploy') console.log(JSON.stringify({
    ...await publish({ hooks: liveHooks, preflight: assertStaticGuards }),
    verified: true,
  }));
  if (mode === 'verify') console.log(JSON.stringify(await verifyLive()));
  if (mode === 'rollback') console.log(JSON.stringify(await rollback({ hooks: liveHooks })));
}
