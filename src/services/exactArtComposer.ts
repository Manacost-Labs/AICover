import type { CompositionPlan, NormalizedBox } from './compositionPlanner';
import type { ImageSource } from './geminiService';
import type { SubjectLayer } from './subjectLayer';

export type NormalizedAlphaBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LoadedRaster = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

type RasterSurface = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  dispose: () => void;
};

export interface ExactArtRasterRuntime {
  load: (url: string, signal?: AbortSignal) => Promise<LoadedRaster>;
  createSurface: (width: number, height: number) => RasterSurface;
}

export interface ExactArtCompositeInput {
  background: string;
  sources: ImageSource[];
  layers: Array<SubjectLayer & { sourceIndex: number }>;
  plan: CompositionPlan;
  signal?: AbortSignal;
}

const ALPHA_PROBE_MAX_EDGE = 1_024;
const MAX_OUTPUT_EDGE = 8_192;
const MAX_OUTPUT_PIXELS = 32_000_000;
const MAX_INPUT_EDGE = 8_192;
const MAX_INPUT_PIXELS = 32_000_000;
const MAX_ENCODED_RASTER_BYTES = 32 * 1024 * 1024;
const DIMENSION_PROBE_BYTES = 256 * 1024;

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Сборка изображения отменена.', 'AbortError');
}

function sourceUrl(source: ImageSource) {
  if (/^(?:data:|https?:|\/)/i.test(source.data)) return source.data;
  return `data:${source.mimeType};base64,${source.data}`;
}

function assertRasterDimensions(
  raster: Pick<LoadedRaster, 'width' | 'height'>,
  kind: 'output' | 'input',
) {
  const maxEdge = kind === 'output' ? MAX_OUTPUT_EDGE : MAX_INPUT_EDGE;
  const maxPixels = kind === 'output' ? MAX_OUTPUT_PIXELS : MAX_INPUT_PIXELS;
  if (
    !Number.isInteger(raster.width)
    || !Number.isInteger(raster.height)
    || raster.width < 1
    || raster.height < 1
    || raster.width > maxEdge
    || raster.height > maxEdge
    || raster.width * raster.height > maxPixels
  ) {
    throw new Error('Изображение слишком большое для безопасной точной композиции.');
  }
}

function base64ByteLength(data: string) {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor(data.length * 3 / 4) - padding;
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readRasterDimensions(bytes: Uint8Array, mimeType: string) {
  if (
    mimeType === 'image/png'
    && bytes.length >= 24
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value)
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (mimeType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0x01) continue;
      if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (sofMarkers.has(marker) && segmentLength >= 7) {
        return {
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        };
      }
      offset += segmentLength;
    }
  }

  if (
    mimeType === 'image/webp'
    && bytes.length >= 30
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
    }
    if (chunk === 'VP8 ') {
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const packed = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

export function preflightExactArtRaster(url: string) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(url);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const data = match[2];
  if (base64ByteLength(data) > MAX_ENCODED_RASTER_BYTES) {
    throw new Error('Изображение слишком большое для безопасной точной композиции.');
  }
  const maxCharacters = Math.floor(DIMENSION_PROBE_BYTES / 3) * 4;
  const encodedPrefix = data.slice(0, maxCharacters);
  let binary: string;
  try {
    binary = atob(encodedPrefix);
  } catch {
    throw new Error('Не удалось проверить размер изображения для точной композиции.');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const dimensions = readRasterDimensions(bytes, mimeType);
  if (!dimensions?.width || !dimensions.height) {
    throw new Error('Не удалось проверить размер изображения для точной композиции.');
  }
  assertRasterDimensions(dimensions, 'input');
  return dimensions;
}

function htmlImageLoad(url: string, signal?: AbortSignal): Promise<LoadedRaster> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    let closed = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const close = () => {
      if (closed) return;
      closed = true;
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      close();
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!image.naturalWidth || !image.naturalHeight) {
        close();
        reject(new Error('Получено пустое изображение для точной композиции.'));
        return;
      }
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close,
      });
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      close();
      reject(new Error('Не удалось прочитать изображение для точной композиции.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = url;
  });
}

async function browserLoad(url: string, signal?: AbortSignal): Promise<LoadedRaster> {
  throwIfAborted(signal);
  if (!preflightExactArtRaster(url)) {
    throw new Error('Неподдерживаемый формат изображения для точной композиции.');
  }
  if (typeof createImageBitmap !== 'function') return htmlImageLoad(url, signal);

  const response = signal ? await fetch(url, { signal }) : await fetch(url);
  if (!response.ok) throw new Error('Не удалось загрузить изображение для точной композиции.');
  const blob = await response.blob();
  throwIfAborted(signal);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('Не удалось прочитать изображение для точной композиции.');
  }
  try {
    throwIfAborted(signal);
  } catch (error) {
    bitmap.close();
    throw error;
  }
  let closed = false;
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close() {
      if (closed) return;
      closed = true;
      bitmap.close();
    },
  };
}

const browserRuntime: ExactArtRasterRuntime = {
  load: browserLoad,
  createSurface(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      canvas.width = 1;
      canvas.height = 1;
      throw new Error('Canvas недоступен для точной композиции.');
    }
    let disposed = false;
    return {
      canvas,
      context,
      dispose() {
        if (disposed) return;
        disposed = true;
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  },
};

export async function validateExactArtRaster(
  url: string,
  signal?: AbortSignal,
  load: ExactArtRasterRuntime['load'] = browserLoad,
): Promise<void> {
  const raster = await load(url, signal);
  try {
    assertRasterDimensions(raster, 'input');
  } finally {
    raster.close();
  }
}

export function findAlphaBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 4,
): NormalizedAlphaBounds | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (rgba.length < width * height * 4) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX / width,
    y: minY / height,
    width: (maxX - minX + 1) / width,
    height: (maxY - minY + 1) / height,
  };
}

export function fitSubjectFrame(
  box: NormalizedBox,
  bounds: NormalizedAlphaBounds,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): PixelFrame {
  const boxX = box[0] * canvasWidth;
  const boxY = box[1] * canvasHeight;
  const boxWidth = box[2] * canvasWidth;
  const boxHeight = box[3] * canvasHeight;
  const subjectWidth = Math.max(1, bounds.width * sourceWidth);
  const subjectHeight = Math.max(1, bounds.height * sourceHeight);
  const scale = Math.min(boxWidth / subjectWidth, boxHeight / subjectHeight);
  const width = Math.max(1, Math.round(subjectWidth * scale));
  const height = Math.max(1, Math.round(subjectHeight * scale));
  return {
    x: Math.round(boxX + (boxWidth - width) / 2),
    y: Math.round(boxY + boxHeight - height),
    width,
    height,
  };
}

export function orderExactArtPlacements(plan: CompositionPlan) {
  return [...plan.selected.placements].sort((a, b) => a.zIndex - b.zIndex);
}

async function readMaskBounds(
  mask: LoadedRaster,
  runtime: ExactArtRasterRuntime,
  signal?: AbortSignal,
): Promise<NormalizedAlphaBounds> {
  throwIfAborted(signal);
  const scale = Math.min(1, ALPHA_PROBE_MAX_EDGE / Math.max(mask.width, mask.height));
  const width = Math.max(1, Math.round(mask.width * scale));
  const height = Math.max(1, Math.round(mask.height * scale));
  const probe = runtime.createSurface(width, height);
  try {
    probe.context.clearRect(0, 0, width, height);
    probe.context.drawImage(mask.source, 0, 0, width, height);
    const bounds = findAlphaBounds(probe.context.getImageData(0, 0, width, height).data, width, height);
    if (!bounds) throw new Error('Сервис не нашёл персонажа в одном из исходников.');

    // Keep antialiased edge pixels outside the probe threshold. Padding is
    // normalized, so it maps safely back to both the mask and original source.
    const padX = 1 / width;
    const padY = 1 / height;
    const x = Math.max(0, bounds.x - padX);
    const y = Math.max(0, bounds.y - padY);
    return {
      x,
      y,
      width: Math.min(1 - x, bounds.width + padX * 2),
      height: Math.min(1 - y, bounds.height + padY * 2),
    };
  } finally {
    probe.dispose();
  }
}

export async function compositeExactArtScene(
  input: ExactArtCompositeInput,
  runtime: ExactArtRasterRuntime = browserRuntime,
): Promise<string> {
  throwIfAborted(input.signal);
  if (input.sources.length === 0 || input.layers.length !== input.sources.length) {
    throw new Error('Не все персонажи подготовлены для точной композиции.');
  }

  const background = await runtime.load(input.background, input.signal);
  try {
    assertRasterDimensions(background, 'output');
    const output = runtime.createSurface(background.width, background.height);
    try {
      output.context.clearRect(0, 0, background.width, background.height);
      output.context.drawImage(background.source, 0, 0, background.width, background.height);

      const placements = orderExactArtPlacements(input.plan);
      for (const placement of placements) {
        throwIfAborted(input.signal);
        const source = input.sources[placement.sourceIndex];
        const layer = input.layers.find((item) => item.sourceIndex === placement.sourceIndex);
        if (!source || !layer) throw new Error('План композиции не соответствует исходным изображениям.');

        const original = await runtime.load(sourceUrl(source), input.signal);
        try {
          assertRasterDimensions(original, 'input');
          const mask = await runtime.load(sourceUrl(layer.image), input.signal);
          try {
            assertRasterDimensions(mask, 'input');
            const bounds = await readMaskBounds(mask, runtime, input.signal);
            const frame = fitSubjectFrame(
              placement.box,
              bounds,
              original.width,
              original.height,
              background.width,
              background.height,
            );
            const subject = runtime.createSurface(frame.width, frame.height);
            try {
              const sourceCrop = {
                x: bounds.x * original.width,
                y: bounds.y * original.height,
                width: bounds.width * original.width,
                height: bounds.height * original.height,
              };
              const maskCrop = {
                x: bounds.x * mask.width,
                y: bounds.y * mask.height,
                width: bounds.width * mask.width,
                height: bounds.height * mask.height,
              };

              subject.context.clearRect(0, 0, frame.width, frame.height);
              subject.context.globalCompositeOperation = 'source-over';
              subject.context.drawImage(
                original.source,
                sourceCrop.x,
                sourceCrop.y,
                sourceCrop.width,
                sourceCrop.height,
                0,
                0,
                frame.width,
                frame.height,
              );
              // destination-in consumes only mask alpha. BRIA RGB is never copied
              // into the protected layer; visible subject RGB stays source-owned.
              subject.context.globalCompositeOperation = 'destination-in';
              subject.context.drawImage(
                mask.source,
                maskCrop.x,
                maskCrop.y,
                maskCrop.width,
                maskCrop.height,
                0,
                0,
                frame.width,
                frame.height,
              );
              output.context.drawImage(subject.canvas, frame.x, frame.y, frame.width, frame.height);
            } finally {
              subject.dispose();
            }
          } finally {
            mask.close();
          }
        } finally {
          original.close();
        }
      }

      throwIfAborted(input.signal);
      return output.canvas.toDataURL('image/png');
    } finally {
      output.dispose();
    }
  } finally {
    background.close();
  }
}
