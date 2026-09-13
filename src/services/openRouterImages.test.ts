import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OPENROUTER_IMAGE_MODELS,
  OpenRouterImageError,
  generateOpenRouterImage,
  getOpenRouterModel,
  isOpenRouterImageModel,
  normalizeOpenRouterSettings,
  loadOpenRouterModelAvailability,
  type OpenRouterImageRequest,
} from './openRouterImages';

const request = {
  model: 'x-ai/grok-imagine-image-2.0',
  prompt: 'Create a Hearthstone cover',
  references: [{ mimeType: 'image/png', data: 'iVBORw0KGgo=' }],
  aspectRatio: '16:9',
  resolution: '2K',
} satisfies OpenRouterImageRequest;

describe('OpenRouter image client adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('exposes all requested model IDs and enables single-reference models through a contact sheet', () => {
    expect(OPENROUTER_IMAGE_MODELS.map(model => model.id)).toEqual([
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
    expect(getOpenRouterModel('meta/muse-image')).toMatchObject({ coverCompatible: true, referenceStrategy: 'contact-sheet' });
    expect(getOpenRouterModel('krea/krea-2-large')).toMatchObject({ coverCompatible: true, referenceStrategy: 'contact-sheet' });
    expect(isOpenRouterImageModel('attacker/other-model')).toBe(false);
  });

  it('normalizes resolution and aspect ratio when switching providers', () => {
    expect(normalizeOpenRouterSettings('bytedance-seed/seedream-5-0-lite', '1K', '16:9'))
      .toEqual({ imageSize: '2K', aspectRatio: '16:9' });
    expect(normalizeOpenRouterSettings('qwen/qwen-image-3-pro', '4K', '21:9'))
      .toEqual({ imageSize: '2K', aspectRatio: '16:9' });
    expect(normalizeOpenRouterSettings('recraft/recraft-v4-styles-pro', '1K', '16:9'))
      .toEqual({ imageSize: '1K', aspectRatio: '16:9' });
  });

  it('starts one same-origin job and polls it without exposing a provider key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateOpenRouterImage(request, undefined, { pollIntervalMs: 0, maxWaitMs: 1_000 }))
      .resolves.toBe('data:image/png;base64,iVBORw0KGgo=');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/thumbnail/openrouter-generate', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/thumbnail/openrouter-jobs/9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/thumbnail/openrouter-jobs/9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', expect.objectContaining({
      method: 'DELETE',
      credentials: 'same-origin',
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('Bearer');
  });

  it.each([
    [413, 'слишком большие'],
    [422, 'не поддерживаются'],
    [429, 'Слишком много'],
    [503, 'временно недоступен'],
    [504, 'не ответил вовремя'],
  ])('maps HTTP %s to a stable user-facing error', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    await expect(generateOpenRouterImage(request)).rejects.toThrow(message);
  });

  it.each([
    ['MODEL_UNAVAILABLE', 'нет активного endpoint'],
    ['OPENROUTER_CREDITS', 'балансе OpenRouter'],
    ['REFERENCE_PAYLOAD_TOO_LARGE', 'Cover уже сжал'],
    ['UNSUPPORTED_PARAMETERS', 'параметры'],
    ['PROVIDER_UNAVAILABLE', 'временно недоступен'],
  ])('maps safe error code %s to actionable copy', async (code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'private upstream detail',
      code,
    }), { status: code === 'OPENROUTER_CREDITS' ? 402 : 503 })));
    await expect(generateOpenRouterImage(request)).rejects.toThrow(message);
    await expect(generateOpenRouterImage(request)).rejects.not.toThrow('private upstream detail');
  });

  it('loads only the typed model availability contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [
      { id: 'meta/muse-image', availability: 'unavailable', upstream: 'private' },
      { id: 'x-ai/grok-imagine-image-2.0', availability: 'available' },
      { id: 'attacker/model', availability: 'available' },
    ] }))));
    await expect(loadOpenRouterModelAvailability()).resolves.toEqual({
      'meta/muse-image': 'unavailable',
      'x-ai/grok-imagine-image-2.0': 'available',
    });
  });

  it('does not surface provider response details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'upstream secret response',
    }), { status: 502 })));
    await expect(generateOpenRouterImage(request)).rejects.toEqual(expect.any(OpenRouterImageError));
    await expect(generateOpenRouterImage(request)).rejects.not.toThrow('upstream secret response');
  });

  it('returns a received image even when acknowledgement cleanup fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockRejectedValueOnce(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateOpenRouterImage(request, undefined, { pollIntervalMs: 0, maxWaitMs: 1_000 }))
      .resolves.toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('publishes a validated paid result before acknowledging the server job', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const publish = vi.fn(async () => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    await expect(generateOpenRouterImage(request, undefined, {
      pollIntervalMs: 0,
      maxWaitMs: 1_000,
      onResult: publish,
    })).resolves.toBe('data:image/png;base64,iVBORw0KGgo=');

    expect(publish).toHaveBeenCalledWith('data:image/png;base64,iVBORw0KGgo=');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not acknowledge a paid result when durable publication fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateOpenRouterImage(request, undefined, {
      pollIntervalMs: 0,
      maxWaitMs: 1_000,
      onResult: async () => { throw new Error('persistence unavailable'); },
    })).rejects.toThrow('persistence unavailable');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).includes('/openrouter-jobs/') && init?.method === 'DELETE')).toBe(false);
  });

  it('aborts polling and never starts a second generation request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockImplementationOnce(async () => {
        controller.abort();
        return new Response(JSON.stringify({ status: 'pending' }));
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateOpenRouterImage(request, controller.signal, { pollIntervalMs: 0, maxWaitMs: 1_000 }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/thumbnail/openrouter-generate')).toHaveLength(1);
  });

  it('stops locally when the polling deadline expires', async () => {
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock += 10);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValue(new Response(JSON.stringify({ status: 'pending' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateOpenRouterImage(request, undefined, { pollIntervalMs: 0, maxWaitMs: 15 }))
      .rejects.toThrow('не ответил вовремя');
  });

  it('also applies the deadline while the initial POST is stalled', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateOpenRouterImage(request, undefined, { maxWaitMs: 5 }))
      .rejects.toThrow('не ответил вовремя');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves cancellation while reading a stalled JSON response body', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: () => new Promise((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        controller.abort();
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateOpenRouterImage(request, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed job and image responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: '../other-job' }), { status: 202 })));
    await expect(generateOpenRouterImage(request)).rejects.toEqual(expect.any(OpenRouterImageError));
  });
});
