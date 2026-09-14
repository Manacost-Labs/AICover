import { describe, expect, it, vi } from 'vitest';
import { createGeminiClient } from './geminiClient';

describe('createGeminiClient', () => {
  it('uses the same-origin proxy and never a browser API key', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', request);

    await createGeminiClient().models.generateContent({ model: 'gemini-2.5-flash', contents: 'test' });

    const [url, init] = request.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
    expect(String(url)).toContain('/api/gemini/v1beta/models/gemini-2.5-flash:generateContent');
    expect(JSON.stringify(init)).not.toContain('GEMINI_API_KEY');
  });
});
