import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  buildBriaRequest,
  createBriaBodyAdmission,
  createBriaRequestRateLimiter,
  createBriaRmbgService,
  isBriaEnabled,
  sanitizeBriaBodyError,
  subjectLayerCacheKey,
} from './bria-rmbg.js';

// Complete 2x1 RGBA PNGs with valid CRCs and zlib streams. The normal fixture
// has one visible and one transparent pixel, so it is a meaningful cutout.
const tinyPngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8Dwn+E/AwMAD/kC/ngnZtwAAAAASUVORK5CYII=', 'base64');
const opaquePngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=', 'base64');
const transparentPngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP4z8DAwAAkAAr+Af85+/pgAAAAAElFTkSuQmCC', 'base64');
const truncatedPngBytes = tinyPngBytes.subarray(0, 26);
const trnsBeforePalettePngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAMAAADD/I+4AAAAAnRSTlP/AOW3MEoAAAAGUExURf8AAAD/ANKH73EAAAALSURBVHicY2BgBAAABAACv3o/SgAAAABJRU5ErkJggg==', 'base64');
const duplicatePalettePngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAMAAADD/I+4AAAABlBMVEX/AAAA/wDSh+9xAAAABlBMVEX/AAAA/wDSh+9xAAAAAnRSTlP/AOW3MEoAAAALSURBVHicY2BgBAAABAACv3o/SgAAAABJRU5ErkJggg==', 'base64');
const grayscaleWithPalettePngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAAAAADRSSBWAAAABlBMVEX/AAAA/wDSh+9xAAAAAnRSTlMAAHaTzTgAAAALSURBVHicY/jPAAACAQEAMrorkgAAAABJRU5ErkJggg==', 'base64');
const tinyPng = tinyPngBytes.toString('base64');
const secondTinyPngBytes = Buffer.concat([tinyPngBytes, Buffer.from([0x01])]);
const secondTinyPng = secondTinyPngBytes.toString('base64');
const tempDirs = [];

async function tempCache() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-bria-test-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('BRIA RMBG server boundary', () => {
  it('requires both the server token and explicit feature flag', () => {
    assert.equal(isBriaEnabled({ BRIA_API_TOKEN: 'secret', BRIA_RMBG_ENABLED: 'true' }), true);
    assert.equal(isBriaEnabled({ BRIA_API_TOKEN: 'secret' }), false);
    assert.equal(isBriaEnabled({ BRIA_RMBG_ENABLED: 'true' }), false);
  });

  it('bounds concurrent request bodies before JSON buffering', () => {
    const admit = createBriaBodyAdmission(2);
    const request = () => Object.assign(new EventEmitter(), { method: 'POST' });
    const firstResponse = new EventEmitter();
    const accepted = [];

    admit(request(), firstResponse, (error) => accepted.push(error || null));
    admit(request(), new EventEmitter(), (error) => accepted.push(error || null));
    admit(request(), new EventEmitter(), (error) => accepted.push(error || null));
    assert.equal(accepted[0], null);
    assert.equal(accepted[1], null);
    assert.equal(accepted[2]?.status, 503);
    assert.equal(accepted[2]?.code, 'BRIA_BUSY');

    firstResponse.emit('finish');
    admit(request(), new EventEmitter(), (error) => accepted.push(error || null));
    assert.equal(accepted[3], null);
  });

  it('rejects unsupported methods before body parsing', () => {
    const admit = createBriaBodyAdmission(2);
    const request = Object.assign(new EventEmitter(), { method: 'PUT' });
    admit(request, new EventEmitter(), (error) => {
      assert.equal(error?.status, 405);
      assert.equal(error?.code, 'BRIA_METHOD_NOT_ALLOWED');
    });
  });

  it('sanitizes parser failures without retaining uploaded image data', () => {
    const privateBody = `{"data":"${'private-art'.repeat(100)}"`;
    let sanitized;
    sanitizeBriaBodyError({
      status: 400,
      type: 'entity.parse.failed',
      body: privateBody,
      message: `Unexpected token in ${privateBody}`,
    }, null, null, (error) => { sanitized = error; });
    assert.equal(sanitized?.status, 400);
    assert.equal(sanitized?.code, 'BRIA_INVALID_JSON');
    assert.equal(Object.hasOwn(sanitized, 'body'), false);
    assert.equal(JSON.stringify(sanitized).includes('private-art'), false);
    assert.equal(sanitized.message.includes('private-art'), false);
  });

  it('hard-bounds per-client rate bucket cardinality', () => {
    let now = 1_000;
    const limit = createBriaRequestRateLimiter({
      limit: 2,
      windowMs: 1_000,
      maxBuckets: 2,
      now: () => now,
    });
    const response = new EventEmitter();
    const results = [];
    limit({ ip: 'one' }, response, (error) => results.push(error || null));
    limit({ ip: 'two' }, response, (error) => results.push(error || null));
    limit({ ip: 'three' }, response, (error) => results.push(error || null));
    assert.equal(results[0], null);
    assert.equal(results[1], null);
    assert.equal(results[2]?.status, 429);
    now += 1_001;
    limit({ ip: 'three' }, response, (error) => results.push(error || null));
    assert.equal(results[3], null);
  });

  it('validates canonical image bytes before building the documented request', () => {
    assert.deepEqual(buildBriaRequest({ data: tinyPng, mimeType: 'image/png' }), {
      image: tinyPng,
      preserve_alpha: true,
      sync: true,
    });
    assert.throws(() => buildBriaRequest({ data: tinyPng, mimeType: 'image/svg+xml' }), /unsupported/i);
    assert.throws(() => buildBriaRequest({ data: `${tinyPng}=`, mimeType: 'image/png' }), /base64/i);
    assert.throws(() => buildBriaRequest({ data: Buffer.from('GIF89a').toString('base64'), mimeType: 'image/png' }), /MIME/i);
  });

  it('uses a versioned content hash rather than filenames or user metadata', () => {
    const first = subjectLayerCacheKey(tinyPngBytes, 'rmbg-2.0');
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first, subjectLayerCacheKey(tinyPngBytes, 'rmbg-2.0'));
    assert.notEqual(first, subjectLayerCacheKey(tinyPngBytes, 'rmbg-2.1'));
  });

  it('calls the official endpoint with a server-owned token and caches the transparent result', async () => {
    const calls = [];
    const service = createBriaRmbgService({
      apiToken: 'server-secret',
      cacheDir: await tempCache(),
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        if (calls.length === 1) {
          return new Response(JSON.stringify({ result: { image_url: 'https://temp.bria.ai/cutout.png' }, request_id: 'safe-id' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(tinyPngBytes, { headers: { 'Content-Type': 'image/png' } });
      },
    });

    const first = await service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    assert.equal(first.cache, 'miss');
    assert.equal(first.data, tinyPng);
    assert.equal(first.mimeType, 'image/png');
    assert.equal(calls[0].url, 'https://engine.prod.bria-api.com/v2/image/edit/remove_background');
    assert.equal(calls[0].init.headers.api_token, 'server-secret');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(JSON.parse(calls[0].init.body).sync, true);
    assert.equal(JSON.stringify(first).includes('server-secret'), false);

    const second = await service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    assert.equal(second.cache, 'hit');
    assert.equal(calls.length, 2, 'cache hit must not make another billable request');
  });

  it('proves cache writability before any billable provider request', async () => {
    const parent = await tempCache();
    const blockedCachePath = path.join(parent, 'not-a-directory');
    await fs.writeFile(blockedCachePath, 'blocked');
    let calls = 0;
    const service = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir: blockedCachePath,
      fetchImpl: async () => {
        calls += 1;
        throw new Error('provider must not be called');
      },
    });

    await assert.rejects(
      () => service.ready(),
      (error) => error?.status === 503 && error?.code === 'BRIA_CACHE_UNAVAILABLE',
    );
    await assert.rejects(
      () => service.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 503 && error?.code === 'BRIA_CACHE_UNAVAILABLE',
    );
    assert.equal(service.isReady(), false);
    assert.equal(calls, 0);
  });

  it('returns an already-paid cutout once when cache persistence fails, then fails closed', async () => {
    const cacheDir = await tempCache();
    let calls = 0;
    let cacheErrors = 0;
    const service = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir,
      onCacheError: () => { cacheErrors += 1; },
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ result: { image_url: 'https://temp.bria.ai/cutout.png' } }));
        }
        await fs.rm(cacheDir, { recursive: true, force: true });
        await fs.writeFile(cacheDir, 'blocked');
        return new Response(tinyPngBytes, { headers: { 'Content-Type': 'image/png' } });
      },
    });
    await service.ready();

    const result = await service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    assert.equal(result.cache, 'bypass');
    assert.equal(result.data, tinyPng);
    assert.equal(service.isReady(), false);
    assert.equal(cacheErrors, 1);

    await assert.rejects(
      () => service.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 503 && error?.code === 'BRIA_CACHE_UNAVAILABLE',
    );
    assert.equal(calls, 2, 'a broken cache must block the next request before another paid call');
  });

  it('coalesces concurrent requests for identical source bytes', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const service = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir: await tempCache(),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          await gate;
          return new Response(JSON.stringify({ result: { image_url: 'https://temp.bria.ai/cutout.png' } }));
        }
        return new Response(tinyPngBytes, { headers: { 'Content-Type': 'image/png' } });
      },
    });

    const first = service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    const second = service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.data, tinyPng);
    assert.equal(b.data, tinyPng);
    assert.equal(calls, 2);
  });

  it('maps provider errors without exposing its body or token', async () => {
    const service = createBriaRmbgService({
      apiToken: 'server-secret',
      cacheDir: await tempCache(),
      fetchImpl: async () => new Response('private provider detail', { status: 401 }),
    });
    await assert.rejects(
      () => service.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 503
        && error?.code === 'BRIA_AUTH'
        && !error.message.includes('private provider detail')
        && !error.message.includes('server-secret'),
    );
  });

  it('does not follow redirects carrying the provider credential', async () => {
    const calls = [];
    const service = createBriaRmbgService({
      apiToken: 'server-secret',
      cacheDir: await tempCache(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://attacker.example/token' },
        });
      },
    });
    await assert.rejects(
      () => service.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 502 && error?.code === 'BRIA_REJECTED',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, 'error');
  });

  it('rejects non-BRIA result hosts and result redirects before private addresses can be fetched', async () => {
    let calls = 0;
    const unsafeService = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir: await tempCache(),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ result: { image_url: 'https://127.0.0.1/private.png' } }));
      },
    });
    await assert.rejects(
      () => unsafeService.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 502 && error?.code === 'BRIA_INVALID_RESPONSE',
    );
    assert.equal(calls, 1, 'private result URL must never be fetched');

    const redirectCalls = [];
    const redirectService = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir: await tempCache(),
      fetchImpl: async (url, init) => {
        redirectCalls.push({ url, init });
        if (redirectCalls.length === 1) {
          return new Response(JSON.stringify({ result: { image_url: 'https://temp.bria.ai/result.png' } }));
        }
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://169.254.169.254/latest/meta-data' },
        });
      },
    });
    await assert.rejects(
      () => redirectService.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 502 && error?.code === 'BRIA_RESULT_UNAVAILABLE',
    );
    assert.equal(redirectCalls.length, 2);
    assert.equal(redirectCalls[1].init.redirect, 'error');
  });

  it('holds provider concurrency until paid operations settle', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const service = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir: await tempCache(),
      providerConcurrency: 1,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          await gate;
          return new Response(JSON.stringify({ result: { image_url: 'https://temp.bria.ai/first.png' } }));
        }
        return new Response(tinyPngBytes, { headers: { 'Content-Type': 'image/png' } });
      },
    });

    const first = service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    await new Promise((resolve) => setImmediate(resolve));
    try {
      await assert.rejects(
        () => service.removeBackground({ data: secondTinyPng, mimeType: 'image/png' }),
        (error) => error?.status === 503 && error?.code === 'BRIA_BUSY',
      );
    } finally {
      release();
    }
    await first;
    assert.equal(calls, 2);
  });

  it('enforces a global provider-start budget across distinct sources', async () => {
    let calls = 0;
    const service = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir: await tempCache(),
      providerBudgetLimit: 1,
      providerBudgetWindowMs: 60_000,
      fetchImpl: async () => {
        calls += 1;
        return calls % 2 === 1
          ? new Response(JSON.stringify({ result: { image_url: 'https://temp.bria.ai/result.png' } }))
          : new Response(tinyPngBytes, { headers: { 'Content-Type': 'image/png' } });
      },
    });
    await service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    await assert.rejects(
      () => service.removeBackground({ data: secondTinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 429 && error?.code === 'BRIA_BUDGET_EXHAUSTED',
    );
    assert.equal(calls, 2);
  });

  it('evicts the oldest cache entry before exceeding its configured entry quota', async () => {
    let calls = 0;
    const cacheDir = await tempCache();
    const service = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir,
      cacheMaxEntries: 1,
      fetchImpl: async () => {
        calls += 1;
        return calls % 2 === 1
          ? new Response(JSON.stringify({ result: { image_url: `https://temp.bria.ai/${calls}.png` } }))
          : new Response(tinyPngBytes, { headers: { 'Content-Type': 'image/png' } });
      },
    });

    await service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    await service.removeBackground({ data: secondTinyPng, mimeType: 'image/png' });
    const cacheFiles = (await fs.readdir(cacheDir)).filter((name) => name.endsWith('.json'));
    assert.equal(cacheFiles.length, 1);
    const firstAgain = await service.removeBackground({ data: tinyPng, mimeType: 'image/png' });
    assert.equal(firstAgain.cache, 'miss');
    assert.equal(calls, 6);
  });

  it('keeps one timeout over metadata and result download and never retries', async () => {
    let calls = 0;
    const service = createBriaRmbgService({
      apiToken: 'secret',
      cacheDir: await tempCache(),
      timeoutMs: 5,
      fetchImpl: async (_url, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
      },
    });
    await assert.rejects(
      () => service.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
      (error) => error?.status === 504 && error?.code === 'BRIA_TIMEOUT',
    );
    assert.equal(calls, 1);
  });

  it('rejects undecodable, fully opaque, or fully transparent output before caching it', async () => {
    for (const [contentType, bytes] of [
      ['text/html', Buffer.from('<html>')],
      ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
      ['image/png', truncatedPngBytes],
      ['image/png', opaquePngBytes],
      ['image/png', transparentPngBytes],
      ['image/png', trnsBeforePalettePngBytes],
      ['image/png', duplicatePalettePngBytes],
      ['image/png', grayscaleWithPalettePngBytes],
    ]) {
      let calls = 0;
      const service = createBriaRmbgService({
        apiToken: 'secret',
        cacheDir: await tempCache(),
        fetchImpl: async () => {
          calls += 1;
          return calls === 1
            ? new Response(JSON.stringify({ result: { image_url: 'https://temp.bria.ai/cutout' } }))
            : new Response(bytes, { headers: { 'Content-Type': contentType } });
        },
      });
      await assert.rejects(
        () => service.removeBackground({ data: tinyPng, mimeType: 'image/png' }),
        (error) => error?.status === 502 && error?.code === 'BRIA_INVALID_IMAGE',
      );
    }
  });
});
