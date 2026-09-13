export const CHATGPT_IMAGE_MODEL = 'gpt-image-2';
export const MAX_CHATGPT_IMAGE_REFERENCES = 5;
export const MAX_CHATGPT_IMAGE_REFERENCE_BYTES = 10 * 1024 * 1024;
export const MAX_CHATGPT_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_CHATGPT_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_CHATGPT_OPTIMIZED_EDGE = 4096;
const MAX_CHATGPT_FALLBACK_PIXELS = 32_000_000;
const SUPPORTED_CHATGPT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type ChatGPTImageReference = {
  mimeType: string;
  /** Raw base64 only; data URLs and remote URLs must be normalized by the caller. */
  data: string;
};

export type ChatGPTImageRequest = {
  model?: typeof CHATGPT_IMAGE_MODEL;
  prompt: string;
  references: ChatGPTImageReference[];
};

const GENERIC_GENERATION_ERROR = 'Не удалось сгенерировать изображение. Попробуйте ещё раз.';

export class ChatGPTImageError extends Error {
  constructor(message = GENERIC_GENERATION_ERROR) {
    super(message);
    this.name = 'ChatGPTImageError';
  }
}

function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor(data.length * 3 / 4) - padding;
}

function validateReferenceSyntax(reference: ChatGPTImageReference): void {
  // A leading slash is valid base64 (JPEG commonly starts /9j/), not a URL.
  // Validate the alphabet; the server still validates decoded bytes and MIME.
  if (!SUPPORTED_CHATGPT_IMAGE_TYPES.has(reference.mimeType)) {
    throw new ChatGPTImageError('Для генерации поддерживаются только PNG, JPG и WEBP.');
  }
  if (
    typeof reference.data !== 'string'
    || reference.data.length > Math.ceil(MAX_CHATGPT_IMAGE_SOURCE_BYTES / 3) * 4
    || base64ByteLength(reference.data) > MAX_CHATGPT_IMAGE_SOURCE_BYTES
  ) {
    throw new ChatGPTImageError('Для автоматического уменьшения исходник должен быть не больше 32 МиБ.');
  }
  if (
    !reference.mimeType.startsWith('image/')
    || reference.data.length % 4 === 1
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(reference.data)
  ) {
    throw new ChatGPTImageError('Для генерации нужны изображения в формате base64.');
  }
}

function validatePreparedReference(reference: ChatGPTImageReference): void {
  validateReferenceSyntax(reference);
  if (base64ByteLength(reference.data) > MAX_CHATGPT_IMAGE_REFERENCE_BYTES) {
    throw new ChatGPTImageError('Каждое изображение должно быть не больше 10 МиБ.');
  }
}

type ImageDimensions = { width: number; height: number };

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  if (
    mimeType === 'image/png'
    && bytes.length >= 24
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width && height ? { width, height } : null;
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
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        return width && height ? { width, height } : null;
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
    if (chunk === 'VP8X') return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
    if (chunk === 'VP8 ' && bytes.length >= 30) {
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

function base64ToBlob(reference: ChatGPTImageReference, signal?: AbortSignal): { blob: Blob; dimensions: ImageDimensions | null } {
  const bytes = new Uint8Array(base64ByteLength(reference.data));
  const encodedChunkSize = 4 * 1024 * 1024;
  let outputOffset = 0;
  for (let offset = 0; offset < reference.data.length; offset += encodedChunkSize) {
    throwIfAborted(signal);
    const binary = atob(reference.data.slice(offset, offset + encodedChunkSize));
    for (let index = 0; index < binary.length; index += 1) bytes[outputOffset + index] = binary.charCodeAt(index);
    outputOffset += binary.length;
  }
  return {
    blob: new Blob([bytes], { type: reference.mimeType }),
    dimensions: readImageDimensions(bytes, reference.mimeType),
  };
}

async function blobToBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
  let binary = '';
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    throwIfAborted(signal);
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

type DecodedCanvasImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeCanvasImage(
  blob: Blob,
  dimensions: ImageDimensions | null,
  targetBytes: number,
  originalBytes: number,
  signal?: AbortSignal,
): Promise<DecodedCanvasImage> {
  if (typeof createImageBitmap === 'function') {
    const requestedScale = dimensions
      ? Math.min(
        1,
        Math.sqrt(targetBytes / originalBytes),
        MAX_CHATGPT_OPTIMIZED_EDGE / dimensions.width,
        MAX_CHATGPT_OPTIMIZED_EDGE / dimensions.height,
      )
      : 1;
    const resizeOptions = dimensions && requestedScale < 1
      ? {
        resizeWidth: Math.max(1, Math.round(dimensions.width * requestedScale)),
        resizeHeight: Math.max(1, Math.round(dimensions.height * requestedScale)),
        resizeQuality: 'high' as const,
      }
      : undefined;
    const pending = resizeOptions ? createImageBitmap(blob, resizeOptions) : createImageBitmap(blob);
    let bitmap: ImageBitmap;
    try {
      bitmap = await abortable(pending, signal);
    } catch (error) {
      void pending.then(value => value.close(), () => undefined);
      throw error;
    }
    if (!bitmap.width || !bitmap.height) {
      bitmap.close();
      throw new Error('Empty image');
    }
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }

  if (!dimensions || dimensions.width * dimensions.height > MAX_CHATGPT_FALLBACK_PIXELS) {
    throw new Error('Image is too large for fallback decoding');
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    let settled = false;
    const release = () => {
      signal?.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(url);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      image.src = '';
      release();
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Генерация отменена.', 'AbortError'));
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      if (!image.naturalWidth || !image.naturalHeight) {
        release();
        reject(new Error('Empty image'));
        return;
      }
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close: release });
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      release();
      reject(new Error('Image decode failed'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number, signal?: AbortSignal): Promise<Blob> {
  return abortable(new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Image encode failed'));
    }, 'image/webp', quality);
  }), signal);
}

async function optimizeReference(
  reference: ChatGPTImageReference,
  targetBytes: number,
  signal?: AbortSignal,
): Promise<ChatGPTImageReference> {
  throwIfAborted(signal);
  const originalBytes = base64ByteLength(reference.data);
  const encoded = base64ToBlob(reference, signal);
  if (!encoded.dimensions) throw new Error('Image signature or dimensions are invalid');
  const decoded = await decodeCanvasImage(encoded.blob, encoded.dimensions, targetBytes, originalBytes, signal);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) {
    decoded.close();
    throw new Error('Canvas is unavailable');
  }

  const initialScale = Math.min(
    1,
    encoded.dimensions ? 1 : Math.sqrt(targetBytes / originalBytes),
    MAX_CHATGPT_OPTIMIZED_EDGE / decoded.width,
    MAX_CHATGPT_OPTIMIZED_EDGE / decoded.height,
  );
  let width = Math.max(1, Math.round(decoded.width * initialScale));
  let height = Math.max(1, Math.round(decoded.height * initialScale));
  const qualities = [0.9, 0.8, 0.7, 0.6];

  try {
    for (let pass = 0; pass < 10; pass += 1) {
      throwIfAborted(signal);
      canvas.width = width;
      canvas.height = height;
      context.drawImage(decoded.source, 0, 0, width, height);
      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, quality, signal);
        if (blob.size <= targetBytes) {
          const mimeType = SUPPORTED_CHATGPT_IMAGE_TYPES.has(blob.type)
            ? blob.type
            : 'image/webp';
          return { mimeType, data: await blobToBase64(blob, signal) };
        }
      }
      if (width === 1 && height === 1) break;
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
  } finally {
    decoded.close();
    canvas.width = 1;
    canvas.height = 1;
  }
  throw new Error('Unable to fit image into the provider budget');
}

function allocateTargetBytes(sizes: number[]): number[] {
  const capped = sizes.map(size => Math.min(size, MAX_CHATGPT_IMAGE_REFERENCE_BYTES));
  if (capped.reduce((sum, size) => sum + size, 0) <= MAX_CHATGPT_IMAGE_TOTAL_BYTES) return capped;

  const targets = [...capped];
  const ascending = capped.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size);
  let remaining = MAX_CHATGPT_IMAGE_TOTAL_BYTES;
  for (let position = 0; position < ascending.length; position += 1) {
    const share = Math.floor(remaining / (ascending.length - position));
    if (ascending[position].size <= share) {
      targets[ascending[position].index] = ascending[position].size;
      remaining -= ascending[position].size;
      continue;
    }
    for (let rest = position; rest < ascending.length; rest += 1) targets[ascending[rest].index] = share;
    break;
  }
  return targets;
}

export async function prepareImageReferences(
  references: ChatGPTImageReference[],
  signal?: AbortSignal,
): Promise<ChatGPTImageReference[]> {
  references.forEach(validateReferenceSyntax);
  const sizes = references.map(reference => base64ByteLength(reference.data));
  if (
    sizes.every(size => size <= MAX_CHATGPT_IMAGE_REFERENCE_BYTES)
    && sizes.reduce((sum, size) => sum + size, 0) <= MAX_CHATGPT_IMAGE_TOTAL_BYTES
  ) {
    return references;
  }

  const targetBytes = allocateTargetBytes(sizes);
  const prepared: ChatGPTImageReference[] = [];
  try {
    for (let index = 0; index < references.length; index += 1) {
      throwIfAborted(signal);
      prepared.push(sizes[index] > targetBytes[index]
        ? await optimizeReference(references[index], targetBytes[index], signal)
        : references[index]);
    }
  } catch {
    throwIfAborted(signal);
    throw new ChatGPTImageError('Не удалось автоматически уменьшить большое изображение. Используйте PNG, JPG или WEBP.');
  }

  prepared.forEach(validatePreparedReference);
  if (prepared.reduce((sum, reference) => sum + base64ByteLength(reference.data), 0) > MAX_CHATGPT_IMAGE_TOTAL_BYTES) {
    throw new ChatGPTImageError('Общий размер исходников не должен превышать 24 МиБ.');
  }
  return prepared;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Генерация отменена.', 'AbortError');
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Генерация отменена.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Генерация отменена.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function sendChatGPTImage(
  prompt: string,
  references: ChatGPTImageReference[],
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);

  let response: Response;
  try {
    response = await fetch('/api/chatgpt/images', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHATGPT_IMAGE_MODEL,
        prompt,
        references,
      }),
    });
  } catch {
    throwIfAborted(signal);
    throw new ChatGPTImageError();
  }

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('cover:chatgpt-refresh'));
      throw new ChatGPTImageError('Подключите ChatGPT заново.');
    }
    if (response.status === 403) throw new ChatGPTImageError('Генерация изображений недоступна для этого аккаунта ChatGPT.');
    if (response.status === 429) throw new ChatGPTImageError('Достигнут лимит ChatGPT. Попробуйте позже.');
    if (response.status === 504) throw new ChatGPTImageError('ChatGPT не ответил вовремя. Запрос не повторялся автоматически.');
    throw new ChatGPTImageError();
  }

  try {
    const payload = await response.json() as { imageUrl?: unknown };
    if (typeof payload.imageUrl === 'string' && /^data:image\/[a-zA-Z+.-]+;base64,/.test(payload.imageUrl)) {
      window.dispatchEvent(new Event('cover:chatgpt-refresh'));
      return payload.imageUrl;
    }
  } catch {
    // Deliberately do not surface proxy or provider response details to the UI.
  }
  throw new ChatGPTImageError();
}

export async function createChatGPTImageGenerator(
  references: ChatGPTImageReference[],
  signal?: AbortSignal,
): Promise<(prompt: string) => Promise<string>> {
  throwIfAborted(signal);
  if (references.length > MAX_CHATGPT_IMAGE_REFERENCES) {
    throw new ChatGPTImageError(`Можно передать не больше ${MAX_CHATGPT_IMAGE_REFERENCES} изображений.`);
  }
  const preparedReferences = await prepareImageReferences(references, signal);
  throwIfAborted(signal);
  return prompt => sendChatGPTImage(prompt, preparedReferences, signal);
}

/**
 * Browser-only same-origin adapter. The server owns provider credentials and
 * turns provider failures into the API's generic error contract.
 */
export async function generateChatGPTImage(request: ChatGPTImageRequest, signal?: AbortSignal): Promise<string> {
  const generate = await createChatGPTImageGenerator(request.references, signal);
  return generate(request.prompt);
}
