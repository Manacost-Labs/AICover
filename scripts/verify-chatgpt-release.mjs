import assert from 'node:assert/strict';
import https from 'node:https';
import {createHash} from 'node:crypto';

const origin='https://cover.hs-manacost.ru';
const base='http://127.0.0.1:3127';
const expectedIndex='f33a4568fa057e67d2a74d1d5e6c93f277803e085f3aa0b075d528bc80400e9e';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function local(route,init={}) {
  return fetch(base+route,{redirect:'manual',signal:AbortSignal.timeout(5000),...init});
}
const post=(route,body={},cookie,requestOrigin=origin)=>local(route,{method:'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
function publicHeaders(route,originIp) {
  return new Promise((resolve,reject)=>{
    const req=https.get(origin+route,{timeout:10000,...(originIp?{lookup:(_name,_opts,callback)=>callback(null,[{address:originIp,family:4}])}:{})},res=>{
      const result={status:res.statusCode,location:res.headers.location,referrer:res.headers['referrer-policy'],cache:res.headers['cache-control']};res.resume();res.on('end',()=>resolve(result));
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('HTTP check timeout')));
  });
}

const index=await local('/');assert.equal(index.status,200);assert.equal(digest(Buffer.from(await index.arrayBuffer())),expectedIndex);
const health=await local('/api/health');assert.deepEqual(await health.json(),{ok:true});
const capabilities=await local('/api/runtime-capabilities');assert.equal((await capabilities.json()).gemini,true);
const status=await local('/api/chatgpt/session');assert.deepEqual(await status.json(),{enabled:true,connected:false,imageVerified:false});assert.match(status.headers.get('Cache-Control'),/no-store/);
const denied=await post('/api/chatgpt/login',{},undefined,'https://untrusted.invalid');assert.equal(denied.status,403);
const unauthenticated=await post('/api/chatgpt/images',{model:'gpt-image-2',prompt:'never submitted'});assert.equal(unauthenticated.status,401);

// Exercise only the local PKCE URL builder. Do not visit OpenAI, exchange codes,
// access any existing cookie, or submit a provider request.
let cookie;
try {
  const login=await post('/api/chatgpt/login');assert.equal(login.status,200);
  const header=login.headers.get('Set-Cookie');assert(header);assert.match(header,/HttpOnly/i);assert.match(header,/Secure/i);assert.match(header,/SameSite=Lax/i);assert.match(header,/Path=\/api\/chatgpt/i);
  cookie=header.split(';')[0];
  const url=new URL((await login.json()).authorizationUrl);assert.equal(url.origin,'https://auth.openai.com');assert.equal(url.pathname,'/oauth/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:1455/auth/callback');
  const state=url.searchParams.get('state');assert(state.startsWith('oo2_'));
  const relay=JSON.parse(Buffer.from(state.slice(4),'base64url').toString());assert.equal(relay.callbackUrl,origin+'/chatgpt/callback');
  const wrong=await post('/api/chatgpt/callback',{code:'release-fixture-not-an-auth-code',state:'wrong-state'},cookie);assert.equal(wrong.status,400);
  const independent=await local('/api/chatgpt/session');assert.deepEqual(await independent.json(),{enabled:true,connected:false,imageVerified:false});
} finally {if(cookie) {const logout=await post('/api/chatgpt/disconnect',{},cookie);assert.equal(logout.status,200);}}

const callback=await local('/chatgpt/callback?code=release-fixture&state=release-fixture');assert.equal(callback.status,200);assert.equal(callback.headers.get('Referrer-Policy'),'no-referrer');assert.match(callback.headers.get('Cache-Control'),/no-store/);assert.equal(digest(Buffer.from(await callback.arrayBuffer())),expectedIndex);
const gates=[];
for(const [layer,ip] of [['public',undefined],['origin','151.80.21.140']]) {
  for(const route of ['/','/api/chatgpt/session','/chatgpt/callback?code=release-fixture&state=release-fixture']) {
    const response=await publicHeaders(route,ip);assert.equal(response.status,302,`${layer} SSO gate: ${route}`);assert.equal(response.location,'https://hearthpulse.net/api/auth/cover/start');
    if(route.startsWith('/chatgpt/callback')) {assert.equal(response.referrer,'no-referrer');assert.match(response.cache,/no-store/);}
    gates.push({layer,path:route.split('?')[0],status:response.status});
  }
}
console.log(JSON.stringify({index:expectedIndex,health:true,gemini:true,chatgptEnabled:true,localPkceLoginAndDisconnect:true,csrfAndMissingSessionRejected:true,callbackHeaders:true,ssoGates:gates,realOAuthOrGeneration:false},null,2));
