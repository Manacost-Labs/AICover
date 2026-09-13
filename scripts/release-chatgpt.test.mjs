import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {hash, inventory, nginxCandidate, publish, rollback, validateArchive} from './release-chatgpt.mjs';

const digest=data=>createHash('sha256').update(data).digest('hex');
async function put(file,data) {await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data,{flag:'wx'});}
async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cover-chatgpt-release-test-'));
  const app=`${root}/app`,saved=`${root}/backup`;
  const targets={index:`${app}/dist/index.html`,server:`${app}/server/index.js`,package:`${app}/package.json`,lock:`${app}/package-lock.json`,nginx:`${root}/etc/nginx.conf`,drop:`${root}/etc/unit.d/30-chatgpt.conf`,env:`${root}/etc/chatgpt.env`};
  const m={files:{},previousDist:{},candidateDist:{},core:{},additions:{}};
  for(const [key,file] of Object.entries(targets)) {
    const previous=['drop','env'].includes(key)?null:`previous-${key}`;const candidate=`candidate-${key}`;
    if(previous) {await put(file,previous);await put(`${saved}/previous/${key}`,previous);}
    await put(`${saved}/candidate/${key}`,candidate);
    m.files[key]={path:file,previous:previous?digest(previous):null,candidate:digest(candidate),owner:{uid:process.getuid(),gid:process.getgid(),mode:0o644}};
  }
  for(const base of [`${app}/dist`,`${saved}/previous-dist`]) await put(`${base}/assets/old.js`,'old-bundle');
  await put(`${saved}/previous-dist/index.html`,'previous-index');
  await put(`${saved}/candidate-dist/index.html`,'candidate-index');
  await put(`${saved}/candidate-dist/assets/new.js`,'new-bundle');
  await put(`${saved}/core/package.json`,'{"name":"@openai-oauth/core","version":"2.0.0"}');
  await put(`${saved}/additions/chatgpt-router.js`,'router-source');
  m.previousDist=await inventory(`${saved}/previous-dist`);m.candidateDist=await inventory(`${saved}/candidate-dist`);m.core=await inventory(`${saved}/core`);m.additions['chatgpt-router.js']=digest('router-source');
  await put(`${saved}/manifest.json`,JSON.stringify(m));
  return {app,saved,targets,m,root};
}

test('callback hardening preserves SSO, isolates logs, and never forwards HTTP query',()=>{
  const original=`server {
    listen 80;
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    location = /_hearthpulse_authorize {
        internal;
        proxy_pass http://127.0.0.1:3101/api/auth/cover/authorize;
        proxy_set_header X-Cover-Sso-Key "fixture-not-a-secret";
    }
    location @cover_hearthpulse_login { return 302 https://hearthpulse.net/api/auth/cover/start; }
    location / { auth_request /_hearthpulse_authorize; proxy_pass http://127.0.0.1:3127; }
}`;
  const output=nginxCandidate(original);
  assert.equal(output.split('location = /chatgpt/callback').length,3);
  assert(output.includes('auth_request /_chatgpt_authorize;'));
  assert(output.includes('error_page 401 = @chatgpt_login;'));
  assert(output.includes('return 302 https://cover.hs-manacost.ru/chatgpt/callback;'));
  assert.equal(output.match(/access_log off;/g).length,4);
  assert.equal(output.match(/error_log \/dev\/null crit;/g).length,4);
  assert(output.includes('location / { auth_request /_hearthpulse_authorize; proxy_pass http://127.0.0.1:3127; }'));
  assert.throws(()=>nginxCandidate(output));
  assert.throws(()=>nginxCandidate(original.replace('location = /_hearthpulse_authorize','location = /changed')));
});

test('publish and rollback preserve assets, restore exact originals and retire new config',async()=>{
  const f=await fixture();const events=[];
  await publish({...f,hooks:async stage=>events.push(stage)});
  for(const [key,m] of Object.entries(f.m.files)) assert.equal(await hash(f.targets[key]),m.candidate);
  assert.equal(await hash(`${f.app}/dist/assets/old.js`),digest('old-bundle'));
  assert(events.indexOf('backend')<events.indexOf('verify'));
  await rollback(f);
  for(const [key,m] of Object.entries(f.m.files)) assert.equal(await hash(f.targets[key]),m.previous);
  assert.equal(await hash(`${f.app}/dist/assets/new.js`),digest('new-bundle'));
  const retired=(await fs.readdir(f.saved)).filter(name=>name.startsWith('retired-drop-'));
  assert.equal(retired.length,1);assert.equal(await hash(`${f.saved}/${retired[0]}/config`),f.m.files.drop.candidate);
});

test('redeployment after rollback supports another rollback and failure-triggered rollback',async()=>{
  const f=await fixture();let restored=0;
  const hooks=async stage=>{if(stage==='restore') restored++;};
  for(let i=0;i<2;i++) {await publish({...f,hooks});await rollback({...f,hooks});}
  assert.equal(restored,2);
  await assert.rejects(publish({...f,hooks:async stage=>{if(stage==='backend') throw new Error('retry startup failed');await hooks(stage);}}),/previous release restored/);
  assert.equal(restored,3);
  for(const [key,m] of Object.entries(f.m.files)) assert.equal(await hash(f.targets[key]),m.previous);
  for(const key of ['drop','env']) {
    const retired=(await fs.readdir(f.saved)).filter(name=>name.startsWith(`retired-${key}-`));
    assert.equal(retired.length,3);
    for(const directory of retired) assert.equal(await hash(`${f.saved}/${directory}/config`),f.m.files[key].candidate);
  }
});

for(const failure of ['nginx','written:package','written:env','written:drop','written:server','backend','verify']) {
  test(`failed ${failure} restores the previous deployment`,async()=>{
    const f=await fixture();let restored=false;
    await assert.rejects(publish({...f,hooks:async stage=>{if(stage===failure) throw new Error('simulated failure');if(stage==='restore') restored=true;}}),/previous release restored/);
    assert(restored);
    for(const [key,m] of Object.entries(f.m.files)) assert.equal(await hash(f.targets[key]),m.previous);
  });
}

test('foreign release, corrupt archive, symlink, and asset collisions fail closed',async()=>{
  const drift=await fixture();await fs.writeFile(drift.targets.server,'another-release');
  await assert.rejects(publish(drift),/Preflight drift/);await assert.rejects(rollback(drift),/Rollback drift/);
  assert.equal(await hash(drift.targets.index),drift.m.files.index.previous);
  const corrupt=await fixture();await fs.writeFile(`${corrupt.saved}/candidate/server`,'corrupted');await assert.rejects(validateArchive(corrupt.saved));
  const link=await fixture();await fs.rename(link.targets.server,`${link.targets.server}.old`);await fs.symlink(`${link.targets.server}.old`,link.targets.server);await assert.rejects(publish(link),/Not regular/);
  const collision=await fixture();await put(`${collision.app}/dist/assets/new.js`,'collision');await assert.rejects(publish(collision),/Collision/);
  assert.equal(await hash(collision.targets.index),collision.m.files.index.previous);
});
