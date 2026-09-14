import { GoogleGenAI, Type } from '@google/genai';
import { buildAiThumbnailPrompt } from '../features/thumbnail/prompt';
import type {
  GeneratedThumbnailBackground,
  ThumbnailAsset,
  ThumbnailCtrScore,
  ThumbnailGenerationSettings,
  ThumbnailTextSettings,
} from '../features/thumbnail/types';

type InlineImage = { data: string; mimeType: string };

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Не удалось прочитать игровой ассет'));
    reader.readAsDataURL(blob);
  });
}

async function assetToInline(asset: ThumbnailAsset): Promise<InlineImage> {
  const dataMatch = asset.imageUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (dataMatch) return { mimeType: dataMatch[1], data: dataMatch[2] };

  const response = await fetch(asset.imageUrl);
  if (!response.ok) throw new Error(`Не удалось загрузить ${asset.name}: HTTP ${response.status}`);
  const blob = await response.blob();
  return { mimeType: blob.type || 'image/png', data: await blobToBase64(blob) };
}

function supportsImageSize(model: string): boolean {
  return model.includes('3.1-flash-image') || model.includes('3-pro-image');
}

function normalizedHeadline(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function extractGeneratedImage(response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>): string | null {
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
    }
  }
  return null;
}

async function verifyRenderedText(ai: GoogleGenAI, imageUrl: string, expected: string): Promise<boolean> {
  const match = imageUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!match) return false;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: match[1], data: match[2] } },
          {
            text: `Perform strict OCR over the entire image. The only permitted visible text is this exact headline:\n${expected}\nReturn all visible text exactly as rendered. exactMatch is true only when every letter and punctuation mark matches and there is no additional word, number, logo, signature or watermark. Never infer missing or blurred letters.`,
          },
        ],
      },
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            allVisibleText: { type: Type.STRING },
            exactMatch: { type: Type.BOOLEAN },
            hasExtraText: { type: Type.BOOLEAN },
          },
          required: ['allVisibleText', 'exactMatch', 'hasExtraText'],
        },
      },
    });
    const result = JSON.parse(response.text || '{}') as {
      allVisibleText?: string;
      exactMatch?: boolean;
      hasExtraText?: boolean;
    };
    return result.exactMatch === true
      && result.hasExtraText === false
      && normalizedHeadline(result.allVisibleText || '') === normalizedHeadline(expected);
  } catch (error) {
    console.warn('AI text verification failed', error);
    return false;
  }
}

async function scoreThumbnailCtr(
  ai: GoogleGenAI,
  imageUrl: string,
  expectedHeadline: string,
): Promise<ThumbnailCtrScore | null> {
  const match = imageUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
  if (!match) return null;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: match[1], data: match[2] } },
          {
            text: `Act as a strict YouTube thumbnail creative reviewer. Judge this finished Hearthstone thumbnail at 320x180 pixels in a crowded feed.

Expected headline: ${expectedHeadline}

Score each dimension from 0 to 100: mobileReadability, subjectImpact, contrast, curiosity and clutterControl. Any misspelled, duplicated or unintended text is a critical defect. Check that the headline feels integrated into the scene, avoids the face and hands, uses a clear hierarchy and remains instantly readable. Be conservative: 80+ means genuinely professional feed performance. Return a concise Russian summary and up to three actionable issues.`,
          },
        ],
      },
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mobileReadability: { type: Type.INTEGER, minimum: 0, maximum: 100 },
            subjectImpact: { type: Type.INTEGER, minimum: 0, maximum: 100 },
            contrast: { type: Type.INTEGER, minimum: 0, maximum: 100 },
            curiosity: { type: Type.INTEGER, minimum: 0, maximum: 100 },
            clutterControl: { type: Type.INTEGER, minimum: 0, maximum: 100 },
            summary: { type: Type.STRING },
            issues: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: '3' },
          },
          required: ['mobileReadability', 'subjectImpact', 'contrast', 'curiosity', 'clutterControl', 'summary', 'issues'],
        },
      },
    });
    const raw = JSON.parse(response.text || '{}') as Partial<ThumbnailCtrScore>;
    const mobileReadability = Math.round(clamp(raw.mobileReadability, 0, 100, 50));
    const subjectImpact = Math.round(clamp(raw.subjectImpact, 0, 100, 50));
    const contrast = Math.round(clamp(raw.contrast, 0, 100, 50));
    const curiosity = Math.round(clamp(raw.curiosity, 0, 100, 50));
    const clutterControl = Math.round(clamp(raw.clutterControl, 0, 100, 50));
    let overall = Math.round(
      mobileReadability * 0.28
      + subjectImpact * 0.24
      + contrast * 0.18
      + curiosity * 0.18
      + clutterControl * 0.12,
    );
    if (clutterControl < 70) overall = Math.min(overall, 79);
    if (mobileReadability < 75) overall = Math.min(overall, 74);
    return {
      overall,
      mobileReadability,
      subjectImpact,
      contrast,
      curiosity,
      clutterControl,
      summary: String(raw.summary || '').slice(0, 180),
      issues: Array.isArray(raw.issues) ? raw.issues.map((issue) => String(issue).slice(0, 140)).slice(0, 3) : [],
    };
  } catch (error) {
    console.warn('CTR scoring failed', error);
    return null;
  }
}

async function generateWithOpenRouter(prompt: string, references: InlineImage[]): Promise<string> {
  const response = await fetch('/api/thumbnail/openrouter-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, references }),
  });
  const payload = await response.json().catch(() => ({})) as { jobId?: string; imageUrl?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'GPT Image 2 не вернул изображение');
  }
  if (payload.imageUrl) return payload.imageUrl;
  if (!payload.jobId) throw new Error('Сервис GPT Image 2 не создал задачу генерации');

  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const statusResponse = await fetch(`/api/thumbnail/openrouter-jobs/${encodeURIComponent(payload.jobId)}`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    const statusPayload = await statusResponse.json().catch(() => ({})) as {
      status?: 'pending' | 'complete' | 'failed';
      imageUrl?: string;
      error?: string;
    };
    if (!statusResponse.ok || statusPayload.status === 'failed') {
      throw new Error(statusPayload.error || 'GPT Image 2 не смог завершить генерацию');
    }
    if (statusPayload.status === 'complete' && statusPayload.imageUrl) return statusPayload.imageUrl;
  }
  throw new Error('GPT Image 2 генерирует слишком долго. Попробуйте ещё раз.');
}

async function generateWithGemini(
  ai: GoogleGenAI,
  prompt: string,
  references: InlineImage[],
  settings: ThumbnailGenerationSettings,
): Promise<string> {
  const parts: any[] = [];
  references.forEach((image, index) => {
    parts.push({ text: index === 0 ? 'MAIN CHARACTER IDENTITY REFERENCE:' : `SUPPORTING CHARACTER IDENTITY REFERENCE ${index + 1}:` });
    parts.push({ inlineData: image });
  });
  parts.push({ text: prompt });

  const imageConfig: Record<string, string> = { aspectRatio: '16:9' };
  if (supportsImageSize(settings.model) && settings.model !== 'gemini-3.1-flash-lite-image') {
    imageConfig.imageSize = settings.imageSize;
  }
  const response = await ai.models.generateContent({
    model: settings.model,
    contents: { parts },
    config: { responseModalities: ['Image'], imageConfig },
  });
  const imageUrl = extractGeneratedImage(response);
  if (!imageUrl) throw new Error('Gemini не вернул готовую обложку');
  return imageUrl;
}

export async function generateHearthstoneThumbnailBackgrounds(
  assets: ThumbnailAsset[],
  settings: ThumbnailGenerationSettings,
  text: ThumbnailTextSettings,
  studioStyle: { frameEnabled: boolean },
  onProgress?: (done: number, total: number) => void,
): Promise<GeneratedThumbnailBackground[]> {
  if (assets.length === 0) throw new Error('Добавьте хотя бы один игровой ассет');
  const usesOpenRouter = settings.model === 'openai/gpt-image-2';
  const apiKey = process.env.GEMINI_API_KEY;
  if (!usesOpenRouter && !apiKey) throw new Error('GEMINI_API_KEY не настроен');

  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  const references = await Promise.all(assets.slice(0, 4).map(assetToInline));
  let completed = 0;

  const requests = Array.from({ length: settings.batchSize }, async (_, index) => {
    const prompt = buildAiThumbnailPrompt(settings, text, index + 1, studioStyle.frameEnabled);
    const imageUrl = usesOpenRouter
      ? await generateWithOpenRouter(prompt, references)
      : await generateWithGemini(ai!, prompt, references, settings);
    const textVerified = ai ? await verifyRenderedText(ai, imageUrl, text.text) : null;
    const ctrScore = ai ? await scoreThumbnailCtr(ai, imageUrl, text.text) : null;
    completed += 1;
    onProgress?.(completed, settings.batchSize);
    return {
      imageUrl,
      autoLayout: null,
      textRenderedByAi: true,
      textVerified,
      sourceHeadline: text.text,
      ctrScore,
    } satisfies GeneratedThumbnailBackground;
  });

  const results = await Promise.all(requests);
  return [...results].sort((left, right) => (right.ctrScore?.overall ?? -1) - (left.ctrScore?.overall ?? -1));
}
