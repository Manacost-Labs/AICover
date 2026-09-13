import type { GoogleGenAI } from '@google/genai';

// The public site never receives the server's Gemini credential. Requests are
// authenticated by the existing same-origin session and proxied by Express.
const SERVER_MANAGED_KEY = 'server-managed';
const geminiProxyBaseUrl = new URL('/api/gemini', window.location.origin).toString();

let sdk: Promise<typeof import('@google/genai')> | undefined;

export async function createGeminiClient(): Promise<GoogleGenAI> {
  // Share the module load between simultaneous requests. A failed load may retry.
  sdk ??= import('@google/genai').catch(error => { sdk = undefined; throw error; });
  const { GoogleGenAI } = await sdk;
  return new GoogleGenAI({
    apiKey: SERVER_MANAGED_KEY,
    httpOptions: { baseUrl: geminiProxyBaseUrl },
  });
}
