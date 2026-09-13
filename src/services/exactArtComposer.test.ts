import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compositeExactArtScene,
  findAlphaBounds,
  fitSubjectFrame,
  orderExactArtPlacements,
  preflightExactArtRaster,
  validateExactArtRaster,
  type ExactArtRasterRuntime,
} from './exactArtComposer';
import type { CompositionPlan } from './compositionPlanner';

const plan: CompositionPlan = {
  origin: 'fallback',
  aspectRatio: '16:9',
  analyses: [{
    sourceIndex: 0,
    visualWeight: 1,
    gaze: 'forward',
    motion: 'still',
    mustRemainVisible: ['face'],
    safeToOcclude: ['lower edge'],
    lighting: 'front',
  }],
  candidates: [],
  selected: {
    id: 'fixture',
    score: 100,
    camera: 'eye-level',
    horizon: 0.6,
    rationale: 'fixture',
    placements: [{
      sourceIndex: 0,
      role: 'hero',
      box: [0.1, 0.1, 0.3, 0.8],
      depth: 0.2,
      zIndex: 1,
      focalPriority: 1,
    }],
  },
  summary: 'fixture',
};

describe('exact-art compositor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('finds the visible alpha bounds instead of treating transparent margins as subject', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 1; x < 3; x += 1) rgba[(y * 4 + x) * 4 + 3] = 255;
    }

    expect(findAlphaBounds(rgba, 4, 4)).toEqual({ x: 0.25, y: 0, width: 0.5, height: 0.75 });
  });

  it('uses uniform scale, centers horizontally, and grounds the subject at the bottom of its box', () => {
    expect(fitSubjectFrame(
      [0.1, 0.1, 0.3, 0.8],
      { x: 0, y: 0, width: 1, height: 1 },
      1_000,
      2_000,
      1_600,
      900,
    )).toEqual({ x: 220, y: 90, width: 360, height: 720 });
  });

  it('keeps all protected layers in deterministic back-to-front z-index order', () => {
    expect(orderExactArtPlacements({
      ...plan,
      selected: {
        ...plan.selected,
        placements: [
          { ...plan.selected.placements[0], sourceIndex: 0, zIndex: 3 },
          { ...plan.selected.placements[0], sourceIndex: 1, zIndex: 1 },
          { ...plan.selected.placements[0], sourceIndex: 2, zIndex: 2 },
        ],
      },
    }).map((placement) => placement.sourceIndex)).toEqual([1, 2, 0]);
  });

  it('rejects an extreme output raster before allocating a canvas surface', async () => {
    const close = vi.fn();
    const runtime: ExactArtRasterRuntime = {
      load: vi.fn(async () => ({
        source: {} as CanvasImageSource,
        width: 20_000,
        height: 20_000,
        close,
      })),
      createSurface: vi.fn(),
    };

    await expect(compositeExactArtScene({
      background: 'data:image/png;base64,background',
      sources: [{ mimeType: 'image/png', data: 'original' }],
      layers: [{
        provider: 'rmbg-2.0',
        cache: 'miss',
        cacheKey: 'a'.repeat(64),
        image: { mimeType: 'image/png', data: 'mask' },
        sourceIndex: 0,
      }],
      plan,
    }, runtime)).rejects.toThrow('слишком большое');

    expect(runtime.createSurface).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects a compressed raster bomb from its PNG header before browser decoding', () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 20_000);
    view.setUint32(20, 20_000);
    const encoded = btoa(String.fromCharCode(...bytes));

    expect(() => preflightExactArtRaster(`data:image/png;base64,${encoded}`))
      .toThrow('слишком большое');
  });

  it('fully decodes and releases a safe raster during the provider preflight', async () => {
    const close = vi.fn();
    const load = vi.fn().mockResolvedValue({
      source: {} as CanvasImageSource,
      width: 1_600,
      height: 900,
      close,
    });

    await expect(validateExactArtRaster(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      undefined,
      load,
    )).resolves.toBeUndefined();

    expect(load).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses a releasable ImageBitmap in the browser raster runtime', async () => {
    const close = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])));
    const createImageBitmapMock = vi.fn().mockResolvedValue({
      width: 1,
      height: 1,
      close,
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    await expect(validateExactArtRaster(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    )).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(createImageBitmapMock).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('draws original RGB first, applies BRIA only as destination alpha, then publishes the final layer', async () => {
    const operations: string[] = [];
    const background = { name: 'background' } as unknown as CanvasImageSource;
    const original = { name: 'original' } as unknown as CanvasImageSource;
    const mask = { name: 'mask' } as unknown as CanvasImageSource;
    const closeBackground = vi.fn(() => operations.push('close:background'));
    const closeOriginal = vi.fn(() => operations.push('close:original'));
    const closeMask = vi.fn(() => operations.push('close:mask'));
    const outputContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn((image: unknown) => operations.push(`output:${String((image as { name?: string }).name || 'layer')}`)),
      getImageData: vi.fn(),
      globalCompositeOperation: 'source-over',
    };
    const probePixels = new Uint8ClampedArray(512 * 1_024 * 4);
    for (let index = 3; index < probePixels.length; index += 4) probePixels[index] = 255;
    const probeContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: probePixels })),
      globalCompositeOperation: 'source-over',
    };
    const layerContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn((image: unknown) => operations.push(`layer:${String((image as { name?: string }).name)}`)),
      getImageData: vi.fn(),
      globalCompositeOperation: 'source-over',
    };
    const disposeOutput = vi.fn(() => operations.push('dispose:output'));
    const disposeProbe = vi.fn(() => operations.push('dispose:probe'));
    const disposeLayer = vi.fn(() => operations.push('dispose:layer'));
    let surface = 0;
    const runtime: ExactArtRasterRuntime = {
      load: vi.fn(async (url: string) => {
        if (url.includes('background')) return { source: background, width: 1_600, height: 900, close: closeBackground };
        if (url.includes('original')) return { source: original, width: 1_000, height: 2_000, close: closeOriginal };
        return { source: mask, width: 1_000, height: 2_000, close: closeMask };
      }),
      createSurface: vi.fn((width: number, height: number) => {
        surface += 1;
        const context = surface === 1 ? outputContext : surface === 2 ? probeContext : layerContext;
        return {
          canvas: {
            width,
            height,
            name: surface === 3 ? 'layer' : `surface-${surface}`,
            toDataURL: vi.fn(() => 'data:image/png;base64,final'),
          } as unknown as HTMLCanvasElement,
          context: context as unknown as CanvasRenderingContext2D,
          dispose: surface === 1 ? disposeOutput : surface === 2 ? disposeProbe : disposeLayer,
        };
      }),
    };

    await expect(compositeExactArtScene({
      background: 'data:image/png;base64,background',
      sources: [{ mimeType: 'image/png', data: 'original' }],
      layers: [{
        provider: 'rmbg-2.0',
        cache: 'miss',
        cacheKey: 'a'.repeat(64),
        image: { mimeType: 'image/png', data: 'mask' },
        sourceIndex: 0,
      }],
      plan,
    }, runtime)).resolves.toBe('data:image/png;base64,final');

    expect(operations).toEqual([
      'output:background',
      'dispose:probe',
      'layer:original',
      'layer:mask',
      'output:layer',
      'dispose:layer',
      'close:mask',
      'close:original',
      'dispose:output',
      'close:background',
    ]);
    expect(layerContext.globalCompositeOperation).toBe('destination-in');
    expect(outputContext.drawImage).toHaveBeenLastCalledWith(expect.anything(), 220, 90, 360, 720);
  });
});
