import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const SOURCE = '/srv/projects/web/AI-cover-worktrees/chatgpt-images-integration';
export const APP = '/var/www/koloda/data/www/cover.hs-manacost.ru/repo';
export const BACKUP = '/var/backups/cover-image/20260912-chatgpt-350720e';
const SITE = '/etc/nginx/vhosts/koloda/cover.hs-manacost.ru.conf';
const UNIT = '/etc/systemd/system/cover-image.service';
const DROP = '/etc/systemd/system/cover-image.service.d/30-chatgpt.conf';
const ENV = '/etc/cover-image/chatgpt.env';
const EXPECTED = {
  index: '14c3daf74ca1746bfcb3ab05ef65fc53ed015078090cf53bbbb2e3c7ff26ebc2',
  server: 'cf91242d9b3cb52db122be7d4c5aedbf2573a9d5ccefc42ccca62a73aa0efb7a',
  nginx: '861ededee097ba27bfc1b110d907e3dbbf57db829ca9bebbf4590a6f01c975ac',
  unit: '2364e2c3a5328d9b562433c8935393ecb93b88e91627200f97aef7240ebd2434',
  package: 'feeb4eeabd14443fa758cea3fdb9bd45fecd9b2a6a8d48f25fb9ab92fd45e9b6',
  lock: '759398646eaf41e816a7c69dd029452ea08b8e4bc2b75c1693784d2cedfd7102',
};
const digest = data => createHash('sha256').update(data).digest('hex');
export const hash = async file => { try { return digest(await fs.readFile(file)); } catch(e) { if(e.code==='ENOENT') return null; throw e; } };
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export const liveTargets = { index: `${APP}/dist/index.html`, server: `${APP}/server/index.js`, nginx: SITE, package: `${APP}/package.json`, lock: `${APP}/package-lock.json`, drop: DROP, env: ENV };

export async function inventory(root) {
  const out = {};
  async function walk(dir, prefix='') {
    assert((await fs.lstat(dir)).isDirectory(), 'Refuse symlink directory');
    for(const e of await fs.readdir(dir, {withFileTypes:true})) {
      const relative=prefix+e.name;const file=path.join(dir,e.name);
      if(e.isDirectory()) await walk(file,relative+'/');
      else {assert(e.isFile(), `Refuse nonregular release file: ${relative}`);out[relative]=await hash(file);}
    }
  }
  await walk(root);return out;
}

export function nginxCandidate(original) {
  assert(!original.includes('location = /chatgpt/callback'), 'Callback location already exists');
  const http='    location / { return 301 https://$host$request_uri; }';
  assert.equal(original.split(http).length,2);
  let next=original.replace(http,`    # ChatGPT callback: never log OAuth query strings, including HTTP redirects.
    location = /chatgpt/callback {
        access_log off;
        error_log /dev/null crit;
        add_header Referrer-Policy "no-referrer" always;
        add_header Cache-Control "no-store" always;
        return 302 https://cover.hs-manacost.ru/chatgpt/callback;
    }
${http}`);
  const auth=original.match(/    location = \/_hearthpulse_authorize \{[\s\S]*?\n    \}/g);
  assert.equal(auth?.length,1,'Expected one existing internal SSO check');
  // Clone the existing gate without interpreting or logging its secret header.
  const privateAuth=auth[0].replace('/_hearthpulse_authorize','/_chatgpt_authorize').replace('        internal;', '        internal;\n        access_log off;\n        error_log /dev/null crit;');
  const anchor='    location @cover_hearthpulse_login';
  assert.equal(next.split(anchor).length,2);
  next=next.replace(anchor,`${privateAuth}

    location @chatgpt_login {
        access_log off;
        error_log /dev/null crit;
        add_header Referrer-Policy "no-referrer" always;
        add_header Cache-Control "no-store" always;
        return 302 https://hearthpulse.net/api/auth/cover/start;
    }

    location = /chatgpt/callback {
        access_log off;
        error_log /dev/null crit;
        add_header Referrer-Policy "no-referrer" always;
        add_header Cache-Control "no-store" always;
        auth_request /_chatgpt_authorize;
        error_page 401 = @chatgpt_login;
        proxy_pass http://127.0.0.1:3127;
    }

${anchor}`);
  assert(next.includes(auth[0]),'Original SSO block changed');return next;
}

async function save(file, data, mode=0o600) {await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,data,{flag:'wx',mode});}
async function regular(file) {try {assert((await fs.lstat(file)).isFile(),`Not regular: ${file}`);} catch(e) {if(e.code!=='ENOENT') throw e;}}
async function parents(file) {
  for(let dir=path.dirname(file);dir!=='/';dir=path.dirname(dir)) assert((await fs.lstat(dir)).isDirectory(),`Not real directory: ${dir}`);
}
async function atomic(file, data, expected, owner) {
  await parents(file);await regular(file);assert.equal(await hash(file),expected,`Concurrent change: ${file}`);
  const temp=file+'.chatgpt-release.tmp';const handle=await fs.open(temp,'wx',owner.mode);
  try {await handle.writeFile(data);await handle.chmod(owner.mode);await handle.chown(owner.uid,owner.gid);await handle.sync();} finally {await handle.close();}
  assert.equal(await hash(file),expected,`Changed during write: ${file}`);await fs.rename(temp,file);
  const dir=await fs.open(path.dirname(file),'r');try {await dir.sync();} finally {await dir.close();}
}
async function owner(file,fallback) {try {const s=await fs.stat(file);return {uid:s.uid,gid:s.gid,mode:s.mode&0o777};} catch(e) {if(e.code==='ENOENT') return fallback;throw e;}}

export async function capture() {
  assert.equal(process.getuid(),0);
  for(const [key,sum] of Object.entries(EXPECTED)) assert.equal(await hash(key==='unit'?UNIT:liveTargets[key]),sum,`Baseline drift: ${key}`);
  for(const f of [DROP,ENV,`${APP}/server/chatgpt-router.js`,`${APP}/server/chatgpt-images.js`,`${APP}/node_modules/@openai-oauth/core/package.json`]) assert.equal(await hash(f),null,`Already exists: ${f}`);
  assert.equal(await hash(`${SOURCE}/dist/index.html`),'f33a4568fa057e67d2a74d1d5e6c93f277803e085f3aa0b075d528bc80400e9e');
  assert.equal(await hash(`${SOURCE}/server/index.js`),'ea2a3149ef8b81963466841063bedb4a836b5409ef9dc1dd7810475972149490');
  await fs.mkdir(BACKUP,{mode:0o700});
  const p=await json(liveTargets.package);const lock=await json(liveTargets.lock);const candidateLock=await json(`${SOURCE}/package-lock.json`);
  assert(!p.dependencies['@openai-oauth/core']);assert(!lock.packages['node_modules/@openai-oauth/core']);
  p.dependencies['@openai-oauth/core']='2.0.0';lock.packages[''].dependencies['@openai-oauth/core']='2.0.0';
  lock.packages['node_modules/@openai-oauth/core']=candidateLock.packages['node_modules/@openai-oauth/core'];
  const contents={index:await fs.readFile(`${SOURCE}/dist/index.html`),server:await fs.readFile(`${SOURCE}/server/index.js`),nginx:nginxCandidate(await fs.readFile(SITE,'utf8')),package:JSON.stringify(p,null,2)+'\n',lock:JSON.stringify(lock,null,2)+'\n',drop:'[Service]\nEnvironmentFile=/etc/cover-image/chatgpt.env\n',env:'COVER_CHATGPT_ENABLED=true\nCOVER_CHATGPT_ORIGIN=https://cover.hs-manacost.ru\n'};
  const manifest={createdAt:new Date().toISOString(),baseCommit:'350720e5a28a8a121741345ad52117d8a3836922',unitHash:EXPECTED.unit,files:{},additions:{},source:SOURCE};
  const appOwner=await owner(liveTargets.index);const rootOwner={uid:0,gid:0,mode:0o644};
  for(const [key,data] of Object.entries(contents)) {
    const file=liveTargets[key];const previous=await hash(file);if(previous) await save(`${BACKUP}/previous/${key}`,await fs.readFile(file));
    await save(`${BACKUP}/candidate/${key}`,data);
    manifest.files[key]={path:file,previous,candidate:digest(data),owner:await owner(file,key==='env'?{...rootOwner,mode:0o600}:key==='drop'?rootOwner:appOwner)};
  }
  await fs.cp(`${APP}/dist`,`${BACKUP}/previous-dist`,{recursive:true,errorOnExist:true,force:false});
  await fs.cp(`${SOURCE}/dist`,`${BACKUP}/candidate-dist`,{recursive:true,errorOnExist:true,force:false});
  manifest.previousDist=await inventory(`${BACKUP}/previous-dist`);manifest.candidateDist=await inventory(`${BACKUP}/candidate-dist`);
  assert.deepEqual(manifest.previousDist,await inventory(`${APP}/dist`));
  for(const [f,sum] of Object.entries(manifest.candidateDist)) if(f!=='index.html'&&manifest.previousDist[f]) assert.equal(sum,manifest.previousDist[f],`Asset collision: ${f}`);
  // Copy the reviewed installed package as regular files; no npm scripts or live dependency resolution.
  await fs.cp(`${SOURCE}/node_modules/@openai-oauth/core`,`${BACKUP}/core`,{recursive:true,dereference:true,errorOnExist:true,force:false});
  const core=await json(`${BACKUP}/core/package.json`);assert.equal(core.version,'2.0.0');assert(!core.dependencies||!Object.keys(core.dependencies).length);
  assert(!core.scripts?.install&&!core.scripts?.postinstall&&!core.scripts?.preinstall);
  manifest.core=await inventory(`${BACKUP}/core`);
  for(const name of ['chatgpt-router.js','chatgpt-images.js']) {await save(`${BACKUP}/additions/${name}`,await fs.readFile(`${SOURCE}/server/${name}`));manifest.additions[name]=await hash(`${BACKUP}/additions/${name}`);}
  for(const name of ['src','server','public','index.html','package.json','package-lock.json','vite.config.ts','vitest.config.ts','tsconfig.json','docs','scripts']) {
    await fs.cp(`${SOURCE}/${name}`,`${BACKUP}/source/${name}`,{recursive:true,errorOnExist:true,force:false});
  }
  await fs.copyFile(UNIT,`${BACKUP}/original-unit`);
  await save(`${BACKUP}/manifest.json`,JSON.stringify(manifest,null,2));
  return {backup:BACKUP,index:manifest.files.index.candidate,managedFiles:Object.keys(manifest.files).length};
}

export async function validateArchive(saved) {
  const m=await json(`${saved}/manifest.json`);
  for(const [key,f] of Object.entries(m.files)) {assert.equal(await hash(`${saved}/candidate/${key}`),f.candidate);if(f.previous) assert.equal(await hash(`${saved}/previous/${key}`),f.previous);}
  assert.deepEqual(await inventory(`${saved}/candidate-dist`),m.candidateDist);assert.deepEqual(await inventory(`${saved}/previous-dist`),m.previousDist);assert.deepEqual(await inventory(`${saved}/core`),m.core);
  for(const [name,sum] of Object.entries(m.additions)) assert.equal(await hash(`${saved}/additions/${name}`),sum);
  return m;
}

async function add(file,source,sum,own) {
  const existing=await hash(file);if(existing) {assert.equal(existing,sum,`Collision: ${file}`);return;}
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o755});await parents(file);await regular(file);
  await fs.copyFile(source,file,constants.COPYFILE_EXCL);await fs.chown(file,own.uid,own.gid);await fs.chmod(file,0o644);assert.equal(await hash(file),sum);
}
export async function publish({saved,app,targets,hooks=async()=>{}}) {
  const m=await validateArchive(saved);
  for(const [key,f] of Object.entries(m.files)) {await regular(targets[key]);assert.equal(await hash(targets[key]),f.previous,`Preflight drift: ${key}`);}
  const existing=await inventory(`${app}/dist`);for(const [f,sum] of Object.entries(m.previousDist)) assert.equal(existing[f],sum,`Old asset drift: ${f}`);
  const own=m.files.index.owner;
  for(const [f,sum] of Object.entries(m.core)) await add(`${app}/node_modules/@openai-oauth/core/${f}`,`${saved}/core/${f}`,sum,own);
  for(const [f,sum] of Object.entries(m.additions)) await add(`${app}/server/${f}`,`${saved}/additions/${f}`,sum,own);
  for(const [f,sum] of Object.entries(m.candidateDist)) if(f!=='index.html') await add(`${app}/dist/${f}`,`${saved}/candidate-dist/${f}`,sum,own);
  try {
    for(const key of ['nginx','package','lock','env','drop','server']) {
      await fs.mkdir(path.dirname(targets[key]),{recursive:true,mode:0o755});
      await atomic(targets[key],await fs.readFile(`${saved}/candidate/${key}`),m.files[key].previous,m.files[key].owner);
      if(key==='nginx') await hooks('nginx');
      await hooks(`written:${key}`);
    }
    await hooks('backend');
    await atomic(targets.index,await fs.readFile(`${saved}/candidate/index`),m.files.index.previous,own);
    await hooks('verify');
    return {index:m.files.index.candidate,backup:saved};
  } catch(e) {
    await rollback({saved,app,targets,hooks});throw new Error(`Activation failed; previous release restored (${e.code||e.name}).`);
  }
}

export async function rollback({saved,app,targets,hooks=async()=>{}}) {
  const m=await validateArchive(saved);
  // Validate every target before touching anything. Never undo a later release.
  for(const [key,f] of Object.entries(m.files)) {await regular(targets[key]);assert([f.previous,f.candidate].includes(await hash(targets[key])),`Rollback drift: ${key}`);}
  for(const [f,sum] of Object.entries(m.previousDist)) if(f!=='index.html') assert.equal(await hash(`${app}/dist/${f}`),sum,`Old asset drift: ${f}`);
  for(const key of ['index','server','package','lock','drop','env','nginx']) {
    const f=m.files[key];if(await hash(targets[key])===f.previous) continue;
    if(f.previous) await atomic(targets[key],await fs.readFile(`${saved}/previous/${key}`),f.candidate,f.owner);
    else {
      await parents(targets[key]);assert.equal(await hash(targets[key]),f.candidate);
      // Each rollback has its own recoverable copy, including deployment retries.
      const retired=await fs.mkdtemp(`${saved}/retired-${key}-`);
      await fs.rename(targets[key],`${retired}/config`);
    }
  }
  await hooks('restore');
  // Additive assets/module files remain to preserve open tabs and aid recovery.
}

async function checkLocal(enabled) {
  let last;
  for(let i=0;i<20;i++) {
    try {
      const health=await fetch('http://127.0.0.1:3127/api/health',{signal:AbortSignal.timeout(2000)});assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
      const cap=await fetch('http://127.0.0.1:3127/api/runtime-capabilities',{signal:AbortSignal.timeout(2000)});assert.equal(cap.status,200);assert.equal((await cap.json()).gemini,true);
      if(enabled) {const s=await fetch('http://127.0.0.1:3127/api/chatgpt/session',{signal:AbortSignal.timeout(2000)});assert.deepEqual(await s.json(),{enabled:true,connected:false,imageVerified:false});}
      return;
    } catch(e) {last=e;await new Promise(resolve=>setTimeout(resolve,500));}
  }
  throw last;
}
const command=(cmd,args)=>{try {execFileSync(cmd,args,{stdio:'pipe',timeout:30000});} catch {throw new Error(`Release command failed: ${cmd} ${args[0]}`);}};
export async function liveHooks(stage) {
  if(stage==='nginx') {command('nginx',['-t']);command('systemctl',['reload','nginx']);}
  if(stage==='backend'||stage==='restore') {
    if(stage==='restore') {command('nginx',['-t']);command('systemctl',['reload','nginx']);}
    command('systemctl',['daemon-reload']);command('systemctl',['restart','cover-image.service']);await checkLocal(stage==='backend');
  }
  if(stage==='verify') {await checkLocal(true);assert.equal(digest(Buffer.from(await (await fetch('http://127.0.0.1:3127/')).arrayBuffer())),(await json(`${BACKUP}/manifest.json`)).files.index.candidate);}
}

export async function rehearse(saved) {
  const m=await validateArchive(saved);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cover-chatgpt-release-rehearsal-'));
  const archive=`${root}/backup`,app=`${root}/app`;
  await fs.cp(saved,archive,{recursive:true,force:false,errorOnExist:true});
  await fs.cp(`${saved}/previous-dist`,`${app}/dist`,{recursive:true,force:false,errorOnExist:true});
  const targets={};
  for(const [key,f] of Object.entries(m.files)) {
    targets[key]=key==='index'?`${app}/dist/index.html`:key==='server'?`${app}/server/index.js`:['package','lock'].includes(key)?`${app}/${key==='package'?'package.json':'package-lock.json'}`:`${root}/etc/${key}`;
    if(f.previous&&key!=='index') await save(targets[key],await fs.readFile(`${archive}/previous/${key}`),f.owner.mode);
  }
  await publish({saved:archive,app,targets,hooks:async stage=>{
    if(stage==='backend') command('node',['--input-type=module','-e',`await import(${JSON.stringify(`file://${app}/node_modules/@openai-oauth/core/dist/index.js`)});`]);
  }});
  for(const [key,f] of Object.entries(m.files)) assert.equal(await hash(targets[key]),f.candidate);
  await rollback({saved:archive,app,targets});
  for(const [key,f] of Object.entries(m.files)) assert.equal(await hash(targets[key]),f.previous);
  // Syntax check the candidate virtual host without installing it or reloading nginx.
  const config=`${root}/nginx-check.conf`;
  await save(config,`include /etc/nginx/modules-enabled/*.conf;\npid ${root}/nginx.pid;\nerror_log /dev/null;\nevents { worker_connections 64; }\nhttp { include /etc/nginx/mime.types; include ${saved}/candidate/nginx; }\n`);
  command('nginx',['-t','-c',config]);
  return {rehearsal:root,publishRollback:'passed',pinnedDependencyImport:'passed',nginxCandidateSyntax:'passed',productionTouched:false};
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const mode=process.argv[2];assert(['capture','rehearse','deploy','rollback','verify'].includes(mode));assert.equal(process.getuid(),0,'Run live operations under sudo and shared release flock');
  if(mode==='capture') console.log(JSON.stringify(await capture()));
  else if(mode==='rehearse') console.log(JSON.stringify(await rehearse(BACKUP)));
  else {
    const m=await validateArchive(BACKUP);assert.equal(await hash(UNIT),m.unitHash,'Service unit drift');
    const options={saved:BACKUP,app:APP,targets:liveTargets,hooks:liveHooks};
    if(mode==='deploy') console.log(JSON.stringify(await publish(options)));
    if(mode==='rollback') {await rollback(options);console.log(JSON.stringify({rolledBack:true,backup:BACKUP}));}
    if(mode==='verify') {
      for(const [key,f] of Object.entries(m.files)) assert.equal(await hash(liveTargets[key]),f.candidate,`Active drift: ${key}`);
      for(const [f,sum] of Object.entries(m.candidateDist)) assert.equal(await hash(`${APP}/dist/${f}`),sum);
      for(const [f,sum] of Object.entries(m.previousDist)) if(f!=='index.html') assert.equal(await hash(`${APP}/dist/${f}`),sum);
      for(const [f,sum] of Object.entries(m.core)) assert.equal(await hash(`${APP}/node_modules/@openai-oauth/core/${f}`),sum);
      for(const [f,sum] of Object.entries(m.additions)) assert.equal(await hash(`${APP}/server/${f}`),sum);
      await liveHooks('verify');console.log(JSON.stringify({verified:true,candidateFiles:Object.keys(m.candidateDist).length,oldAssetsRetained:Object.keys(m.previousDist).length-1,index:m.files.index.candidate}));
    }
  }
}
