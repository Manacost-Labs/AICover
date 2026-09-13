import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SubjectLayerError,
  prepareSubjectLayers,
  removeBackground,
} from './subjectLayer';
import type { ImageSource } from './generationContracts';

const source = { mimeType: 'image/png', data: 'iVBORw0KGgo=' } satisfies ImageSource;
const cacheKey = 'a'.repeat(64);

describe('BRIA subject-layer client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses only the same-origin endpoint and returns a typed transparent layer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: 'rmbg-2.0',
      cache: 'miss',
      cacheKey,
      mimeType: 'image/png',
      data: 'iVBORw0KGgo=',
    })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(removeBackground(source)).resolves.toEqual({
      provider: 'rmbg-2.0',
      cache: 'miss',
      cacheKey,
      image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/image/remove-background', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('api_token');
  });

  it('preserves source order while bounding concurrent preparation', async () => {
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      active += 1;
      peak = Math.max(peak, active);
      const body = JSON.parse(String(init.body));
      await new Promise((resolve) => window.setTimeout(resolve, body.data.endsWith('A') ? 4 : 1));
      active -= 1;
      return new Response(JSON.stringify({
        provider: 'rmbg-2.0', cache: 'hit', cacheKey, mimeType: 'image/png', data: 'iVBORw0KGgo=',
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const sources = Array.from({ length: 4 }, (_, index) => ({
      mimeType: 'image/png',
      data: `iVBORw0KGgo${String.fromCharCode(65 + index)}`,
    }));

    const layers = await prepareSubjectLayers(sources, undefined, { concurrency: 2 });
    expect(layers.map((layer) => layer.sourceIndex)).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it('does not start another paid mask after the first terminal failure', async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return first;
      }
      return new Promise<Response>((resolve, reject) => {
        resolveSecond = resolve;
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const sources = Array.from({ length: 4 }, (_, index) => ({
      mimeType: 'image/png',
      data: `iVBORw0KGgo${String.fromCharCode(65 + index)}`,
    }));

    const work = prepareSubjectLayers(sources, undefined, { concurrency: 2 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveFirst(new Response(JSON.stringify({ code: 'BRIA_SOURCE_REJECTED' }), { status: 422 }));
    await expect(work).rejects.toThrow('не смог выделить');
    resolveSecond(new Response(JSON.stringify({
      provider: 'rmbg-2.0', cache: 'hit', cacheKey, mimeType: 'image/png', data: 'iVBORw0KGgo=',
    })));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [413, 'BRIA_SOURCE_TOO_LARGE', '10 МиБ'],
    [422, 'BRIA_SOURCE_REJECTED', 'не смог выделить'],
    [429, 'BRIA_RATE_LIMITED', 'Слишком много'],
    [503, 'BRIA_DISABLED', 'не настроено'],
    [504, 'BRIA_TIMEOUT', 'вовремя'],
  ])('maps HTTP %s and safe code %s to stable copy', async (status, code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'private upstream detail',
      code,
    }), { status })));
    await expect(removeBackground(source)).rejects.toThrow(message);
    await expect(removeBackground(source)).rejects.not.toThrow('private upstream detail');
  });

  it('rejects malformed server output and preserves cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: 'other', cache: 'miss', cacheKey: 'bad', mimeType: 'image/jpeg', data: 'not-base64',
    }))));
    await expect(removeBackground(source)).rejects.toEqual(expect.any(SubjectLayerError));

    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(removeBackground(source, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
