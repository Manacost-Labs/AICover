import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_IMAGE_MODEL,
  ChatGPTImageError,
  MAX_CHATGPT_IMAGE_REFERENCE_BYTES,
  MAX_CHATGPT_IMAGE_SOURCE_BYTES,
  MAX_CHATGPT_IMAGE_TOTAL_BYTES,
  generateChatGPTImage,
} from './chatgptImages';
const gemini = vi.hoisted(() => ({ createGeminiClient: vi.fn() }));
vi.mock('./geminiClient', () => gemini);
import { generateFusedCover } from './geminiService';
import { generateHearthstoneThumbnailBackgrounds } from './thumbnailService';

function base64OfByteLength(byteLength: number): string {
  const padding = (3 - (byteLength % 3)) % 3;
  return `${'A'.repeat(Math.ceil(byteLength / 3) * 4 - padding)}${'='.repeat(padding)}`;
}

function jpegBase64OfByteLength(byteLength: number, width = 12000, height = 8000): string {
  const header = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff, 0x00,
  ]);
  return `${btoa(String.fromCharCode(...header))}${base64OfByteLength(byteLength - header.length)}`;
}

function gifBase64OfByteLength(byteLength: number): string {
  return `${btoa('GIF89a')}${base64OfByteLength(byteLength - 6)}`;
}

describe('ChatGPT image proxy adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['https://example.invalid/art.jpg', '/uploads/art.jpg', '//example.invalid/art.jpg', 'data:image/jpeg;base64,/9j/', '', '   ', 'AA%=','AA==AA'])('rejects non-inline data %j before sending a request', async (data) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(generateChatGPTImage({ prompt: 'Cover', references: [{ mimeType: 'image/jpeg', data }] }))
      .rejects.toThrow('в формате base64');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    { mimeType: 'image/webp', data: 'UklGRgAAAABXRUJQ' },
  ])('preserves inline $mimeType bytes', async (reference) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);
    await generateChatGPTImage({ prompt: 'Cover', references: [reference] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).references).toEqual([reference]);
  });

  it('passes uploaded JPEG sources, reference and quality example to GPT without treating /9j/ as a URL', async () => {
    const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);
    const source = { mimeType: 'image/jpeg', data: `data:image/jpeg;base64,${jpeg}` };

    await expect(generateFusedCover(
      [{ ...source, role: 'left' }, { ...source, role: 'right' }], source,
      { model: CHATGPT_IMAGE_MODEL, aspectRatio: '16:9', imageSize: '1K', prompt: 'Two characters', batchSize: 1 },
      null, [source.data],
    )).resolves.toEqual(['data:image/png;base64,AA==']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.references).toEqual(Array.from({ length: 4 }, () => ({ mimeType: 'image/jpeg', data: jpeg })));
    expect(gemini.createGeminiClient).not.toHaveBeenCalled();
  });

  it('passes an uploaded JPEG through the thumbnail editor too', async () => {
    const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateHearthstoneThumbnailBackgrounds(
      [{ id: 'jpeg', name: 'Portrait', imageUrl: `data:image/jpeg;base64,${jpeg}`, source: 'upload' }],
      { model: CHATGPT_IMAGE_MODEL, imageSize: '1K', batchSize: 1, layout: 'text-left', stylePrompt: 'Preserve art' },
    )).resolves.toEqual(['data:image/png;base64,AA==']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).references).toEqual([{ mimeType: 'image/jpeg', data: jpeg }]);
  });

  it('automatically optimizes an oversized uploaded image before requesting the API', async () => {
    const decodedBytes = MAX_CHATGPT_IMAGE_REFERENCE_BYTES + 1;
    const oversized = jpegBase64OfByteLength(decodedBytes);
    const close = vi.fn();
    const drawImage = vi.fn();
    const optimizedBytes = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage }),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob([optimizedBytes], { type: 'image/webp' }))),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : createElement(tagName)
    ));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 12000, height: 8000, close }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/jpeg', data: oversized }],
    })).resolves.toBe('data:image/png;base64,AA==');

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.references).toEqual([{ mimeType: 'image/webp', data: 'UklGRgAAAABXRUJQ' }]);
    expect(vi.mocked(createImageBitmap)).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({
      resizeWidth: 4096,
      resizeHeight: 2731,
      resizeQuality: 'high',
    }));
    expect(drawImage).toHaveBeenCalledOnce();
    expect(drawImage.mock.calls[0][3]).toBeLessThanOrEqual(4096);
    expect(drawImage.mock.calls[0][4]).toBeLessThanOrEqual(4096);
    expect(close).toHaveBeenCalledOnce();
  });

  it('optimizes references that individually fit but exceed the aggregate request budget', async () => {
    const perImageBytes = 9 * 1024 * 1024;
    expect(perImageBytes).toBeLessThan(MAX_CHATGPT_IMAGE_REFERENCE_BYTES);
    expect(perImageBytes * 3).toBeGreaterThan(MAX_CHATGPT_IMAGE_TOTAL_BYTES);
    const large = jpegBase64OfByteLength(perImageBytes, 4096, 3072);
    const optimizedBytes = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage }),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob([optimizedBytes], { type: 'image/webp' }))),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : createElement(tagName)
    ));
    const close = vi.fn();
    const createImageBitmapMock = vi.fn().mockResolvedValue({ width: 4096, height: 3072, close });
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);

    await generateChatGPTImage({
      prompt: 'A cover',
      references: Array.from({ length: 3 }, () => ({ mimeType: 'image/jpeg', data: large })),
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.references).toEqual(Array.from({ length: 3 }, () => ({
      mimeType: 'image/webp',
      data: 'UklGRgAAAABXRUJQ',
    })));
    expect(createImageBitmapMock).toHaveBeenCalledTimes(3);
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('preserves a reference exactly at the ten MiB byte limit', async () => {
    const exactLimit = base64OfByteLength(MAX_CHATGPT_IMAGE_REFERENCE_BYTES);
    expect(exactLimit.length % 4).toBe(0);
    expect(exactLimit.endsWith('==')).toBe(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);

    await generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/jpeg', data: exactLimit }],
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).references[0].data).toBe(exactLimit);
  });

  it('rejects a source over the bounded auto-optimization limit before decoding it', async () => {
    const overCap = base64OfByteLength(MAX_CHATGPT_IMAGE_SOURCE_BYTES + 1);
    const decode = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/jpeg', data: overCap }],
    })).rejects.toThrow('не больше 32 МиБ');
    expect(decode).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'unsupported GIF MIME', mimeType: 'image/gif', makeData: base64OfByteLength },
    { name: 'GIF bytes spoofed as JPEG', mimeType: 'image/jpeg', makeData: gifBase64OfByteLength },
  ])('rejects oversized $name before image decode or fetch', async ({ mimeType, makeData }) => {
    const decode = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType, data: makeData(MAX_CHATGPT_IMAGE_REFERENCE_BYTES + 1) }],
    })).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves small references and gives an oversized art the remaining request budget', async () => {
    const oversized = jpegBase64OfByteLength(MAX_CHATGPT_IMAGE_REFERENCE_BYTES + 1, 4000, 3000);
    const small = { mimeType: 'image/png', data: 'AA==' };
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage }),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['optimized'], { type: 'image/webp' }))),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : createElement(tagName)
    ));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);

    await generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/jpeg', data: oversized }, small, small, small, small],
    });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).references;
    expect(sent.slice(1)).toEqual([small, small, small, small]);
    expect(drawImage.mock.calls[0][3]).toBeGreaterThan(3900);
    expect(drawImage.mock.calls[0][4]).toBeGreaterThan(2900);
  });

  it('cancels a pending decode and closes the bitmap when it eventually resolves', async () => {
    const oversized = jpegBase64OfByteLength(MAX_CHATGPT_IMAGE_REFERENCE_BYTES + 1);
    const controller = new AbortController();
    const close = vi.fn();
    let finishDecode!: (bitmap: ImageBitmap) => void;
    const pendingDecode = new Promise<ImageBitmap>((resolve) => { finishDecode = resolve; });
    const decode = vi.fn().mockReturnValue(pendingDecode);
    vi.stubGlobal('createImageBitmap', decode);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const work = generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/jpeg', data: oversized }],
    }, controller.signal);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    finishDecode({ width: 4096, height: 2731, close } as unknown as ImageBitmap);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels the Image fallback and releases its object URL', async () => {
    const oversized = jpegBase64OfByteLength(MAX_CHATGPT_IMAGE_REFERENCE_BYTES + 1, 4000, 3000);
    const controller = new AbortController();
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending-image');
    const images: Array<{ src: string }> = [];
    class PendingImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';

      constructor() {
        images.push(this);
      }
    }
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', PendingImage);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const work = generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/jpeg', data: oversized }],
    }, controller.signal);
    await vi.waitFor(() => expect(images).toHaveLength(1));
    expect(images[0].src).toBe('blob:pending-image');
    controller.abort();

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(images[0].src).toBe('');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pending-image');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects extreme dimensions before the Image fallback allocates decoded pixels', async () => {
    const oversized = jpegBase64OfByteLength(MAX_CHATGPT_IMAGE_REFERENCE_BYTES + 1, 65535, 65535);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const createImage = vi.fn();
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', createImage);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/jpeg', data: oversized }],
    })).rejects.toThrow('автоматически уменьшить');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(createImage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('optimizes oversized references once and reuses them for all variants in a batch', async () => {
    const oversized = jpegBase64OfByteLength(MAX_CHATGPT_IMAGE_REFERENCE_BYTES + 1);
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 4096, height: 2731, close });
    vi.stubGlobal('createImageBitmap', decode);
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['optimized'], { type: 'image/webp' }))),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
      tagName === 'canvas' ? canvas : createElement(tagName)
    ));
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,AA==' })));
    vi.stubGlobal('fetch', fetchMock);

    await generateFusedCover(
      [{ data: `data:image/jpeg;base64,${oversized}`, mimeType: 'image/jpeg', role: 'left' }],
      null,
      { model: CHATGPT_IMAGE_MODEL, aspectRatio: '16:9', imageSize: '1K', prompt: 'Battle', batchSize: 2 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decode).toHaveBeenCalledOnce();
    expect(canvas.toBlob).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses the same-origin session and sends only inline reference data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      imageUrl: 'data:image/png;base64,generated',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateChatGPTImage({
      prompt: 'A cover',
      references: [{ mimeType: 'image/png', data: 'AA==' }],
    })).resolves.toBe('data:image/png;base64,generated');

    expect(fetchMock).toHaveBeenCalledWith('/api/chatgpt/images', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHATGPT_IMAGE_MODEL,
        prompt: 'A cover',
        references: [{ mimeType: 'image/png', data: 'AA==' }],
      }),
    }));
  });

  it('does not expose an upstream error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'provider_error', message: 'private upstream detail' },
    }), { status: 502, headers: { 'Content-Type': 'application/json' } })));

    await expect(generateChatGPTImage({ prompt: 'A cover', references: [] }))
      .rejects.toEqual(expect.objectContaining({
        name: ChatGPTImageError.name,
        message: 'Не удалось сгенерировать изображение. Попробуйте ещё раз.',
      }));
  });

  it('rejects more than five references before requesting the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateChatGPTImage({
      prompt: 'A cover',
      references: Array.from({ length: 6 }, () => ({ mimeType: 'image/png', data: 'AA==' })),
    })).rejects.toThrow('Можно передать не больше 5 изображений');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs GPT cover variants sequentially, reports progress, and bypasses Gemini completely', async () => {
    let finishFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { finishFirst = resolve; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,second' })));
    vi.stubGlobal('fetch', fetchMock);
    const progress = vi.fn();

    const work = generateFusedCover(
      [{ data: 'source', mimeType: 'image/png', role: 'left' }],
      null,
      { model: CHATGPT_IMAGE_MODEL, aspectRatio: '16:9', imageSize: '1K', prompt: 'Battle', batchSize: 2, strictMode: true },
      null,
      [],
      'Keep the camera low',
      progress,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(gemini.createGeminiClient).not.toHaveBeenCalled();

    finishFirst(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,first' })));
    await expect(work).resolves.toEqual([
      'data:image/png;base64,first',
      'data:image/png;base64,second',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { done: 0, total: 2, phase: 'preparing' },
      { done: 0, total: 2, phase: 'generating' },
      { done: 1, total: 2, phase: 'generating' },
      { done: 2, total: 2, phase: 'generating' },
    ]);
    expect(gemini.createGeminiClient).not.toHaveBeenCalled();
  });

  it('stops a GPT batch after the current request is cancelled', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,first' })));
    vi.stubGlobal('fetch', fetchMock);

    const work = generateFusedCover(
      [{ data: 'source', mimeType: 'image/png' }],
      null,
      { model: CHATGPT_IMAGE_MODEL, aspectRatio: '16:9', imageSize: '1K', prompt: 'Battle', batchSize: 2 },
      null,
      [],
      null,
      (progress) => { if (progress.done === 1) controller.abort(); },
      controller.signal,
    );

    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('labels GPT references in exact request order and rejects non-integer batch sizes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imageUrl: 'data:image/png;base64,generated' })));
    vi.stubGlobal('fetch', fetchMock);
    const source = { data: 'source', mimeType: 'image/png' };

    await generateFusedCover(
      [source, source],
      source,
      { model: CHATGPT_IMAGE_MODEL, aspectRatio: '16:9', imageSize: '1K', prompt: 'Battle', batchSize: 1 },
      source,
    );
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).prompt;
    expect(prompt).toContain('Image 1: SOURCE CHARACTER 1');
    expect(prompt).toContain('Image 2: SOURCE CHARACTER 2');
    expect(prompt).toContain('Image 3: COMPOSITION REFERENCE');
    expect(prompt).toContain('Image 4: BASE IMAGE');

    await expect(generateFusedCover(
      [source], null,
      { model: CHATGPT_IMAGE_MODEL, aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1.5 },
    )).rejects.toThrow('от 1 до 4');
  });

  it('rejects required GPT inputs over the five-image limit rather than dropping them', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const source = { data: 'AA==', mimeType: 'image/png' };

    await expect(generateFusedCover(
      [source, source, source, source],
      source,
      { model: CHATGPT_IMAGE_MODEL, aspectRatio: '16:9', imageSize: '1K', prompt: '', batchSize: 1 },
      source,
    )).rejects.toThrow('превышают лимит 5');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gemini.createGeminiClient).not.toHaveBeenCalled();
  });
});
