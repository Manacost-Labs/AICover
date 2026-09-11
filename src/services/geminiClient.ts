import { GoogleGenAI } from '@google/genai';

// The public site never receives the server's Gemini credential. Requests are
// authenticated by the existing same-origin session and proxied by Express.
const SERVER_MANAGED_KEY = 'server-managed';
const geminiProxyBaseUrl = new URL('/api/gemini', window.location.origin).toString();

export function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: SERVER_MANAGED_KEY,
    httpOptions: { baseUrl: geminiProxyBaseUrl },
  });
}
