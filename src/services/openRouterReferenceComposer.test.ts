import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeOpenRouterReferenceSheet } from './openRouterReferenceComposer';

describe('OpenRouter single-reference contact sheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps every source fully visible in one bounded WEBP reference', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockResolvedValueOnce({ width: 500, height: 1_000, close })
      .mockResolvedValueOnce({ width: 1_200, height: 600, close }));
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const fillText = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage, fillRect, fillText, set fillStyle(_value: string) {}, set font(_value: string) {}, set textBaseline(_value: string) {} })),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(['RIFF1234WEBP'], { type: 'image/webp' }))),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas' ? canvas : createElement(tag)) as typeof document.createElement);

    const result = await composeOpenRouterReferenceSheet([
      { label: 'SOURCE 1', reference: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
      { label: 'SOURCE 2', reference: { mimeType: 'image/jpeg', data: '/9j/' } },
    ]);

    expect(result.mimeType).toBe('image/webp');
    expect(result.data).toBeTruthy();
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage.mock.calls[0][3]).toBeLessThan(drawImage.mock.calls[0][4]);
    expect(drawImage.mock.calls[1][3]).toBeGreaterThan(drawImage.mock.calls[1][4]);
    expect(fillText).toHaveBeenCalledWith('SOURCE 1', expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith('SOURCE 2', expect.any(Number), expect.any(Number));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('reduces WEBP quality until the Riverflow request budget is met', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 800, close }));
    const qualities: number[] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), set fillStyle(_value: string) {}, set font(_value: string) {}, set textBaseline(_value: string) {} })),
      toBlob: vi.fn((callback: BlobCallback, _type: string, quality: number) => {
        qualities.push(quality);
        callback(new Blob([new Uint8Array(quality > 0.7 ? 80 : 20)], { type: 'image/webp' }));
      }),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas' ? canvas : createElement(tag)) as typeof document.createElement);

    const result = await composeOpenRouterReferenceSheet([
      { label: 'SOURCE', reference: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
    ], undefined, { maxBytes: 40 });

    expect(result.mimeType).toBe('image/webp');
    expect(qualities.length).toBeGreaterThan(1);
    expect(qualities.at(-1)).toBeLessThanOrEqual(0.7);
  });
});
