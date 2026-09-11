import { afterEach, describe, expect, it, vi } from 'vitest';
import { likedUrlToInlineData, normalizeImageSource } from './geminiService';

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
