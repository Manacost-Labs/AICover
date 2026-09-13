import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOpenRouterModelAvailability } from './openrouter-models.js';

describe('OpenRouter model availability', () => {
  it('marks a catalog-only model unavailable and keeps upstream details private', async () => {
    const requested = [];
    const availability = createOpenRouterModelAvailability({
      modelIds: ['meta/muse-image', 'x-ai/grok-imagine-image-2.0'],
      fetchImpl: async (url) => {
        requested.push(url);
        const endpoints = String(url).includes('/meta/muse-image/') ? [] : [{ name: 'private endpoint' }];
        return new Response(JSON.stringify({ data: { endpoints } }));
      },
      ttlMs: 60_000,
    });

    assert.deepEqual(await availability.list(), [
      { id: 'meta/muse-image', availability: 'unavailable' },
      { id: 'x-ai/grok-imagine-image-2.0', availability: 'available' },
    ]);
    assert.equal(requested.length, 2);
    assert.equal(JSON.stringify(await availability.list()).includes('private endpoint'), false);
    assert.equal(requested.length, 2, 'second read uses the bounded cache');
  });

  it('returns unknown instead of disabling models on a catalog outage', async () => {
    const availability = createOpenRouterModelAvailability({
      modelIds: ['openai/gpt-image-2'],
      fetchImpl: async () => new Response('down', { status: 503 }),
    });
    assert.deepEqual(await availability.list(), [
      { id: 'openai/gpt-image-2', availability: 'unknown' },
    ]);
  });

  it('cancels a catalog response that exceeds the byte limit without a content-length', async () => {
    let cancelled = false;
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const availability = createOpenRouterModelAvailability({
      modelIds: ['openai/gpt-image-2'],
      fetchImpl: async () => new Response(oversized, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    assert.deepEqual(await availability.list(), [
      { id: 'openai/gpt-image-2', availability: 'unknown' },
    ]);
    assert.equal(cancelled, true);
  });
});
