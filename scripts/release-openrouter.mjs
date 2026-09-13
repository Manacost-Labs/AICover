import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = '/srv/projects/web/AI-cover-worktrees/openrouter-images-20260912';
export const APP = '/var/www/koloda/data/www/cover.hs-manacost.ru/repo';
export const BACKUP = '/var/backups/cover-image/20260912-openrouter-1ebb3e6-r3';

const UNIT = '/etc/systemd/system/cover-image.service';
const CHATGPT_DROP = '/etc/systemd/system/cover-image.service.d/30-chatgpt.conf';
const CHATGPT_ENV = '/etc/cover-image/chatgpt.env';
const MAIN_ENV = '/etc/cover-image/cover-image.env';
const DROP = '/etc/systemd/system/cover-image.service.d/40-openrouter.conf';
const ENV = '/etc/cover-image/openrouter.env';
const LOCK = '/run/lock/cover-foundation-release.lock';

const EXPECTED = Object.freeze({
  index: 'b86b5dc94465a76881017b181e134f49a554ecdc00242129cee9a89ae67b59b1',
  server: 'ea2a3149ef8b81963466841063bedb4a836b5409ef9dc1dd7810475972149490',
  openrouter: '4f5b33d8558a24de9296f6ad9790ba61a1b5e764a81fe8bdf45f67ce94e14596',
  unit: '2364e2c3a5328d9b562433c8935393ecb93b88e91627200f97aef7240ebd2434',
  chatgptDrop: 'e325a4a991b3203ba93ef4b6b0857f15d7f6bba3c61161d188ebd0997fa94eb6',
  chatgptEnv: '79e0806c6ab9411371dd1c789e3464a5867cda40c76ec3ebaef166ffba5e341d',
  package: '5f4a16a31bc9379bd8df6a6ccb45ca92bbe31399d3fb848756de3c90b2987798',
  lock: '17ef5a762eebad14e1f45d1983f6e464b38222c7ef2823398b7d602837829e94',
  candidateIndex: '1ebb3e6e220cbbc92bcb749ba69009838d17023d9695eba06284cdda9c63c5df',
  candidateServer: '2a94c1828c6efb56bfbabecf009e03f4af06ea4435d5fb0a84d03b6713ae4b88',
  candidateOpenrouter: '977849006cc49fdb9982b7c3d4c2c776df110002279b9a55fe3d0afc28b4e748',
});

const digest = data => createHash('sha256').update(data).digest('hex');
export const hash = async file => {
  try {
    return digest(await fs.readFile(file));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export const liveTargets = Object.freeze({
  index: `${APP}/dist/index.html`,
  server: `${APP}/server/index.js`,
  openrouter: `${APP}/server/openrouter-image.js`,
  drop: DROP,
  env: ENV,
});

export async function inventory(root) {
  const result = {};
  async function walk(directory, prefix = '') {
    assert((await fs.lstat(directory)).isDirectory(), `Refuse symlink directory: ${directory}`);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file, `${relative}/`);
      else {
        assert(entry.isFile(), `Refuse nonregular release file: ${relative}`);
        result[relative] = await hash(file);
      }
    }
  }
  await walk(root);
  return result;
}

async function regular(file, allowMissing = false) {
  try {
    assert((await fs.lstat(file)).isFile(), `Not a regular file: ${file}`);
    return true;
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function parents(file) {
  for (let directory = path.dirname(file); directory !== '/'; directory = path.dirname(directory)) {
    assert((await fs.lstat(directory)).isDirectory(), `Not a real directory: ${directory}`);
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

async function hasEnvValue(file, key) {
  const content = await fs.readFile(file, 'utf8');
  return content.split(/\r?\n/).some(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;
    const equals = trimmed.indexOf('=');
    if (equals < 1 || trimmed.slice(0, equals).trim() !== key) return false;
    return trimmed.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, '$2').length > 0;
  });
}

export async function atomic(file, data, expected, ownership) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  await parents(file);
  const exists = await regular(file, true);
  assert.equal(exists ? await hash(file) : null, expected, `Concurrent change: ${file}`);
  // A unique same-directory temporary path keeps rename atomic and ensures an
  // interrupted older attempt cannot block a reviewed retry or rollback.
  const tempDirectory = await fs.mkdtemp(`${file}.openrouter-release-`);
  const temp = `${tempDirectory}/candidate`;
  const handle = await fs.open(temp, 'wx', ownership.mode);
  try {
    await handle.writeFile(data);
    await handle.chmod(ownership.mode);
    await handle.chown(ownership.uid, ownership.gid);
    await handle.sync();
  } finally {
    await handle.close();
  }
  assert.equal(exists ? await hash(file) : null, expected, `Changed during write: ${file}`);
  await fs.rename(temp, file);
  await fs.rmdir(tempDirectory);
  const directory = await fs.open(path.dirname(file), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

function command(binary, args) {
  try {
    execFileSync(binary, args, { stdio: 'pipe', timeout: 30_000 });
  } catch {
    throw new Error(`Release command failed: ${binary} ${args[0] || ''}`);
  }
}

async function assertStaticGuards() {
  assert.equal(await hash(UNIT), EXPECTED.unit, 'Service unit drift');
  assert.equal(await hash(CHATGPT_DROP), EXPECTED.chatgptDrop, 'ChatGPT drop-in drift');
  assert.equal(await hash(CHATGPT_ENV), EXPECTED.chatgptEnv, 'ChatGPT environment drift');
  assert.equal(await hash(`${APP}/package.json`), EXPECTED.package, 'Package manifest drift');
  assert.equal(await hash(`${APP}/package-lock.json`), EXPECTED.lock, 'Package lock drift');
  assert.equal(await hasEnvValue(MAIN_ENV, 'OPENROUTER_API_KEY'), true, 'OPENROUTER_API_KEY is missing');
}

export async function capture() {
  assert.equal(process.getuid(), 0, 'Capture requires root');
  assert.equal(await regular(BACKUP, true), false, 'Backup path already exists');
  try {
    await fs.lstat(BACKUP);
    assert.fail('Backup path already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await assertStaticGuards();
  for (const [key, expected] of Object.entries({ index: EXPECTED.index, server: EXPECTED.server, openrouter: EXPECTED.openrouter })) {
    await regular(liveTargets[key]);
    assert.equal(await hash(liveTargets[key]), expected, `Production baseline drift: ${key}`);
  }
  assert.equal(await hash(DROP), null, 'OpenRouter drop-in already exists');
  assert.equal(await hash(ENV), null, 'OpenRouter environment file already exists');
  assert.equal(await hash(`${SOURCE}/dist/index.html`), EXPECTED.candidateIndex, 'Candidate index drift');
  assert.equal(await hash(`${SOURCE}/server/index.js`), EXPECTED.candidateServer, 'Candidate server drift');
  assert.equal(await hash(`${SOURCE}/server/openrouter-image.js`), EXPECTED.candidateOpenrouter, 'Candidate OpenRouter module drift');

  await fs.mkdir(BACKUP, { mode: 0o700 });
  const rootOwner = { uid: 0, gid: 0, mode: 0o644 };
  const appOwner = await owner(liveTargets.index, { uid: 0, gid: 0, mode: 0o644 });
  const files = {
    index: {
      target: liveTargets.index,
      previous: await fs.readFile(liveTargets.index),
      candidate: await fs.readFile(`${SOURCE}/dist/index.html`),
      owner: appOwner,
    },
    server: {
      target: liveTargets.server,
      previous: await fs.readFile(liveTargets.server),
      candidate: await fs.readFile(`${SOURCE}/server/index.js`),
      owner: await owner(liveTargets.server, appOwner),
    },
    openrouter: {
      target: liveTargets.openrouter,
      previous: await fs.readFile(liveTargets.openrouter),
      candidate: await fs.readFile(`${SOURCE}/server/openrouter-image.js`),
      owner: await owner(liveTargets.openrouter, appOwner),
    },
    drop: {
      target: DROP,
      previous: null,
      candidate: Buffer.from('[Service]\nEnvironmentFile=/etc/cover-image/openrouter.env\n'),
      owner: rootOwner,
    },
    env: {
      target: ENV,
      previous: null,
      candidate: Buffer.from('OPENROUTER_ENABLED=true\n'),
      owner: { ...rootOwner, mode: 0o600 },
    },
  };

  const manifest = {
    createdAt: new Date().toISOString(),
    source: SOURCE,
    baseCommit: '350720e5a28a8a121741345ad52117d8a3836922',
    files: {},
    previousDist: {},
    candidateDist: {},
    support: {},
    baselinePid: Number(execFileSync('systemctl', ['show', 'cover-image.service', '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()),
    baselineRestarts: Number(execFileSync('systemctl', ['show', 'cover-image.service', '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()),
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
  await fs.cp(`${APP}/dist`, `${BACKUP}/previous-dist`, { recursive: true, errorOnExist: true, force: false });
  await fs.cp(`${SOURCE}/dist`, `${BACKUP}/candidate-dist`, { recursive: true, errorOnExist: true, force: false });
  manifest.previousDist = await inventory(`${BACKUP}/previous-dist`);
  manifest.candidateDist = await inventory(`${BACKUP}/candidate-dist`);
  assert.deepEqual(manifest.previousDist, await inventory(`${APP}/dist`));
  assert.deepEqual(manifest.candidateDist, await inventory(`${SOURCE}/dist`));

  for (const relative of [
    'scripts/release-openrouter.mjs',
    'scripts/release-openrouter.test.mjs',
    'docs/OPENROUTER_RELEASE.md',
    'docs/OPENROUTER_IMAGES.md',
    'server/openrouter-image.test.js',
    'src/services/openRouterImages.test.ts',
    'src/services/geminiService.test.ts',
    'src/App.test.ts',
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
  return manifest;
}

async function addCandidateAssets(saved, app, manifest) {
  const live = `${app}/dist`;
  const existing = await inventory(live);
  for (const [relative, expected] of Object.entries(manifest.previousDist)) {
    if (relative === 'index.html') continue;
    assert.equal(existing[relative], expected, `Previous asset drift: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    if (relative === 'index.html') continue;
    const source = `${saved}/candidate-dist/${relative}`;
    const target = `${live}/${relative}`;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    await parents(target);
    const exists = await regular(target, true);
    if (exists) assert.equal(await hash(target), expected, `Asset collision: ${relative}`);
    else {
      await fs.copyFile(source, target, constants.COPYFILE_EXCL);
      const ownership = manifest.files.index.owner;
      await fs.chown(target, ownership.uid, ownership.gid);
      await fs.chmod(target, 0o644);
      assert.equal(await hash(target), expected, `Asset copy failed: ${relative}`);
    }
  }
}

async function targetState(target, descriptor) {
  const exists = await regular(target, true);
  if (!exists) return null;
  const current = await hash(target);
  assert([descriptor.previous, descriptor.candidate].includes(current), `Release drift: ${target}`);
  return current;
}

async function retire(file, saved, key) {
  await regular(file);
  const directory = await fs.mkdtemp(`${saved}/retired-${key}-`);
  await fs.rename(file, `${directory}/config`);
}

export async function rollback({ saved = BACKUP, app = APP, targets = liveTargets, hooks = async () => {} } = {}) {
  const manifest = await validateArchive(saved);
  for (const [key, descriptor] of Object.entries(manifest.files)) await targetState(targets[key], descriptor);

  for (const key of ['index', 'server', 'openrouter', 'drop', 'env']) {
    const descriptor = manifest.files[key];
    const current = await targetState(targets[key], descriptor);
    if (current === descriptor.previous) continue;
    if (descriptor.previous) {
      await atomic(targets[key], await fs.readFile(`${saved}/previous/${key}`), descriptor.candidate, descriptor.owner);
    } else if (current === descriptor.candidate) {
      await retire(targets[key], saved, key);
    }
  }
  await hooks('restore');
  return { rolledBack: true, restoredIndex: manifest.files.index.previous };
}

export async function publish({ saved = BACKUP, app = APP, targets = liveTargets, hooks = async () => {}, write = atomic } = {}) {
  const manifest = await validateArchive(saved);
  for (const [key, descriptor] of Object.entries(manifest.files)) {
    const current = await targetState(targets[key], descriptor);
    assert.equal(current, descriptor.previous, `Preflight drift: ${key}`);
  }
  await addCandidateAssets(saved, app, manifest);
  let mutated = false;
  try {
    for (const key of ['env', 'drop', 'openrouter', 'server']) {
      const descriptor = manifest.files[key];
      // atomic() can fail after rename (for example, on the directory fsync),
      // so rollback must already be armed before the first write attempt.
      mutated = true;
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

async function checkLocal(openrouterEnabled, expectedIndex) {
  let lastError;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const health = await fetch('http://127.0.0.1:3127/api/health', { signal: AbortSignal.timeout(2_000) });
      assert.equal(health.status, 200);
      assert.equal((await health.json()).ok, true);
      const capabilityResponse = await fetch('http://127.0.0.1:3127/api/runtime-capabilities', { signal: AbortSignal.timeout(2_000) });
      assert.equal(capabilityResponse.status, 200);
      const capabilities = await capabilityResponse.json();
      assert.equal(capabilities.gemini, true);
      assert.equal(capabilities.openrouter === true, openrouterEnabled);
      const chatgpt = await fetch('http://127.0.0.1:3127/api/chatgpt/session', { signal: AbortSignal.timeout(2_000) });
      assert.equal(chatgpt.status, 200);
      assert.equal((await chatgpt.json()).enabled, true);
      if (openrouterEnabled) {
        for (const model of ['attacker/not-allowed', '__proto__']) {
          const rejected = await fetch('http://127.0.0.1:3127/api/thumbnail/openrouter-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://cover.hs-manacost.ru' },
            body: JSON.stringify({ model, prompt: 'must not reach provider', references: [] }),
            signal: AbortSignal.timeout(2_000),
          });
          assert.equal(rejected.status, 400);
        }
        const method = await fetch('http://127.0.0.1:3127/api/thumbnail/openrouter-generate', {
          method: 'GET',
          signal: AbortSignal.timeout(2_000),
        });
        assert.equal(method.status, 405);
      }
      if (expectedIndex) {
        const index = await fetch('http://127.0.0.1:3127/', { signal: AbortSignal.timeout(2_000) });
        assert.equal(index.status, 200);
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

export function createLiveHooks({ restart, verify }) {
  return async stage => {
    if (stage === 'backend') await restart(true);
    if (stage === 'restore') await restart(false);
    if (stage === 'verify') await verify();
  };
}

export const liveHooks = createLiveHooks({
  restart: async openrouterEnabled => {
    command('systemctl', ['daemon-reload']);
    command('systemctl', ['restart', 'cover-image.service']);
    await checkLocal(openrouterEnabled);
  },
  // This runs inside publish(), so any final verification failure enters the
  // same guarded rollback path as a backend restart or index failure.
  verify: () => verifyLive(),
});

async function verifyPublicGate() {
  const response = await fetch('https://cover.hs-manacost.ru/', {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
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
  for (const [relative, expected] of Object.entries(manifest.candidateDist)) {
    assert.equal(await hash(`${APP}/dist/${relative}`), expected, `Candidate asset drift: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(manifest.previousDist)) {
    if (relative === 'index.html') continue;
    assert.equal(await hash(`${APP}/dist/${relative}`), expected, `Previous asset drift: ${relative}`);
  }
  assert.equal(execFileSync('systemctl', ['is-active', 'cover-image.service'], { encoding: 'utf8' }).trim(), 'active');
  assert.equal(Number(execFileSync('systemctl', ['show', 'cover-image.service', '-p', 'NRestarts', '--value'], { encoding: 'utf8' }).trim()), manifest.baselineRestarts);
  await checkLocal(true, manifest.files.index.candidate);
  await verifyPublicGate();
  return { verified: true, candidateIndex: manifest.files.index.candidate, openrouter: true, paidGeneration: false };
}

export async function rehearse(saved = BACKUP) {
  const manifest = await validateArchive(saved);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-openrouter-release-rehearsal-'));
  const archive = `${root}/backup`;
  const app = `${root}/app`;
  await fs.cp(saved, archive, { recursive: true, force: false, errorOnExist: true });
  await fs.cp(`${archive}/previous-dist`, `${app}/dist`, { recursive: true, force: false, errorOnExist: true });
  const targets = {
    index: `${app}/dist/index.html`,
    server: `${app}/server/index.js`,
    openrouter: `${app}/server/openrouter-image.js`,
    drop: `${root}/etc/systemd/system/cover-image.service.d/40-openrouter.conf`,
    env: `${root}/etc/cover-image/openrouter.env`,
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
  assert(['capture', 'rehearse', 'deploy', 'verify', 'rollback'].includes(mode), 'Usage: release-openrouter.mjs capture|rehearse|deploy|verify|rollback');
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
    const result = await publish({ hooks: liveHooks });
    console.log(JSON.stringify({ ...result, verified: true, openrouter: true, paidGeneration: false }));
  }
  if (mode === 'verify') console.log(JSON.stringify(await verifyLive()));
  if (mode === 'rollback') {
    const result = await rollback({ hooks: liveHooks });
    await checkLocal(false, (await json(`${BACKUP}/manifest.json`)).files.index.previous);
    console.log(JSON.stringify(result));
  }
}
