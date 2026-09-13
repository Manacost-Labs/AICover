import type { OpenRouterImageReference } from './openRouterImages';

const SHEET_WIDTH = 1600;
const CELL_HEIGHT = 800;
const LABEL_HEIGHT = 48;
const GUTTER = 12;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

export interface OpenRouterReferencePanel {
  label: string;
  reference: OpenRouterImageReference;
}

function decodeReference(reference: OpenRouterImageReference) {
  const binary = window.atob(reference.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: reference.mimeType });
}

function blobToBase64(blob: Blob) {
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    const step = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += step) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + step)));
    }
    return window.btoa(chunks.join(''));
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Подготовка референсов отменена.', 'AbortError');
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob || blob.type !== 'image/webp') {
        reject(new Error('Браузер не смог подготовить WEBP-лист референсов.'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

/**
 * Packs multiple full-frame sources into the one input_reference supported by
 * single-reference providers. Images use contain geometry and are never cropped.
 */
export async function composeOpenRouterReferenceSheet(
  panels: OpenRouterReferencePanel[],
  signal?: AbortSignal,
  options: { maxBytes?: number } = {},
): Promise<OpenRouterImageReference> {
  if (panels.length < 1 || panels.length > 8) {
    throw new Error('Лист референсов поддерживает от 1 до 8 изображений.');
  }
  throwIfAborted(signal);
  const bitmaps: ImageBitmap[] = [];
  const canvas = document.createElement('canvas');
  try {
    for (const panel of panels) {
      throwIfAborted(signal);
      bitmaps.push(await createImageBitmap(decodeReference(panel.reference)));
    }

    const columns = panels.length <= 2 ? panels.length : panels.length <= 4 ? 2 : 3;
    const rows = Math.ceil(panels.length / columns);
    canvas.width = SHEET_WIDTH;
    canvas.height = rows * CELL_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает подготовку листа референсов.');

    context.fillStyle = '#f2f1ed';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const cellWidth = canvas.width / columns;
    panels.forEach((panel, index) => {
      const bitmap = bitmaps[index];
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellX = column * cellWidth;
      const cellY = row * CELL_HEIGHT;
      context.fillStyle = '#171a17';
      context.fillRect(cellX + GUTTER, cellY + GUTTER, cellWidth - GUTTER * 2, LABEL_HEIGHT);
      context.fillStyle = '#f8f7f3';
      context.font = '600 20px system-ui, sans-serif';
      context.textBaseline = 'middle';
      context.fillText(panel.label.slice(0, 32), cellX + GUTTER * 2, cellY + GUTTER + LABEL_HEIGHT / 2);

      const frameX = cellX + GUTTER;
      const frameY = cellY + GUTTER + LABEL_HEIGHT + GUTTER;
      const frameWidth = cellWidth - GUTTER * 2;
      const frameHeight = CELL_HEIGHT - LABEL_HEIGHT - GUTTER * 3;
      const scale = Math.min(frameWidth / bitmap.width, frameHeight / bitmap.height);
      const width = bitmap.width * scale;
      const height = bitmap.height * scale;
      context.drawImage(bitmap, frameX + (frameWidth - width) / 2, frameY + (frameHeight - height) / 2, width, height);
    });

    throwIfAborted(signal);
    const maxBytes = Math.min(options.maxBytes ?? MAX_REFERENCE_BYTES, MAX_REFERENCE_BYTES);
    let blob: Blob | null = null;
    for (const quality of [0.9, 0.76, 0.64, 0.52, 0.42]) {
      throwIfAborted(signal);
      blob = await canvasToWebp(canvas, quality);
      if (blob.size <= maxBytes) break;
    }
    if (!blob || blob.size > maxBytes) {
      throw new Error(`Cover не смог сжать лист референсов до ${Math.floor(maxBytes / 1024 / 1024)} МиБ. Уберите один источник.`);
    }
    return { mimeType: 'image/webp', data: await blobToBase64(blob) };
  } finally {
    bitmaps.forEach(bitmap => bitmap.close());
  }
}
