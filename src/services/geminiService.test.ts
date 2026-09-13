import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateFusedCover, likedUrlToInlineData, normalizeImageSource, type GenerationSettings } from './geminiService';
import { composeOpenRouterReferenceSheet } from './openRouterReferenceComposer';
import { normalizeGeminiImageSettings, supportsGeminiAspectRatio, supportsGeminiImageSize } from '../constants';

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));

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

afterEach(() => gemini.generateContent.mockReset());

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
});

describe('OpenRouter cover generation routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
