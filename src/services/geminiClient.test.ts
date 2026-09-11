import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiClient } from './geminiClient';

describe('createGeminiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends Gemini SDK requests through the same-origin proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await createGeminiClient().models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: 'test',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/api/gemini/v1beta/models/gemini-3.1-flash-lite-preview:generateContent`,
      expect.any(Object),
    );
  });
});
