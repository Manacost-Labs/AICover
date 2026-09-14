import { describe, expect, it } from 'vitest';
import { estimateSideSpaceScores, resolveThumbnailPlacement, THUMBNAIL_SAFE_MARGIN } from './layout';

describe('estimateSideSpaceScores', () => {
  it('prefers a dark uniform side over a bright high-frequency side', () => {
    const width = 12;
    const height = 6;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const value = x < width / 2 ? 10 : (x + y) % 2 ? 255 : 40;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      }
    }
    const scores = estimateSideSpaceScores(pixels, width, height);
    expect(scores.left).toBeGreaterThan(scores.right);
  });
});

describe('resolveThumbnailPlacement', () => {
  it('chooses the free right side and keeps the box inside the safe margin', () => {
    const result = resolveThumbnailPlacement({
      preferredPlacement: 'right',
      rightSpaceScore: 92,
      leftSpaceScore: 28,
      centerSpaceScore: 20,
      x: 0.62,
      y: 0.12,
      width: 0.44,
      height: 0.72,
      protectedRegions: [{ label: 'face', x: 0.08, y: 0.12, width: 0.26, height: 0.38 }],
    }, 'auto');

    expect(result.placement).toBe('right');
    expect(result.width).toBeGreaterThanOrEqual(0.35);
    expect(result.width).toBeLessThanOrEqual(0.48);
    expect(result.x).toBeGreaterThanOrEqual(0.5);
    expect(result.x + result.width).toBeLessThanOrEqual(1 - THUMBNAIL_SAFE_MARGIN);
  });

  it('rejects an AI-preferred side when it overlaps a protected face', () => {
    const result = resolveThumbnailPlacement({
      preferredPlacement: 'left',
      leftSpaceScore: 88,
      rightSpaceScore: 80,
      centerSpaceScore: 30,
      protectedRegions: [{ label: 'face', x: 0.04, y: 0.08, width: 0.4, height: 0.58 }],
    }, 'auto');

    expect(result.placement).toBe('right');
  });

  it('honors a manual side while enabling the contrast fallback', () => {
    const result = resolveThumbnailPlacement({
      preferredPlacement: 'left',
      leftSpaceScore: 34,
      rightSpaceScore: 95,
      requiresBackdrop: true,
    }, 'text-left');

    expect(result.placement).toBe('left');
    expect(result.backdropStrength).toBeGreaterThanOrEqual(0.78);
  });

  it.each(['left', 'right', 'center'] as const)('keeps %s placement within the canvas safe area', (preferredPlacement) => {
    const result = resolveThumbnailPlacement({
      preferredPlacement,
      x: -1,
      y: 2,
      width: 1,
      height: 1,
      leftSpaceScore: preferredPlacement === 'left' ? 100 : 0,
      rightSpaceScore: preferredPlacement === 'right' ? 100 : 0,
      centerSpaceScore: preferredPlacement === 'center' ? 100 : 0,
    }, 'auto');

    expect(result.x).toBeGreaterThanOrEqual(THUMBNAIL_SAFE_MARGIN);
    expect(result.y).toBeGreaterThanOrEqual(THUMBNAIL_SAFE_MARGIN);
    expect(result.x + result.width).toBeLessThanOrEqual(1 - THUMBNAIL_SAFE_MARGIN);
    expect(result.y + result.height).toBeLessThanOrEqual(1 - THUMBNAIL_SAFE_MARGIN);
  });
});
