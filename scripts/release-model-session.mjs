import assert from 'node:assert/strict';
import crypto, { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs, { constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { atomic, hash, inventory } from './release-openrouter.mjs';

export const SOURCE = '/srv/projects/web/AI-cover-worktrees/openrouter-images-20260912';
export const APP = '/var/www/koloda/data/www/cover.hs-manacost.ru/repo';
export const BACKUP = '/var/backups/cover-image/20260913-model-session-139bfe87-r3';

const UNIT = '/etc/systemd/system/cover-image.service';
const CHATGPT_DROP = '/etc/systemd/system/cover-image.service.d/30-chatgpt.conf';
const CHATGPT_ENV = '/etc/cover-image/chatgpt.env';
const OPENROUTER_DROP = '/etc/systemd/system/cover-image.service.d/40-openrouter.conf';
const OPENROUTER_ENV = '/etc/cover-image/openrouter.env';
const SESSION_DROP = '/etc/systemd/system/cover-image.service.d/35-chatgpt-session.conf';
const SESSION_ENV = '/etc/cover-image/chatgpt-session.env';
const SESSION_DIR = '/var/lib/cover-image/chatgpt';
const LOCK = '/run/lock/cover-foundation-release.lock';

const EXPECTED = Object.freeze({
  index: '1ebb3e6e220cbbc92bcb749ba69009838d17023d9695eba06284cdda9c63c5df',
  server: '2a94c1828c6efb56bfbabecf009e03f4af06ea4435d5fb0a84d03b6713ae4b88',
  openrouter: '977849006cc49fdb9982b7c3d4c2c776df110002279b9a55fe3d0afc28b4e748',
  router: 'd00bc36fa00473fe95e246125cf109f30b9c0aac5c2cb2267b6d5bda9d7cda0c',
  unit: '2364e2c3a5328d9b562433c8935393ecb93b88e91627200f97aef7240ebd2434',
  chatgptDrop: 'e325a4a991b3203ba93ef4b6b0857f15d7f6bba3c61161d188ebd0997fa94eb6',
  chatgptEnv: '79e0806c6ab9411371dd1c789e3464a5867cda40c76ec3ebaef166ffba5e341d',
  openrouterDrop: 'e74473a1a7c972633f7fa784076931d9897aa47be6727ed39832be532ecb5c28',
  openrouterEnv: 'ec876f71a7466012916411a99495c532fba4b70ca585b273b00575e642c142b5',
  package: '5f4a16a31bc9379bd8df6a6ccb45ca92bbe31399d3fb848756de3c90b2987798',
  lock: '17ef5a762eebad14e1f45d1983f6e464b38222c7ef2823398b7d602837829e94',
  candidateIndex: '139bfe879a4c33cb28dd537b19f3a188a3b87932c99d0dfa76c105ab1a1a9683',
  candidateServer: 'ad08730741a4aad9a34b30c6c8e0970bc91ef4b8b088a1bd737d4d3f409d37bd',
  candidateOpenrouter: 'dc0be4272a3a81904c68e8d01031b262de71445b89788a556cb6c6542e5f6ff6',
  candidateRouter: '48d5f91f2e20fff4fbae1061149ee18ea9b403799cee35617cbad0a96129c040',
  candidateStore: '13b7b68bf0f6f89b328bd8d186d4174b947c88d7363cb0da346ee17642768c1a',
});

const digest = data => createHash('sha256').update(data).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export const liveTargets = Object.freeze({
  index: `${APP}/dist/index.html`,
  server: `${APP}/server/index.js`,
  openrouter: `${APP}/server/openrouter-image.js`,
  router: `${APP}/server/chatgpt-router.js`,
  store: `${APP}/server/chatgpt-session-store.js`,
  drop: SESSION_DROP,
  env: SESSION_ENV,
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
    [UNIT, EXPECTED.unit], [CHATGPT_DROP, EXPECTED.chatgptDrop], [CHATGPT_ENV, EXPECTED.chatgptEnv],
    [OPENROUTER_DROP, EXPECTED.openrouterDrop], [OPENROUTER_ENV, EXPECTED.openrouterEnv],
    [`${APP}/package.json`, EXPECTED.package], [`${APP}/package-lock.json`, EXPECTED.lock],
  ];
  for (const [file, expected] of guards) assert.equal(await hash(file), expected, `Static guard drift: ${file}`);
}

function sessionEnvironment() {
  const key = crypto.randomBytes(32).toString('base64url');
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  return Buffer.from(`COVER_CHATGPT_SESSION_KEY=${key}\nCOVER_CHATGPT_SESSION_FILE=${SESSION_DIR}/sessions.enc\n`);
}

export async function capture() {
  assert.equal(process.getuid(), 0, 'Capture requires root');
  await assertStaticGuards();
  await assert.rejects(fs.lstat(BACKUP), error => error.code === 'ENOENT', 'Backup path already exists');
  const live = { index: EXPECTED.index, server: EXPECTED.server, openrouter: EXPECTED.openrouter, router: EXPECTED.router };
  for (const [key, expected] of Object.entries(live)) assert.equal(await hash(liveTargets[key]), expected, `Production baseline drift: ${key}`);
  for (const key of ['store', 'drop', 'env']) assert.equal(await hash(liveTargets[key]), null, `New target already exists: ${key}`);
  const candidate = {
    index: EXPECTED.candidateIndex, server: EXPECTED.candidateServer, openrouter: EXPECTED.candidateOpenrouter,
    router: EXPECTED.candidateRouter, store: EXPECTED.candidateStore,
  };
  const sourceFiles = {
    index: `${SOURCE}/dist/index.html`, server: `${SOURCE}/server/index.js`, openrouter: `${SOURCE}/server/openrouter-image.js`,
    router: `${SOURCE}/server/chatgpt-router.js`, store: `${SOURCE}/server/chatgpt-session-store.js`,
  };
  for (const [key, expected] of Object.entries(candidate)) assert.equal(await hash(sourceFiles[key]), expected, `Candidate drift: ${key}`);

  await fs.mkdir(BACKUP, { mode: 0o700 });
  const appOwner = await owner(liveTargets.index, { uid: 0, gid: 0, mode: 0o644 });
  const rootOwner = { uid: 0, gid: 0, mode: 0o644 };
  const files = {
    index: { target: liveTargets.index, previous: await fs.readFile(liveTargets.index), candidate: await fs.readFile(sourceFiles.index), owner: appOwner },
    server: { target: liveTargets.server, previous: await fs.readFile(liveTargets.server), candidate: await fs.readFile(sourceFiles.server), owner: await owner(liveTargets.server, appOwner) },
    openrouter: { target: liveTargets.openrouter, previous: await fs.readFile(liveTargets.openrouter), candidate: await fs.readFile(sourceFiles.openrouter), owner: await owner(liveTargets.openrouter, appOwner) },
    router: { target: liveTargets.router, previous: await fs.readFile(liveTargets.router), candidate: await fs.readFile(sourceFiles.router), owner: await owner(liveTargets.router, appOwner) },
    store: { target: liveTargets.store, previous: null, candidate: await fs.readFile(sourceFiles.store), owner: await owner(`${APP}/server`, appOwner).then(value => ({ ...value, mode: 0o644 })) },
    drop: { target: liveTargets.drop, previous: null, candidate: Buffer.from('[Service]\nEnvironmentFile=/etc/cover-image/chatgpt-session.env\n'), owner: rootOwner },
    env: { target: liveTargets.env, previous: null, candidate: sessionEnvironment(), owner: { ...rootOwner, mode: 0o600 } },
  };
  const manifest = {
    createdAt: new Date().toISOString(), source: SOURCE, baseCommit: '350720e5a28a8a121741345ad52117d8a3836922', files: {},
    previousDist: {}, candidateDist: {}, support: {},
    baselineRestarts: Number(execFileSync('systemctl', ['show', 'cover-image.service', '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()),
  };
  for (const [key, descriptor] of Object.entries(files)) {
    if (descriptor.previous) await save(`${BACKUP}/previous/${key}`, descriptor.previous);
    await save(`${BACKUP}/candidate/${key}`, descriptor.candidate, descriptor.owner.mode);
    manifest.files[key] = { target: descriptor.target, previous: descriptor.previous ? digest(descriptor.previous) : null, candidate: digest(descriptor.candidate), owner: descriptor.owner };
  }
  await fs.cp(`${APP}/dist`, `${BACKUP}/previous-dist`, { recursive: true, errorOnExist: true, force: false });
  await fs.cp(`${SOURCE}/dist`, `${BACKUP}/candidate-dist`, { recursive: true, errorOnExist: true, force: false });
  manifest.previousDist = await inventory(`${BACKUP}/previous-dist`);
  manifest.candidateDist = await inventory(`${BACKUP}/candidate-dist`);
  assert.deepEqual(manifest.previousDist, await inventory(`${APP}/dist`));
  assert.deepEqual(manifest.candidateDist, await inventory(`${SOURCE}/dist`));
  for (const relative of [
    'scripts/release-model-session.mjs', 'scripts/release-model-session.test.mjs', 'scripts/release-openrouter.mjs',
    'docs/MODEL_SESSION_RELEASE.md',
    'server/chatgpt-session-store.test.js', 'server/chatgpt-router.test.js', 'server/openrouter-image.test.js',
    'src/services/openRouterReferenceComposer.test.ts', 'src/services/openRouterImages.test.ts',
    'src/services/geminiService.test.ts', 'src/components/ui/ChatGptConnection.test.ts',
  ]) {
    const target = `${BACKUP}/support/${relative}`;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.copyFile(`${SOURCE}/${relative}`, target, constants.COPYFILE_EXCL);
  }
  manifest.support = await inventory(`${BACKUP}/support`);
  await save(`${BACKUP}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { backup: BACKUP, candidateIndex: manifest.files.index.candidate, candidateFiles: Object.keys(manifest.candidateDist).length };
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
  const env = await fs.readFile(`${saved}/candidate/env`, 'utf8');
  assert.match(env, /^COVER_CHATGPT_SESSION_KEY=[A-Za-z0-9_-]{43}\nCOVER_CHATGPT_SESSION_FILE=\/var\/lib\/cover-image\/chatgpt\/sessions\.enc\n$/);
  assert.equal((await fs.stat(`${saved}/candidate/env`)).mode & 0o777, 0o600);
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
    }
  }
}

async function retire(file, saved, key) {
  await regular(file);
  const directory = await fs.mkdtemp(`${saved}/retired-${key}-`);
  await fs.rename(file, `${directory}/config`);
}

export async function rollback({ saved = BACKUP, app = APP, targets = liveTargets, hooks = async () => {} } = {}) {
  const manifest = await validateArchive(saved);
  for (const [key, descriptor] of Object.entries(manifest.files)) await targetState(targets[key], descriptor);
  for (const key of ['index', 'server', 'openrouter', 'router', 'store', 'drop', 'env']) {
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
  for (const [key, descriptor] of Object.entries(manifest.files)) assert.equal(await targetState(targets[key], descriptor), descriptor.previous, `Preflight drift: ${key}`);
  await addCandidateAssets(saved, app, manifest);
  let mutated = false;
  try {
    for (const key of ['env', 'drop', 'store', 'router', 'openrouter', 'server']) {
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

async function prepareSessionDirectory(manifest) {
  await fs.mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
  assert((await fs.lstat(SESSION_DIR)).isDirectory(), 'Session path is not a real directory');
  await fs.chown(SESSION_DIR, manifest.files.index.owner.uid, manifest.files.index.owner.gid);
  await fs.chmod(SESSION_DIR, 0o700);
}

async function checkLocal(expectedIndex) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const health = await fetch('http://127.0.0.1:3127/api/health', { signal: AbortSignal.timeout(2_000) });
      assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
      const capabilities = await (await fetch('http://127.0.0.1:3127/api/runtime-capabilities', { signal: AbortSignal.timeout(2_000) })).json();
      assert.equal(capabilities.gemini, true); assert.equal(capabilities.openrouter, true);
      const session = await (await fetch('http://127.0.0.1:3127/api/chatgpt/session', { signal: AbortSignal.timeout(2_000) })).json();
      assert.equal(session.enabled, true); assert.equal(session.connected, false);
      for (const model of ['attacker/not-allowed', '__proto__']) {
        const rejected = await fetch('http://127.0.0.1:3127/api/thumbnail/openrouter-generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://cover.hs-manacost.ru' },
          body: JSON.stringify({ model, prompt: 'must not reach provider', references: [] }), signal: AbortSignal.timeout(2_000),
        });
        assert.equal(rejected.status, 400);
      }
      if (expectedIndex) {
        const index = await fetch('http://127.0.0.1:3127/', { signal: AbortSignal.timeout(2_000) });
        assert.equal(digest(Buffer.from(await index.arrayBuffer())), expectedIndex);
      }
      return;
    } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  throw lastError;
}

async function verifyPublicGate() {
  const response = await fetch('https://cover.hs-manacost.ru/', { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://hearthpulse.net/api/auth/cover/start');
}

export async function verifyLive(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  await assertStaticGuards();
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    await regular(liveTargets[key]);
    assert.equal(await hash(liveTargets[key]), descriptor.candidate, `Active release drift: ${key}`);
  }
  assert.equal((await fs.stat(SESSION_ENV)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(SESSION_DIR)).mode & 0o777, 0o700);
  assert.equal(execFileSync('systemctl', ['is-active', 'cover-image.service'], { encoding: 'utf8' }).trim(), 'active');
  assert.equal(Number(execFileSync('systemctl', ['show', 'cover-image.service', '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()), manifest.baselineRestarts);
  await checkLocal(manifest.files.index.candidate);
  await verifyPublicGate();
  return { verified: true, candidateIndex: manifest.files.index.candidate, sessionPersistence: true, paidGeneration: false };
}

export const liveHooks = async stage => {
  const manifest = await validateArchive();
  if (stage === 'backend') {
    await prepareSessionDirectory(manifest);
    command('systemctl', ['daemon-reload']); command('systemctl', ['restart', 'cover-image.service']);
    await checkLocal();
  }
  if (stage === 'restore') {
    command('systemctl', ['daemon-reload']); command('systemctl', ['restart', 'cover-image.service']);
    await checkLocal(manifest.files.index.previous);
  }
  if (stage === 'verify') await verifyLive();
};

export async function rehearse(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-model-session-release-'));
  const archive = `${root}/backup`;
  const app = `${root}/app`;
  await fs.cp(saved, archive, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${archive}/previous-dist`, `${app}/dist`, { recursive: true, force: false, errorOnExist: true });
  const targets = {
    index: `${app}/dist/index.html`, server: `${app}/server/index.js`, openrouter: `${app}/server/openrouter-image.js`,
    router: `${app}/server/chatgpt-router.js`, store: `${app}/server/chatgpt-session-store.js`,
    drop: `${root}/etc/systemd/system/cover-image.service.d/35-chatgpt-session.conf`, env: `${root}/etc/cover-image/chatgpt-session.env`,
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
  assert(['capture', 'rehearse', 'deploy', 'verify', 'rollback'].includes(mode), 'Usage: release-model-session.mjs capture|rehearse|deploy|verify|rollback');
  assert.equal(process.getuid(), 0, 'Release commands require root');
  if (process.env.COVER_RELEASE_LOCK_HELD !== '1') {
    execFileSync('flock', ['-n', LOCK, 'env', 'COVER_RELEASE_LOCK_HELD=1', process.execPath, fileURLToPath(import.meta.url), mode], { stdio: 'inherit' });
    process.exit(0);
  }
  if (mode === 'capture') console.log(JSON.stringify(await capture()));
  if (mode === 'rehearse') console.log(JSON.stringify(await rehearse()));
  if (mode === 'deploy') {
    await assertStaticGuards();
    assert.equal(execFileSync('systemctl', ['is-active', 'cover-image.service'], { encoding: 'utf8' }).trim(), 'active');
    console.log(JSON.stringify({ ...await publish({ hooks: liveHooks }), verified: true, paidGeneration: false }));
  }
  if (mode === 'verify') console.log(JSON.stringify(await verifyLive()));
  if (mode === 'rollback') console.log(JSON.stringify(await rollback({ hooks: liveHooks })));
}
