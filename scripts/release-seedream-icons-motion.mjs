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
export const BACKUP = '/var/backups/cover-image/20260913-seedream-icons-motion';

const LOCK = '/run/lock/cover-foundation-release.lock';
const SERVICE = 'cover-image.service';
const SESSION_FILE = '/var/lib/cover-image/chatgpt/sessions.enc';
const SESSION_DIR = '/var/lib/cover-image/chatgpt';
const UNIT = '/etc/systemd/system/cover-image.service';
const CHATGPT_DROP = '/etc/systemd/system/cover-image.service.d/30-chatgpt.conf';
const SESSION_DROP = '/etc/systemd/system/cover-image.service.d/35-chatgpt-session.conf';
const OPENROUTER_DROP = '/etc/systemd/system/cover-image.service.d/40-openrouter.conf';
const CHATGPT_ENV = '/etc/cover-image/chatgpt.env';
const SESSION_ENV = '/etc/cover-image/chatgpt-session.env';
const OPENROUTER_ENV = '/etc/cover-image/openrouter.env';

const EXPECTED = Object.freeze({
  index: '139bfe879a4c33cb28dd537b19f3a188a3b87932c99d0dfa76c105ab1a1a9683',
  server: 'ad08730741a4aad9a34b30c6c8e0970bc91ef4b8b088a1bd737d4d3f409d37bd',
  openrouter: 'dc0be4272a3a81904c68e8d01031b262de71445b89788a556cb6c6542e5f6ff6',
  unit: '2364e2c3a5328d9b562433c8935393ecb93b88e91627200f97aef7240ebd2434',
  chatgptDrop: 'e325a4a991b3203ba93ef4b6b0857f15d7f6bba3c61161d188ebd0997fa94eb6',
  sessionDrop: '4febf75e7730af3714c1612428fc811366897a9e6aa0a2e1f024afa9f36f5954',
  openrouterDrop: 'e74473a1a7c972633f7fa784076931d9897aa47be6727ed39832be532ecb5c28',
  chatgptEnv: '79e0806c6ab9411371dd1c789e3464a5867cda40c76ec3ebaef166ffba5e341d',
  sessionEnv: '501577817328047bc2e9016c564c13f6f7d3a5c15e7f6d19d443e1f727320934',
  openrouterEnv: 'ec876f71a7466012916411a99495c532fba4b70ca585b273b00575e642c142b5',
  package: '5f4a16a31bc9379bd8df6a6ccb45ca92bbe31399d3fb848756de3c90b2987798',
  lock: '17ef5a762eebad14e1f45d1983f6e464b38222c7ef2823398b7d602837829e94',
});

const digest = data => createHash('sha256').update(data).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export const liveTargets = Object.freeze({
  index: `${APP}/dist/index.html`,
  server: `${APP}/server/index.js`,
  openrouter: `${APP}/server/openrouter-image.js`,
  models: `${APP}/server/openrouter-models.js`,
});

async function regular(file, allowMissing = false) {
  try {
    assert((await fs.lstat(file)).isFile(), `Not a regular file: ${file}`);
    return true;
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function save(file, data, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, data, { flag: 'wx', mode });
}

async function owner(file, fallback) {
  try {
    const stat = await fs.stat(file);
    return { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function assertStaticGuards() {
  const guards = [
    [UNIT, EXPECTED.unit], [CHATGPT_DROP, EXPECTED.chatgptDrop], [SESSION_DROP, EXPECTED.sessionDrop],
    [OPENROUTER_DROP, EXPECTED.openrouterDrop], [CHATGPT_ENV, EXPECTED.chatgptEnv],
    [SESSION_ENV, EXPECTED.sessionEnv], [OPENROUTER_ENV, EXPECTED.openrouterEnv],
    [`${APP}/package.json`, EXPECTED.package], [`${APP}/package-lock.json`, EXPECTED.lock],
  ];
  for (const [file, expected] of guards) assert.equal(await hash(file), expected, `Static guard drift: ${file}`);
}

export async function capture() {
  assert.equal(process.getuid(), 0, 'Capture requires root');
  await assertStaticGuards();
  await assert.rejects(fs.lstat(BACKUP), error => error.code === 'ENOENT', 'Backup path already exists');
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: SOURCE, encoding: 'utf8' }).trim();
  assert.equal(dirty, '', 'Candidate worktree must be committed and clean');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SOURCE, encoding: 'utf8' }).trim();

  for (const [key, expected] of Object.entries({ index: EXPECTED.index, server: EXPECTED.server, openrouter: EXPECTED.openrouter })) {
    assert.equal(await hash(liveTargets[key]), expected, `Production baseline drift: ${key}`);
  }
  assert.equal(await hash(liveTargets.models), null, 'OpenRouter model catalog module already exists');

  const sourceFiles = {
    index: `${SOURCE}/dist/index.html`,
    server: `${SOURCE}/server/index.js`,
    openrouter: `${SOURCE}/server/openrouter-image.js`,
    models: `${SOURCE}/server/openrouter-models.js`,
  };
  for (const file of Object.values(sourceFiles)) await regular(file);

  await fs.mkdir(BACKUP, { mode: 0o700 });
  const appOwner = await owner(liveTargets.index, { uid: 0, gid: 0, mode: 0o644 });
  const files = {
    index: { target: liveTargets.index, previous: await fs.readFile(liveTargets.index), candidate: await fs.readFile(sourceFiles.index), owner: appOwner },
    server: { target: liveTargets.server, previous: await fs.readFile(liveTargets.server), candidate: await fs.readFile(sourceFiles.server), owner: await owner(liveTargets.server, appOwner) },
    openrouter: { target: liveTargets.openrouter, previous: await fs.readFile(liveTargets.openrouter), candidate: await fs.readFile(sourceFiles.openrouter), owner: await owner(liveTargets.openrouter, appOwner) },
    models: { target: liveTargets.models, previous: null, candidate: await fs.readFile(sourceFiles.models), owner: await owner(`${APP}/server`, appOwner).then(value => ({ ...value, mode: 0o644 })) },
  };
  const manifest = {
    createdAt: new Date().toISOString(), source: SOURCE, sourceCommit, files: {},
    previousDist: {}, candidateDist: {}, support: {},
    baselineRestarts: Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()),
  };
  for (const [key, descriptor] of Object.entries(files)) {
    if (descriptor.previous) await save(`${BACKUP}/previous/${key}`, descriptor.previous);
    await save(`${BACKUP}/candidate/${key}`, descriptor.candidate, descriptor.owner.mode);
    manifest.files[key] = {
      target: descriptor.target,
      previous: descriptor.previous ? digest(descriptor.previous) : null,
      candidate: digest(descriptor.candidate),
      owner: descriptor.owner,
    };
  }
  await fs.cp(`${APP}/dist`, `${BACKUP}/previous-dist`, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${SOURCE}/dist`, `${BACKUP}/candidate-dist`, { recursive: true, force: false, errorOnExist: true });
  manifest.previousDist = await inventory(`${BACKUP}/previous-dist`);
  manifest.candidateDist = await inventory(`${BACKUP}/candidate-dist`);
  assert.deepEqual(manifest.previousDist, await inventory(`${APP}/dist`));
  assert.deepEqual(manifest.candidateDist, await inventory(`${SOURCE}/dist`));

  for (const relative of [
    'scripts/release-openrouter.mjs', 'scripts/release-seedream-icons-motion.mjs',
    'scripts/release-seedream-icons-motion.test.mjs', 'docs/SEEDREAM_ICONS_MOTION_RELEASE.md',
    'server/openrouter-image.test.js', 'server/openrouter-models.test.js',
    'src/services/openRouterImages.test.ts', 'src/services/openRouterReferenceComposer.test.ts',
    'src/services/geminiService.test.ts', 'src/components/ui/ChatGptConnection.test.ts',
    'src/components/tabs/CreateTab.test.ts', 'src/assets/model-logos/lobe-icons-LICENSE.txt',
  ]) {
    const target = `${BACKUP}/support/${relative}`;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.copyFile(`${SOURCE}/${relative}`, target, constants.COPYFILE_EXCL);
  }
  manifest.support = await inventory(`${BACKUP}/support`);
  await save(`${BACKUP}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { backup: BACKUP, sourceCommit, candidateIndex: manifest.files.index.candidate, candidateFiles: Object.keys(manifest.candidateDist).length };
}

export async function validateArchive(saved = BACKUP) {
  const manifest = await json(`${saved}/manifest.json`);
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    assert.equal(await hash(`${saved}/candidate/${key}`), descriptor.candidate, `Candidate archive drift: ${key}`);
    if (descriptor.previous) assert.equal(await hash(`${saved}/previous/${key}`), descriptor.previous, `Previous archive drift: ${key}`);
  }
  assert.deepEqual(await inventory(`${saved}/previous-dist`), manifest.previousDist, 'Previous dist archive drift');
  assert.deepEqual(await inventory(`${saved}/candidate-dist`), manifest.candidateDist, 'Candidate dist archive drift');
  assert.deepEqual(await inventory(`${saved}/support`), manifest.support, 'Support archive drift');
  return manifest;
}

async function targetState(target, descriptor) {
  if (!await regular(target, true)) return null;
  const current = await hash(target);
  assert([descriptor.previous, descriptor.candidate].includes(current), `Release drift: ${target}`);
  return current;
}

async function addCandidateAssets(saved, app, manifest) {
  const existing = await inventory(`${app}/dist`);
  for (const [relative, expected] of Object.entries(manifest.previousDist)) {
    if (relative !== 'index.html') assert.equal(existing[relative], expected, `Previous asset drift: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    if (relative === 'index.html') continue;
    const target = `${app}/dist/${relative}`;
    const source = `${saved}/candidate-dist/${relative}`;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    if (await regular(target, true)) assert.equal(await hash(target), expected, `Asset collision: ${relative}`);
    else {
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      await fs.chown(target, manifest.files.index.owner.uid, manifest.files.index.owner.gid);
      await fs.chmod(target, 0o644);
      assert.equal(await hash(target), expected, `Asset copy failed: ${relative}`);
    }
  }
}

async function retire(file, saved, key) {
  await regular(file);
  const directory = await fs.mkdtemp(`${saved}/retired-${key}-`);
  await fs.rename(file, `${directory}/file`);
}

export async function rollback({ saved = BACKUP, app = APP, targets = liveTargets, hooks = async () => {} } = {}) {
  const manifest = await validateArchive(saved);
  for (const [key, descriptor] of Object.entries(manifest.files)) await targetState(targets[key], descriptor);
  for (const key of ['index', 'server', 'openrouter', 'models']) {
    const descriptor = manifest.files[key];
    const current = await targetState(targets[key], descriptor);
    if (current === descriptor.previous) continue;
    if (descriptor.previous) await atomic(targets[key], await fs.readFile(`${saved}/previous/${key}`), descriptor.candidate, descriptor.owner);
    else if (current === descriptor.candidate) await retire(targets[key], saved, key);
  }
  await hooks('restore');
  return { rolledBack: true, restoredIndex: manifest.files.index.previous };
}

export async function publish({ saved = BACKUP, app = APP, targets = liveTargets, hooks = async () => {}, write = atomic } = {}) {
  const manifest = await validateArchive(saved);
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    assert.equal(await targetState(targets[key], descriptor), descriptor.previous, `Preflight drift: ${key}`);
  }
  await addCandidateAssets(saved, app, manifest);
  let mutated = false;
  try {
    for (const key of ['models', 'openrouter', 'server']) {
      mutated = true;
      const descriptor = manifest.files[key];
      await write(targets[key], await fs.readFile(`${saved}/candidate/${key}`), descriptor.previous, descriptor.owner);
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

function command(binary, args) {
  try { execFileSync(binary, args, { stdio: 'pipe', timeout: 30_000 }); }
  catch { throw new Error(`Release command failed: ${binary} ${args[0] || ''}`); }
}

const EXPECTED_MODEL_IDS = Object.freeze([
  'openai/gpt-image-2', 'meta/muse-image', 'recraft/recraft-v4-styles-pro',
  'bytedance-seed/seedream-5-0-lite', 'bytedance-seed/seedream-5-0-pro',
  'x-ai/grok-imagine-image-2.0', 'qwen/qwen-image-3-pro', 'krea/krea-2-large',
  'sourceful/riverflow-v2.5-pro', 'sourceful/riverflow-v2.5-fast',
]);

export async function checkLocal(expectedIndex, candidateCatalog = true) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const health = await fetch('http://127.0.0.1:3127/api/health', { signal: AbortSignal.timeout(2_000) });
      assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
      const capabilities = await (await fetch('http://127.0.0.1:3127/api/runtime-capabilities', { signal: AbortSignal.timeout(2_000) })).json();
      assert.equal(capabilities.gemini, true); assert.equal(capabilities.openrouter, true);
      const session = await (await fetch('http://127.0.0.1:3127/api/chatgpt/session', { signal: AbortSignal.timeout(2_000) })).json();
      assert.equal(session.enabled, true);
      if (candidateCatalog) {
        const catalogResponse = await fetch('http://127.0.0.1:3127/api/thumbnail/openrouter-models', { signal: AbortSignal.timeout(7_000) });
        assert.equal(catalogResponse.status, 200);
        const catalog = (await catalogResponse.json()).models;
        assert.deepEqual(catalog.map(row => row.id), EXPECTED_MODEL_IDS);
        for (const id of ['bytedance-seed/seedream-5-0-lite', 'bytedance-seed/seedream-5-0-pro']) {
          assert.equal(catalog.find(row => row.id === id)?.availability, 'available', `${id} endpoint unavailable`);
        }
      }
      for (const model of ['attacker/not-allowed', '__proto__']) {
        const rejected = await fetch('http://127.0.0.1:3127/api/thumbnail/openrouter-generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://cover.hs-manacost.ru' },
          body: JSON.stringify({ model, prompt: 'must not reach provider', references: [] }), signal: AbortSignal.timeout(2_000),
        });
        assert.equal(rejected.status, 400);
        assert.equal((await rejected.json()).code, 'INVALID_REQUEST');
      }
      const method = await fetch('http://127.0.0.1:3127/api/thumbnail/openrouter-generate', { method: 'GET', signal: AbortSignal.timeout(2_000) });
      assert.equal(method.status, 405);
      if (expectedIndex) {
        const index = await fetch('http://127.0.0.1:3127/', { signal: AbortSignal.timeout(2_000) });
        assert.equal(digest(Buffer.from(await index.arrayBuffer())), expectedIndex);
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function verifyPublicGate() {
  const response = await fetch('https://cover.hs-manacost.ru/', { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://hearthpulse.net/api/auth/cover/start');
}

let activationSessionHash;
export async function verifyLive(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  await assertStaticGuards();
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    await regular(liveTargets[key]);
    assert.equal(await hash(liveTargets[key]), descriptor.candidate, `Active release drift: ${key}`);
  }
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    assert.equal(await hash(`${APP}/dist/${relative}`), expected, `Candidate asset drift: ${relative}`);
  }
  assert.equal((await fs.stat(SESSION_DIR)).mode & 0o777, 0o700);
  if (await regular(SESSION_FILE, true)) assert.equal((await fs.stat(SESSION_FILE)).mode & 0o777, 0o600);
  assert.equal(execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim(), 'active');
  assert.equal(Number(execFileSync('systemctl', ['show', SERVICE, '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()), manifest.baselineRestarts);
  await checkLocal(manifest.files.index.candidate);
  await verifyPublicGate();
  if (activationSessionHash !== undefined) assert.equal(await hash(SESSION_FILE), activationSessionHash, 'ChatGPT session store changed during activation');
  return { verified: true, candidateIndex: manifest.files.index.candidate, seedreamEndpoints: true, sessionPersistence: true };
}

export const liveHooks = async stage => {
  const manifest = await validateArchive();
  if (stage === 'backend') {
    activationSessionHash = await hash(SESSION_FILE);
    command('systemctl', ['restart', SERVICE]);
    await checkLocal();
  }
  if (stage === 'restore') {
    command('systemctl', ['restart', SERVICE]);
    await checkLocal(manifest.files.index.previous, false);
  }
  if (stage === 'verify') await verifyLive();
};

export async function rehearse(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-seedream-release-'));
  const archive = `${root}/backup`;
  const app = `${root}/app`;
  await fs.cp(saved, archive, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${archive}/previous-dist`, `${app}/dist`, { recursive: true, force: false, errorOnExist: true });
  const targets = {
    index: `${app}/dist/index.html`, server: `${app}/server/index.js`,
    openrouter: `${app}/server/openrouter-image.js`, models: `${app}/server/openrouter-models.js`,
  };
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    if (!descriptor.previous || key === 'index') continue;
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
  assert(['capture', 'rehearse', 'deploy', 'verify', 'rollback'].includes(mode), 'Usage: release-seedream-icons-motion.mjs capture|rehearse|deploy|verify|rollback');
  assert.equal(process.getuid(), 0, 'Release commands require root');
  if (process.env.COVER_RELEASE_LOCK_HELD !== '1') {
    execFileSync('flock', ['-n', LOCK, 'env', 'COVER_RELEASE_LOCK_HELD=1', process.execPath, fileURLToPath(import.meta.url), mode], { stdio: 'inherit' });
    process.exit(0);
  }
  if (mode === 'capture') console.log(JSON.stringify(await capture()));
  if (mode === 'rehearse') console.log(JSON.stringify(await rehearse()));
  if (mode === 'deploy') {
    await assertStaticGuards();
    assert.equal(execFileSync('systemctl', ['is-active', SERVICE], { encoding: 'utf8' }).trim(), 'active');
    console.log(JSON.stringify({ ...await publish({ hooks: liveHooks }), verified: true, seedreamEndpoints: true, sessionPersistence: true }));
  }
  if (mode === 'verify') console.log(JSON.stringify(await verifyLive()));
  if (mode === 'rollback') console.log(JSON.stringify(await rollback({ hooks: liveHooks })));
}
