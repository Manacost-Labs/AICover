import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateFusedCover, likedUrlToInlineData, normalizeImageSource, type GenerationSettings } from './geminiService';
import { composeOpenRouterReferenceSheet } from './openRouterReferenceComposer';
import { normalizeGeminiImageSettings, supportsGeminiAspectRatio, supportsGeminiImageSize } from '../constants';

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));
const exactArt = vi.hoisted(() => ({
  prepareSubjectLayers: vi.fn(),
  compositeExactArtScene: vi.fn(),
  validateExactArtRaster: vi.fn(),
}));

function base64OfByteLength(byteLength: number): string {
  const padding = (3 - (byteLength % 3)) % 3;
  return `${'A'.repeat(Math.ceil(byteLength / 3) * 4 - padding)}${'='.repeat(padding)}`;
}

function jpegBase64OfByteLength(byteLength: number, width = 12_000, height = 8_000): string {
  const header = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff, 0x00,
  ]);
  return `${btoa(String.fromCharCode(...header))}${base64OfByteLength(byteLength - header.length)}`;
}

vi.mock('./geminiClient', () => ({
  createGeminiClient: async () => ({ models: { generateContent: gemini.generateContent } }),
}));

vi.mock('./openRouterReferenceComposer', () => ({
  composeOpenRouterReferenceSheet: vi.fn(async () => ({ mimeType: 'image/webp', data: 'UklGRgAAAABXRUJQ' })),
}));

vi.mock('./subjectLayer', () => ({
  prepareSubjectLayers: exactArt.prepareSubjectLayers,
}));

vi.mock('./exactArtComposer', async importOriginal => ({
  ...await importOriginal<typeof import('./exactArtComposer')>(),
  compositeExactArtScene: exactArt.compositeExactArtScene,
  validateExactArtRaster: exactArt.validateExactArtRaster,
}));

afterEach(() => {
  gemini.generateContent.mockReset();
  exactArt.prepareSubjectLayers.mockReset();
  exactArt.compositeExactArtScene.mockReset();
  exactArt.validateExactArtRaster.mockReset();
});

describe('Gemini image model contracts', () => {
  it('normalizes sizes and aspect ratios to the documented stable model capabilities', () => {
    expect(normalizeGeminiImageSettings('gemini-2.5-flash-image', '4K', '1:4')).toEqual({
      imageSize: '1K',
      aspectRatio: '16:9',
    });
    expect(normalizeGeminiImageSettings('gemini-3.1-flash-image', '512px', '1:8')).toEqual({
      imageSize: '512px',
      aspectRatio: '1:8',
    });
    expect(supportsGeminiImageSize('gemini-3-pro-image', '512px')).toBe(false);
    expect(supportsGeminiAspectRatio('gemini-3-pro-image', '4:1')).toBe(false);
    expect(supportsGeminiAspectRatio('gemini-3-pro-image', '21:9')).toBe(true);
  });

  it('keeps Gemini 2.5 generation and strict repair at three input images', async () => {
    gemini.generateContent
      .mockResolvedValueOnce({ text: 'two locked characters' })
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }] } }] })
      .mockResolvedValueOnce({ text: '{"pass":false,"issues":["lighting"]}' })
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }] } }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('image-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })));

    await expect(generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'left' },
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'right' },
    ], null, {
      model: 'gemini-2.5-flash-image',
      aspectRatio: '16:9',
      imageSize: '1K',
      prompt: 'Preserve both heroes',
      batchSize: 1,
      strictMode: true,
    }, null, ['/uploads/favorites/one.png', '/uploads/favorites/two.png'])).resolves.toHaveLength(1);

    const imageCalls = gemini.generateContent.mock.calls
      .map(([request]) => request)
      .filter(request => request.model === 'gemini-2.5-flash-image');
    expect(imageCalls).toHaveLength(2);
    for (const request of imageCalls) {
      expect(request.contents.parts.filter((part: any) => part.inlineData)).toHaveLength(3);
    }
  });
});

describe('server-storage image sources', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('converts a same-origin upload URL into Gemini inline data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('image-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const inline = await likedUrlToInlineData('/uploads/favorites/image.png');

    expect(inline).toEqual(expect.objectContaining({ mimeType: 'image/png' }));
    expect(inline?.data).not.toContain('/uploads/');
    expect(fetchMock).toHaveBeenCalledWith('/uploads/favorites/image.png');
  });

  it('normalizes a server history image before refine, upscale, or expand', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('image-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const inline = await normalizeImageSource({
      data: '/uploads/history/image.png',
      mimeType: 'image/png',
    });

    expect(inline).toEqual(expect.objectContaining({ mimeType: 'image/png' }));
    expect(inline.data).not.toContain('/uploads/');
  });

  it('rejects a declared oversized URL image before buffering its body', async () => {
    const response = new Response(new Uint8Array([0x89]), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(32 * 1024 * 1024 + 1),
      },
    });
    const blob = vi.spyOn(response, 'blob');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(normalizeImageSource({
      data: '/uploads/history/oversized.png',
      mimeType: 'image/png',
    })).rejects.toThrow('слишком большое');

    expect(blob).not.toHaveBeenCalled();
  });

  it('threads cancellation into URL image hydration', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (!init?.signal) {
        reject(new Error('missing abort signal'));
        return;
      }
      init.signal.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const work = normalizeImageSource({
      data: '/uploads/history/slow.png',
      mimeType: 'image/png',
    }, controller.signal);
    await Promise.resolve();
    controller.abort(new DOMException('Отменено', 'AbortError'));

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledWith('/uploads/history/slow.png', { signal: controller.signal });
  });
});

describe('OpenRouter cover generation routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('optimizes an uploaded source over 10 MiB before starting a Seedream job', async () => {
    const oversized = jpegBase64OfByteLength(10 * 1024 * 1024 + 1);
    const optimizedBytes = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage }),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob([optimizedBytes], { type: 'image/webp' }))),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : createElement(tagName)
    ));
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4_096, height: 2_731, close }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateFusedCover([
      { data: `data:image/jpeg;base64,${oversized}`, mimeType: 'image/jpeg', role: 'left' },
    ], null, {
      model: 'bytedance-seed/seedream-5-0-pro',
      aspectRatio: '16:9',
      imageSize: '1K',
      prompt: 'Preserve the uploaded hero',
      batchSize: 1,
    })).resolves.toEqual(['data:image/png;base64,iVBORw0KGgo=']);

    const start = fetchMock.mock.calls.find(([url]) => url === '/api/thumbnail/openrouter-generate');
    const body = JSON.parse(String(start?.[1]?.body));
    expect(body.references[0].mimeType).toBe('image/webp');
    expect(body.references[0].data).toBe('UklGRgAAAABXRUJQ');
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('routes the selected allowlisted model through one same-origin paid job', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const settings = {
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      imageSize: '2K',
      prompt: 'Two heroes in one scene',
      batchSize: 1,
      strictMode: true,
    } satisfies GenerationSettings;

    await expect(generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'left' },
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'right' },
    ], null, settings)).resolves.toEqual(['data:image/png;base64,iVBORw0KGgo=']);

    const start = fetchMock.mock.calls[0];
    expect(start[0]).toBe('/api/thumbnail/openrouter-generate');
    const body = JSON.parse(String(start[1]?.body));
    expect(body).toMatchObject({
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      resolution: '2K',
    });
    expect(body.references).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/thumbnail/openrouter-generate')).toHaveLength(1);
  });

  it('sends one grounded depth plan to the selected OpenRouter image model', async () => {
    gemini.generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        analyses: [
          { sourceIndex: 0, visualWeight: 0.9, gaze: 'right', motion: 'right', mustRemainVisible: ['face', 'staff'], safeToOcclude: ['lower robe'], lighting: 'upper left' },
          { sourceIndex: 1, visualWeight: 0.7, gaze: 'left', motion: 'left', mustRemainVisible: ['face'], safeToOcclude: ['lower armor'], lighting: 'front' },
        ],
        candidates: ['balanced', 'cinematic', 'tight'].map((id, index) => ({
          id,
          score: 90 - index,
          camera: 'eye-level normal lens',
          horizon: 0.58,
          rationale: 'Keep the leading hero forward and both faces readable.',
          placements: [
            { sourceIndex: 0, role: 'hero', box: [0.06, 0.08, 0.42, 0.84], depth: 0.18, zIndex: 2, focalPriority: 1 },
            { sourceIndex: 1, role: 'support', box: [0.58, 0.18, 0.34, 0.7], depth: 0.68, zIndex: 1, focalPriority: 2 },
          ],
        })),
        selectedCandidateId: 'balanced',
        summary: 'The leading hero stays in the foreground.',
      }),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'left' },
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'right' },
    ], null, {
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      imageSize: '2K',
      prompt: 'Two heroes in one scene',
      batchSize: 1,
    });

    expect(gemini.generateContent).toHaveBeenCalledOnce();
    const plannerRequest = gemini.generateContent.mock.calls[0][0];
    expect(plannerRequest.contents.parts[0].text).toContain('exactly 3 candidates');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.prompt).toContain('AI-SELECTED COMPOSITION PLAN (balanced, 16:9)');
    expect(body.prompt).toContain('SOURCE 1: hero; foreground');
    expect(body.prompt).toContain('Do not swap identities');
  });

  it('uses the safe layout after a short planner deadline instead of delaying OpenRouter', async () => {
    vi.useFakeTimers();
    gemini.generateContent.mockReturnValueOnce(new Promise(() => {}));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const work = generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'left' },
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'right' },
    ], null, {
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      imageSize: '2K',
      prompt: 'Two heroes in one scene',
      batchSize: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(gemini.generateContent).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(work).resolves.toEqual(['data:image/png;base64,iVBORw0KGgo=']);
    const plannerRequest = gemini.generateContent.mock.calls[0][0];
    expect(plannerRequest.config.abortSignal.aborted).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.prompt).toContain('AI-SELECTED COMPOSITION PLAN (balanced-depth, 16:9)');
  });

  it('propagates user cancellation while the composition planner is pending', async () => {
    gemini.generateContent.mockReturnValueOnce(new Promise(() => {}));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const work = generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'left' },
    ], null, {
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      imageSize: '2K',
      prompt: 'One hero',
      batchSize: 1,
    }, null, [], null, undefined, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new DOMException('Генерация отменена.', 'AbortError'));

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not start Vision after cancellation during delayed source preparation', async () => {
    let resolveSource!: (response: Response) => void;
    const delayedSource = new Promise<Response>((resolve) => { resolveSource = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(delayedSource);
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const work = generateFusedCover([
      { data: '/uploads/slow-source.png', mimeType: 'image/png', role: 'left' },
    ], null, {
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      imageSize: '2K',
      prompt: 'One hero',
      batchSize: 1,
    }, null, [], null, undefined, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException('Генерация отменена.', 'AbortError'));
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });

    resolveSource(new Response('image-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(gemini.generateContent).not.toHaveBeenCalled();
  });

  it('does not launch Vision for a pre-aborted composition request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort(new DOMException('Генерация отменена.', 'AbortError'));

    await expect(generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'left' },
    ], null, {
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      imageSize: '2K',
      prompt: 'One hero',
      batchSize: 1,
    }, null, [], null, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed for held Muse before composing references or starting a paid request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' },
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' },
    ], null, {
      model: 'meta/muse-image',
      aspectRatio: '16:9',
      imageSize: '1K',
      prompt: '',
      batchSize: 1,
    })).rejects.toThrow('пока несовместима');
    expect(composeOpenRouterReferenceSheet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('packs all required Krea inputs into one labeled contact sheet before the paid request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' },
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' },
    ], null, {
      model: 'krea/krea-2-large',
      aspectRatio: '16:9',
      imageSize: '1K',
      prompt: '',
      batchSize: 1,
    })).resolves.toEqual(['data:image/png;base64,iVBORw0KGgo=']);
    expect(composeOpenRouterReferenceSheet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: 'SOURCE 1' }),
      expect.objectContaining({ label: 'SOURCE 2' }),
    ]), undefined, { maxBytes: 10 * 1024 * 1024 });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.references).toEqual([{ mimeType: 'image/webp', data: 'UklGRgAAAABXRUJQ' }]);
    expect(body.prompt).toContain('CONTACT SHEET');
    expect(body).toMatchObject({ aspectRatio: '16:9', resolution: '1K' });
  });

  it('publishes a completed paid variant when a later OpenRouter variant fails without retrying', async () => {
    const firstImage = 'data:image/png;base64,iVBORw0KGgo=';
    const publish = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: firstImage })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateFusedCover([
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'left' },
      { data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', role: 'right' },
    ], null, {
      model: 'x-ai/grok-imagine-image-2.0',
      aspectRatio: '16:9',
      imageSize: '2K',
      prompt: 'Two heroes in one scene',
      batchSize: 2,
    }, null, [], null, undefined, undefined, publish)).rejects.toThrow('Слишком много');

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(firstImage);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/thumbnail/openrouter-generate')).toHaveLength(2);
  });
});

describe('protected original-art generation', () => {
  const validPngHeader = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const validPngDataUrl = `data:image/png;base64,${validPngHeader}`;
  const oversizedPngDataUrl = () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 20_000);
    view.setUint32(20, 20_000);
    return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('asks the model for an empty environment and composites original pixels after BRIA masking', async () => {
    gemini.generateContent.mockResolvedValueOnce({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([{
      provider: 'rmbg-2.0',
      cache: 'miss',
      cacheKey: 'a'.repeat(64),
      image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
      sourceIndex: 0,
    }]);
    exactArt.compositeExactArtScene.mockResolvedValueOnce('data:image/png;base64,final');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      imageUrl: 'data:image/png;base64,background',
    })));
    vi.stubGlobal('fetch', fetchMock);
    const progress = vi.fn();

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      null,
      {
        model: 'gpt-image-2',
        aspectRatio: '16:9',
        imageSize: '1K',
        prompt: 'A volcanic battlefield',
        batchSize: 1,
        strictMode: true,
        preserveExactArt: true,
      },
      null,
      [],
      null,
      progress,
    )).resolves.toEqual(['data:image/png;base64,final']);

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.references).toEqual([]);
    expect(request.prompt).toContain('BACKGROUND PLATE ONLY');
    expect(request.prompt).toContain('no characters, people, creatures, bodies, faces, limbs');
    expect(exactArt.prepareSubjectLayers).toHaveBeenCalledWith([
      { data: validPngHeader, mimeType: 'image/png' },
    ], expect.any(AbortSignal), { concurrency: 2 });
    expect(exactArt.compositeExactArtScene).toHaveBeenCalledWith(expect.objectContaining({
      background: 'data:image/png;base64,background',
      sources: [{ data: validPngHeader, mimeType: 'image/png' }],
    }));
    expect(progress.mock.calls.map(([value]) => value.phase)).toEqual([
      'preparing',
      'generating',
      'finalizing',
      'finalizing',
    ]);
  });

  it('rejects an oversized compressed source before any provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    gemini.generateContent.mockResolvedValue({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValue([]);
    exactArt.compositeExactArtScene.mockResolvedValue('data:image/png;base64,should-not-exist');

    await expect(generateFusedCover(
      [{ data: oversizedPngDataUrl(), mimeType: 'image/png', role: 'left' }],
      null,
      { model: 'gpt-image-2', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1, preserveExactArt: true },
    )).rejects.toThrow('слишком большое');

    expect(exactArt.prepareSubjectLayers).not.toHaveBeenCalled();
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exactArt.compositeExactArtScene).not.toHaveBeenCalled();
  });

  it('rejects an oversized compressed composition reference before any provider call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    gemini.generateContent.mockResolvedValue({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValue([]);
    exactArt.compositeExactArtScene.mockResolvedValue('data:image/png;base64,should-not-exist');

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      { data: oversizedPngDataUrl(), mimeType: 'image/png' },
      { model: 'gpt-image-2', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1, preserveExactArt: true },
    )).rejects.toThrow('слишком большое');

    expect(exactArt.prepareSubjectLayers).not.toHaveBeenCalled();
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exactArt.compositeExactArtScene).not.toHaveBeenCalled();
  });

  it('fully decodes every source before starting any provider call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      Uint8Array.from(atob(validPngHeader), (character) => character.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    gemini.generateContent.mockResolvedValue({ text: '' });
    exactArt.validateExactArtRaster.mockRejectedValueOnce(
      new Error('Не удалось прочитать изображение для точной композиции.'),
    );
    exactArt.prepareSubjectLayers.mockResolvedValue([]);

    await expect(generateFusedCover(
      [{ data: '/uploads/truncated.png', mimeType: 'image/png', role: 'left' }],
      null,
      { model: 'gpt-image-2', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1, preserveExactArt: true },
    )).rejects.toThrow('Не удалось прочитать');

    expect(exactArt.validateExactArtRaster).toHaveBeenCalledWith(validPngDataUrl, expect.any(AbortSignal));
    expect(exactArt.prepareSubjectLayers).not.toHaveBeenCalled();
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/uploads/truncated.png', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('reuses the single validated URL snapshot for composition Vision', async () => {
    const validBytes = Uint8Array.from(atob(validPngHeader), (character) => character.charCodeAt(0));
    let sourceHydrations = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/uploads/mutable.png') {
        sourceHydrations += 1;
        const body = sourceHydrations === 1
          ? validBytes
          : Uint8Array.from(atob(oversizedPngDataUrl().split(',')[1]), (character) => character.charCodeAt(0));
        return new Response(body, { headers: { 'Content-Type': 'image/png' } });
      }
      return new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,background' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    gemini.generateContent.mockResolvedValueOnce({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([{
      provider: 'rmbg-2.0', cache: 'hit', cacheKey: 'a'.repeat(64),
      image: { mimeType: 'image/png', data: 'mask' }, sourceIndex: 0,
    }]);
    exactArt.compositeExactArtScene.mockResolvedValueOnce('data:image/png;base64,final');

    await expect(generateFusedCover(
      [{ data: '/uploads/mutable.png', mimeType: 'image/png', role: 'left' }],
      null,
      { model: 'gpt-image-2', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1, preserveExactArt: true },
    )).resolves.toEqual(['data:image/png;base64,final']);

    expect(sourceHydrations).toBe(1);
    const visionRequest = gemini.generateContent.mock.calls[0][0];
    expect(visionRequest.contents.parts).toContainEqual({
      inlineData: { data: validPngHeader, mimeType: 'image/png' },
    });
  });

  it('persists the final OpenRouter composite before acknowledging its paid background job', async () => {
    gemini.generateContent.mockResolvedValueOnce({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([{
      provider: 'rmbg-2.0',
      cache: 'hit',
      cacheKey: 'a'.repeat(64),
      image: { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
      sourceIndex: 0,
    }]);
    exactArt.compositeExactArtScene.mockResolvedValueOnce('data:image/png;base64,final');
    const events: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        events.push('acknowledge');
        return new Response(null, { status: 204 });
      }
      if (url === '/api/thumbnail/openrouter-generate') {
        return new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 });
      }
      return new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,background' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const publish = vi.fn(async (url: string) => {
      events.push(`publish:${url}`);
    });

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      null,
      {
        model: 'bytedance-seed/seedream-5-0-pro',
        aspectRatio: '16:9',
        imageSize: '1K',
        prompt: 'A volcanic battlefield',
        batchSize: 1,
        preserveExactArt: true,
      },
      null,
      [],
      null,
      undefined,
      undefined,
      publish,
    )).resolves.toEqual(['data:image/png;base64,final']);

    expect(publish).toHaveBeenCalledWith('data:image/png;base64,final');
    expect(events).toEqual(['publish:data:image/png;base64,final', 'acknowledge']);
  });

  it('publishes a completed Gemini composite before a later paid variant fails', async () => {
    gemini.generateContent
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'background-one' } }] } }] })
      .mockRejectedValueOnce(new Error('second Gemini variant failed'));
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([{
      provider: 'rmbg-2.0', cache: 'hit', cacheKey: 'a'.repeat(64),
      image: { mimeType: 'image/png', data: 'mask' }, sourceIndex: 0,
    }]);
    exactArt.compositeExactArtScene.mockResolvedValueOnce('data:image/png;base64,final-one');
    const publish = vi.fn();

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      null,
      { model: 'gemini-2.5-flash-image', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 2, preserveExactArt: true },
      null, [], null, undefined, undefined, publish,
    )).rejects.toThrow('second Gemini variant failed');

    expect(exactArt.compositeExactArtScene).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith('data:image/png;base64,final-one');
  });

  it('publishes a completed ChatGPT composite before a later paid variant fails', async () => {
    gemini.generateContent.mockResolvedValueOnce({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([{
      provider: 'rmbg-2.0', cache: 'hit', cacheKey: 'a'.repeat(64),
      image: { mimeType: 'image/png', data: 'mask' }, sourceIndex: 0,
    }]);
    exactArt.compositeExactArtScene.mockResolvedValueOnce('data:image/png;base64,final-one');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,background-one' })))
      .mockResolvedValueOnce(new Response('{}', { status: 500 })));
    const publish = vi.fn();

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      null,
      { model: 'gpt-image-2', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 2, preserveExactArt: true },
      null, [], null, undefined, undefined, publish,
    )).rejects.toThrow('Не удалось сгенерировать изображение');

    expect(exactArt.compositeExactArtScene).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith('data:image/png;base64,final-one');
  });

  it('stops before the next Gemini background variant after cancellation', async () => {
    let resolveFirstBackground!: (value: unknown) => void;
    const firstBackground = new Promise((resolve) => { resolveFirstBackground = resolve; });
    gemini.generateContent
      .mockResolvedValueOnce({ text: '' })
      .mockReturnValueOnce(firstBackground)
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'late' } }] } }] });
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([{
      provider: 'rmbg-2.0', cache: 'miss', cacheKey: 'a'.repeat(64),
      image: { mimeType: 'image/png', data: 'mask' }, sourceIndex: 0,
    }]);
    const controller = new AbortController();
    const work = generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      null,
      { model: 'gemini-2.5-flash-image', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 2, preserveExactArt: true },
      null, [], null, undefined, controller.signal,
    );
    await vi.waitFor(() => expect(gemini.generateContent).toHaveBeenCalledTimes(2));
    controller.abort(new DOMException('Генерация отменена.', 'AbortError'));
    resolveFirstBackground({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'first' } }] } }] });

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(gemini.generateContent).toHaveBeenCalledTimes(2);
    expect(gemini.generateContent.mock.calls[1][0].config.abortSignal).toBe(controller.signal);
  });

  it('rejects a known Recraft incompatibility before requesting paid BRIA masks', async () => {
    gemini.generateContent.mockResolvedValueOnce({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      null,
      { model: 'recraft/recraft-v4-styles-pro', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1, preserveExactArt: true },
    )).rejects.toThrow('нужен референс композиции');

    expect(exactArt.prepareSubjectLayers).not.toHaveBeenCalled();
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['ChatGPT', 'gpt-image-2'],
    ['OpenRouter', 'x-ai/grok-imagine-image-2.0'],
  ])('rejects an unsupported %s composition reference before requesting paid BRIA masks', async (_provider, model) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      { data: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==', mimeType: 'image/gif' },
      { model, aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1, preserveExactArt: true },
    )).rejects.toThrow('PNG, JPG и WEBP');

    expect(exactArt.prepareSubjectLayers).not.toHaveBeenCalled();
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('compresses the protected Riverflow composition reference to its 3 MiB contract', async () => {
    vi.mocked(composeOpenRouterReferenceSheet).mockClear();
    gemini.generateContent.mockResolvedValueOnce({ text: '' });
    exactArt.prepareSubjectLayers.mockResolvedValueOnce([{
      provider: 'rmbg-2.0', cache: 'hit', cacheKey: 'a'.repeat(64),
      image: { mimeType: 'image/png', data: 'mask' }, sourceIndex: 0,
    }]);
    exactArt.compositeExactArtScene.mockResolvedValueOnce('data:image/png;base64,final');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: '9f8483e6-cb34-40fe-8a5c-73c4bc6beff7', status: 'pending' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'complete', imageUrl: 'data:image/png;base64,background' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateFusedCover(
      [{ data: validPngDataUrl, mimeType: 'image/png', role: 'left' }],
      { data: validPngDataUrl, mimeType: 'image/png' },
      { model: 'sourceful/riverflow-v2.5-pro', aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1, preserveExactArt: true },
    )).resolves.toEqual(['data:image/png;base64,final']);

    expect(composeOpenRouterReferenceSheet).toHaveBeenCalledWith([{
      label: 'COMPOSITION',
      reference: { data: validPngHeader, mimeType: 'image/png' },
    }], expect.any(AbortSignal), { maxBytes: 3 * 1024 * 1024 });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.references).toEqual([{ mimeType: 'image/webp', data: 'UklGRgAAAABXRUJQ' }]);
  });
});
