import { buildThumbnailPrompt } from '../features/thumbnail/prompt';
import type { ThumbnailAsset, ThumbnailGenerationSettings } from '../features/thumbnail/types';
import { CHATGPT_IMAGE_MODEL, createChatGPTImageGenerator } from './chatgptImages';
import { createGeminiClient } from './geminiClient';

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
  return {
    mimeType: blob.type || 'image/png',
    data: await blobToBase64(blob),
  };
}

function supportsImageSize(model: string): boolean {
  return model.includes('3.1-flash-image') || model.includes('3-pro-image');
}

export async function generateHearthstoneThumbnailBackgrounds(
  assets: ThumbnailAsset[],
  settings: ThumbnailGenerationSettings,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  if (assets.length === 0) throw new Error('Добавьте хотя бы один игровой ассет');

  if (settings.model === CHATGPT_IMAGE_MODEL) {
    if (!Number.isInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 4) {
      throw new Error('Для GPT Image доступен пакет от 1 до 4 вариантов.');
    }
    const inlineAssets = await Promise.all(assets.slice(0, 4).map(assetToInline));
    const generateImage = await createChatGPTImageGenerator(inlineAssets, signal);
    const results: string[] = [];
    for (let index = 0; index < settings.batchSize; index++) {
      results.push(await generateImage(
        `${buildThumbnailPrompt(settings, index + 1)}\n\nDESIRED ASPECT RATIO: 16:9. This is a composition target; exact output dimensions are not guaranteed.`,
      ));
      onProgress?.(index + 1, settings.batchSize);
    }
    return results;
  }

  const ai = await createGeminiClient();
  const inlineAssets = await Promise.all(assets.slice(0, 4).map(assetToInline));
  let completed = 0;

  const requests = Array.from({ length: settings.batchSize }, async (_, index) => {
    const parts: any[] = [];
    inlineAssets.forEach((image, assetIndex) => {
      parts.push({
        text: assetIndex === 0
          ? 'MAIN CHARACTER — preserve this identity exactly:'
          : `SUPPORTING GAME ASSET ${assetIndex + 1} — preserve recognizable details:`,
      });
      parts.push({ inlineData: image });
    });
    parts.push({ text: buildThumbnailPrompt(settings, index + 1) });

    const imageConfig: Record<string, string> = { aspectRatio: '16:9' };
    if (supportsImageSize(settings.model) && settings.model !== 'gemini-3.1-flash-lite-image') {
      imageConfig.imageSize = settings.imageSize;
    }

    const response = await ai.models.generateContent({
      model: settings.model,
      contents: { parts },
      config: {
        responseModalities: ['Image'],
        imageConfig,
      },
    });

    const urls: string[] = [];
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        urls.push(`data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`);
      }
    }
    completed += 1;
    onProgress?.(completed, settings.batchSize);
    if (urls.length === 0) throw new Error('Gemini не вернул изображение для одного из вариантов');
    return urls[0];
  });

  return Promise.all(requests);
}
