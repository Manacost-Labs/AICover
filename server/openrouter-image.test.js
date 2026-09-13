import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import {
  OPENROUTER_IMAGE_MODELS,
  acknowledgeOpenRouterJob,
  buildOpenRouterImageRequest,
  buildOpenRouterRequestHeaders,
  createOpenRouterBodyAdmission,
  extractOpenRouterImage,
  extractOpenRouterImageResponse,
  isOpenRouterEnabled,
  requestOpenRouterImage,
} from './openrouter-image.js';

const tinyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
const tinyWebp = Buffer.from('RIFF\0\0\0\0WEBP', 'binary').toString('base64');

describe('OpenRouter image request boundary', () => {
  it('contains the exact verified OpenRouter image-model allowlist', () => {
    assert.deepEqual(Object.keys(OPENROUTER_IMAGE_MODELS), [
      'openai/gpt-image-2',
      'meta/muse-image',
      'recraft/recraft-v4-styles-pro',
      'bytedance-seed/seedream-5-0-lite',
      'bytedance-seed/seedream-5-0-pro',
      'x-ai/grok-imagine-image-2.0',
      'qwen/qwen-image-3-pro',
      'krea/krea-2-large',
      'sourceful/riverflow-v2.5-pro',
      'sourceful/riverflow-v2.5-fast',
    ]);
  });

  it('defaults to GPT Image 2 but rejects a caller-controlled unknown model', () => {
    const request = buildOpenRouterImageRequest({
      prompt: 'Finished thumbnail',
      references: [{ mimeType: 'image/png', data: tinyPng }],
    });

    assert.equal(request.model, 'openai/gpt-image-2');
    assert.equal(request.quality, 'high');
    assert.equal(request.background, 'opaque');
    assert.equal(Object.hasOwn(request, 'size'), false);
    assert.equal(Object.hasOwn(request, 'aspect_ratio'), false);
    assert.match(request.input_references[0].image_url.url, /^data:image\/png;base64,/);

    assert.throws(() => buildOpenRouterImageRequest({
      model: 'attacker/other-model',
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: tinyPng }],
    }), /not available/);

    for (const inheritedProperty of ['__proto__', 'constructor', 'toString']) {
      assert.throws(() => buildOpenRouterImageRequest({
        model: inheritedProperty,
        prompt: 'x',
        references: [],
      }), /not available/);
    }
  });

  it('sends only model-supported fields for Seedream, Grok, Recraft and Riverflow', () => {
    const references = [
      { mimeType: 'image/png', data: tinyPng },
      { mimeType: 'image/webp', data: tinyWebp },
    ];
    assert.deepEqual(buildOpenRouterImageRequest({
      model: 'bytedance-seed/seedream-5-0-pro',
      prompt: 'x',
      references,
      aspectRatio: '16:9',
      resolution: '2K',
    }), {
      model: 'bytedance-seed/seedream-5-0-pro',
      prompt: 'x',
      n: 1,
      resolution: '2K',
      aspect_ratio: '16:9',
      input_references: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${tinyPng}` } },
        { type: 'image_url', image_url: { url: `data:image/webp;base64,${tinyWebp}` } },
      ],
    });

    const grok = buildOpenRouterImageRequest({
      model: 'x-ai/grok-imagine-image-2.0', prompt: 'x', references, aspectRatio: '3:2', resolution: '1K',
    });
    assert.equal(grok.quality, 'medium');
    assert.equal(Object.hasOwn(grok, 'background'), false);

    const recraft = buildOpenRouterImageRequest({
      model: 'recraft/recraft-v4-styles-pro', prompt: 'x', references, aspectRatio: '4:3',
    });
    assert.equal(Object.hasOwn(recraft, 'resolution'), false);
    assert.equal(Object.hasOwn(recraft, 'quality'), false);

    const riverPro = buildOpenRouterImageRequest({
      model: 'sourceful/riverflow-v2.5-pro', prompt: 'x', references, aspectRatio: '21:9', resolution: '4K',
    });
    assert.equal(riverPro.output_format, 'png');
    assert.equal(riverPro.background, 'opaque');

    const riverFast = buildOpenRouterImageRequest({
      model: 'sourceful/riverflow-v2.5-fast', prompt: 'x', references, aspectRatio: '21:9', resolution: '2K',
    });
    assert.equal(riverFast.output_format, 'jpeg');
    assert.equal(riverFast.background, 'opaque');
  });

  it('holds Muse at the server trust boundary and accepts the Krea contact sheet', () => {
    assert.throws(() => buildOpenRouterImageRequest({
      model: 'meta/muse-image',
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: tinyPng }],
    }), (error) => error?.status === 503 && error?.code === 'MODEL_UNAVAILABLE');

    const krea = buildOpenRouterImageRequest({
      model: 'krea/krea-2-large',
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: tinyPng }],
      aspectRatio: '16:9',
      resolution: '1K',
    });
    assert.equal(krea.input_references.length, 1);
  });

  it('rejects reference and setting combinations that the selected model does not support', () => {
    assert.throws(() => buildOpenRouterImageRequest({
      model: 'krea/krea-2-large',
      prompt: 'x',
      references: Array.from({ length: 2 }, () => ({ mimeType: 'image/png', data: tinyPng })),
    }), /at most 1/);
    assert.throws(() => buildOpenRouterImageRequest({
      model: 'qwen/qwen-image-3-pro',
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: tinyPng }],
      aspectRatio: '21:9',
    }), /aspect ratio/);
    assert.throws(() => buildOpenRouterImageRequest({
      model: 'bytedance-seed/seedream-5-0-lite',
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: tinyPng }],
      resolution: '1K',
    }), /resolution/);
  });

  it('requires an explicit feature flag as well as the server-only key', () => {
    assert.equal(isOpenRouterEnabled({ OPENROUTER_API_KEY: 'secret', OPENROUTER_ENABLED: 'true' }), true);
    assert.equal(isOpenRouterEnabled({ OPENROUTER_API_KEY: 'secret' }), false);
    assert.equal(isOpenRouterEnabled({ OPENROUTER_ENABLED: 'true' }), false);
  });

  it('rejects unsupported files and too many references', () => {
    assert.throws(() => buildOpenRouterImageRequest({
      prompt: 'x',
      references: [{ mimeType: 'image/svg+xml', data: tinyPng }],
    }), /unsupported image type/);

    assert.throws(() => buildOpenRouterImageRequest({
      prompt: 'x',
      references: Array.from({ length: 17 }, () => ({ mimeType: 'image/png', data: tinyPng })),
    }), /at most 16/);
  });

  it('rejects spoofed MIME types and non-canonical base64', () => {
    const gif = Buffer.from('GIF89a', 'ascii').toString('base64');
    assert.throws(() => buildOpenRouterImageRequest({
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: gif }],
    }), /does not match/);

    assert.throws(() => buildOpenRouterImageRequest({
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: `${tinyPng}=\n` }],
    }), /valid base64/);
  });

  it('normalizes a base64 provider response to a data URL', () => {
    assert.equal(
      extractOpenRouterImage({ data: [{ b64_json: tinyWebp, media_type: 'image/webp' }] }),
      `data:image/webp;base64,${tinyWebp}`,
    );
  });

  it('rejects a provider payload whose declared MIME does not match its bytes', () => {
    assert.throws(() => extractOpenRouterImage({
      data: [{ b64_json: tinyPng, media_type: 'image/jpeg' }],
    }), /does not match/);
  });

  it('builds only the official server-owned OpenRouter headers', () => {
    assert.deepEqual(buildOpenRouterRequestHeaders('secret'), {
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cover.hs-manacost.ru',
      'X-OpenRouter-Title': 'Manacost Cover',
    });
  });

  it('reads a bounded provider response before extracting the image', async () => {
    const response = new Response(JSON.stringify({
      data: [{ b64_json: tinyWebp, media_type: 'image/webp' }],
    }));
    assert.equal(await extractOpenRouterImageResponse(response), `data:image/webp;base64,${tinyWebp}`);
  });

  it('rejects an oversized provider response before buffering it', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel: () => { cancelled = true; } }), {
      headers: { 'Content-Length': String(24 * 1024 * 1024) },
    });
    await assert.rejects(() => extractOpenRouterImageResponse(response), /too large/);
    assert.equal(cancelled, true);
  });

  it('keeps the timeout active when headers arrive but the response body stalls', async () => {
    let cancelled = false;
    let fetchCalls = 0;
    const fetchImpl = async (_url, init) => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: () => new Promise((_resolve, reject) => {
              init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
            }),
            cancel: async () => { cancelled = true; },
          }),
        },
      };
    };

    await assert.rejects(
      () => requestOpenRouterImage({ prompt: 'x' }, 'secret', { fetchImpl, timeoutMs: 5 }),
      (error) => error?.status === 504,
    );
    assert.equal(cancelled, true);
    assert.equal(fetchCalls, 1, 'an ambiguous timeout is never retried');
  });

  for (const [upstreamStatus, expectedStatus, expectedCode] of [
    [400, 422, 'UNSUPPORTED_PARAMETERS'],
    [402, 402, 'OPENROUTER_CREDITS'],
    [404, 503, 'MODEL_UNAVAILABLE'],
    [413, 413, 'REFERENCE_PAYLOAD_TOO_LARGE'],
    [422, 422, 'UNSUPPORTED_PARAMETERS'],
    [429, 429, 'RATE_LIMITED'],
    [503, 503, 'PROVIDER_UNAVAILABLE'],
  ]) {
    it(`maps upstream ${upstreamStatus} to safe ${expectedCode} diagnostics`, async () => {
      const fetchImpl = async () => new Response(JSON.stringify({
        error: { message: 'private provider detail', metadata: { raw: 'never expose' } },
      }), { status: upstreamStatus });
      await assert.rejects(
        () => requestOpenRouterImage({ model: 'x-ai/grok-imagine-image-2.0', prompt: 'x' }, 'secret', { fetchImpl, maxAttempts: 1 }),
        (error) => error?.status === expectedStatus
          && error?.code === expectedCode
          && !error?.message.includes('private provider detail'),
      );
    });
  }

  it('retries the documented transient statuses once in the shared OpenRouter image path', async () => {
    for (const transientStatus of [429, 502, 503, 524, 529]) {
      let fetchCalls = 0;
      const retryEvents = [];
      const delays = [];
      const fetchImpl = async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) return new Response(null, { status: transientStatus, headers: { 'Retry-After': '2' } });
        return new Response(JSON.stringify({
          data: [{ b64_json: tinyPng, media_type: 'image/png' }],
        }));
      };

      const image = await requestOpenRouterImage(
        { model: 'bytedance-seed/seedream-5-0-pro', prompt: 'x' },
        'secret',
        {
          fetchImpl,
          sleepImpl: async (delayMs) => { delays.push(delayMs); },
          onRetry: (event) => retryEvents.push(event),
        },
      );
      assert.equal(image, `data:image/png;base64,${tinyPng}`);
      assert.equal(fetchCalls, 2);
      assert.deepEqual(delays, [2_000]);
      assert.deepEqual(retryEvents, [{ attempt: 1, nextAttempt: 2, status: transientStatus, delayMs: 2_000 }]);
    }
  });

  it('returns a stable diagnostic after the bounded transient retry is exhausted', async () => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ error: 'private provider detail' }), { status: 503 });
    };

    await assert.rejects(
      () => requestOpenRouterImage(
        { model: 'bytedance-seed/seedream-5-0-pro', prompt: 'x' },
        'secret',
        { fetchImpl, sleepImpl: async () => {} },
      ),
      (error) => error?.status === 503
        && error?.code === 'PROVIDER_RETRY_EXHAUSTED'
        && error?.attempts === 2
        && !error?.message.includes('private provider detail'),
    );
    assert.equal(fetchCalls, 2);
  });

  it('does not retry permanent failures or a potentially billed invalid success response', async () => {
    for (const status of [400, 401, 402, 403, 404, 413, 422, 500, 504]) {
      let fetchCalls = 0;
      const fetchImpl = async () => {
        fetchCalls += 1;
        return new Response(null, { status });
      };
      await assert.rejects(() => requestOpenRouterImage({ prompt: 'x' }, 'secret', { fetchImpl }));
      assert.equal(fetchCalls, 1);
    }

    let successCalls = 0;
    await assert.rejects(() => requestOpenRouterImage({ prompt: 'x' }, 'secret', {
      fetchImpl: async () => {
        successCalls += 1;
        return new Response('{}');
      },
    }));
    assert.equal(successCalls, 1);
  });

  it('enforces the smaller Riverflow request budget before a paid call', () => {
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(3 * 1024 * 1024 + 1),
    ]).toString('base64');
    assert.throws(() => buildOpenRouterImageRequest({
      model: 'sourceful/riverflow-v2.5-fast',
      prompt: 'x',
      references: [{ mimeType: 'image/png', data: oversized }],
    }), (error) => error?.status === 413 && error?.code === 'REFERENCE_PAYLOAD_TOO_LARGE');
  });

  it('bounds concurrent request-body admission before JSON buffering', () => {
    const admit = createOpenRouterBodyAdmission(2);
    const makeRequest = () => Object.assign(new EventEmitter(), { method: 'POST' });
    const first = makeRequest();
    const firstResponse = new EventEmitter();
    const second = makeRequest();
    const third = makeRequest();
    const accepted = [];

    admit(first, firstResponse, (error) => accepted.push(error || null));
    admit(second, new EventEmitter(), (error) => accepted.push(error || null));
    admit(third, new EventEmitter(), (error) => accepted.push(error || null));
    assert.equal(accepted[0], null);
    assert.equal(accepted[1], null);
    assert.equal(accepted[2]?.status, 503);

    first.emit('end');
    admit(makeRequest(), new EventEmitter(), (error) => accepted.push(error || null));
    assert.equal(accepted[3]?.status, 503);

    firstResponse.emit('finish');
    admit(makeRequest(), new EventEmitter(), (error) => accepted.push(error || null));
    assert.equal(accepted[4], null);
  });

  it('rejects unsupported generation methods before body parsing', () => {
    const admit = createOpenRouterBodyAdmission(2);
    const request = Object.assign(new EventEmitter(), { method: 'PUT' });
    admit(request, new EventEmitter(), (error) => assert.equal(error?.status, 405));
  });

  it('never acknowledges a pending job or frees its admission slot', () => {
    const jobs = new Map([
      ['pending', { status: 'pending', ownerKey: 'owner' }],
      ['complete', { status: 'complete', ownerKey: 'owner' }],
    ]);
    assert.throws(() => acknowledgeOpenRouterJob(jobs, 'pending', 'owner'), (error) => error?.status === 409);
    assert.equal(jobs.has('pending'), true);
    assert.throws(() => acknowledgeOpenRouterJob(jobs, 'complete', 'other'), (error) => error?.status === 404);
    assert.equal(jobs.has('complete'), true);
    acknowledgeOpenRouterJob(jobs, 'complete', 'owner');
    assert.equal(jobs.has('complete'), false);
  });
});
