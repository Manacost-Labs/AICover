import { GoogleGenAI } from '@google/genai';

/**
 * Browser calls remain same-origin. The service inserts its own Gemini key;
 * this placeholder is deliberately non-secret and is discarded by the proxy.
 */
export function createGeminiClient() {
  return new GoogleGenAI({
    apiKey: 'cover-server-proxy',
    httpOptions: {
      baseUrl: `${window.location.origin}/api/gemini`,
      apiVersion: 'v1beta',
    },
  });
}
