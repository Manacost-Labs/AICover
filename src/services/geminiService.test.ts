import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateFusedCover, likedUrlToInlineData, normalizeImageSource, type GenerationSettings } from './geminiService';
import { composeOpenRouterReferenceSheet } from './openRouterReferenceComposer';
import { normalizeGeminiImageSettings, supportsGeminiAspectRatio, supportsGeminiImageSize } from '../constants';

const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));

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
  afterEach(() => vi.unstubAllGlobals());

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
