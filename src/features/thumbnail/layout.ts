import type {
  ThumbnailAutoLayout,
  ThumbnailLayout,
  ThumbnailProtectedRegion,
} from './types';

export const THUMBNAIL_SAFE_MARGIN = 0.055;

export function estimateSideSpaceScores(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { left: number; right: number } {
  const scoreRange = (fromX: number, toX: number) => {
    let luminanceSum = 0;
    let luminanceSquaredSum = 0;
    let edgeSum = 0;
    let samples = 0;
    for (let y = 1; y < height; y += 1) {
      for (let x = Math.max(1, fromX); x < toX; x += 1) {
        const index = (y * width + x) * 4;
        const previousIndex = (y * width + x - 1) * 4;
        const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
        const previous = pixels[previousIndex] * 0.2126 + pixels[previousIndex + 1] * 0.7152 + pixels[previousIndex + 2] * 0.0722;
        luminanceSum += luminance;
        luminanceSquaredSum += luminance * luminance;
        edgeSum += Math.abs(luminance - previous);
        samples += 1;
      }
    }
    if (!samples) return 0;
    const mean = luminanceSum / samples;
    const deviation = Math.sqrt(Math.max(0, luminanceSquaredSum / samples - mean * mean));
    const averageEdge = edgeSum / samples;
    const visualEnergy = mean * 0.18 + deviation * 0.48 + averageEdge * 0.72;
    return Math.round(Math.max(0, Math.min(100, 100 - visualEnergy * 0.56)));
  };

  return {
    left: scoreRange(0, Math.max(2, Math.floor(width * 0.45))),
    right: scoreRange(Math.floor(width * 0.55), width),
  };
}

export type ThumbnailPlacementAnalysis = {
  preferredPlacement?: 'left' | 'right' | 'center';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  align?: 'left' | 'center' | 'right';
  gazeDirection?: 'left' | 'right' | 'center';
  leftSpaceScore?: number;
  rightSpaceScore?: number;
  centerSpaceScore?: number;
  requiresBackdrop?: boolean;
  protectedRegions?: ThumbnailProtectedRegion[];
};

type PlacementGeometry = Pick<
  ThumbnailAutoLayout,
  'x' | 'y' | 'width' | 'height' | 'align' | 'placement' | 'safeMargin' | 'backdropStrength' | 'freeSpaceScore' | 'gazeDirection' | 'protectedRegions'
>;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function forcedPlacement(layout: ThumbnailLayout): 'left' | 'right' | 'center' | null {
  if (layout === 'text-left') return 'left';
  if (layout === 'text-right') return 'right';
  if (layout === 'center') return 'center';
  return null;
}

function sanitizeRegions(regions: ThumbnailProtectedRegion[] | undefined): ThumbnailProtectedRegion[] {
  if (!Array.isArray(regions)) return [];
  return regions.slice(0, 12).flatMap((region) => {
    const x = clamp(region.x, 0, 0.98, 0);
    const y = clamp(region.y, 0, 0.98, 0);
    const width = Math.min(clamp(region.width, 0.01, 1, 0.1), 1 - x);
    const height = Math.min(clamp(region.height, 0.01, 1, 0.1), 1 - y);
    return width > 0 && height > 0 ? [{ ...region, x, y, width, height }] : [];
  });
}

function intersectionRatio(
  box: { x: number; y: number; width: number; height: number },
  region: ThumbnailProtectedRegion,
): number {
  const width = Math.max(0, Math.min(box.x + box.width, region.x + region.width) - Math.max(box.x, region.x));
  const height = Math.max(0, Math.min(box.y + box.height, region.y + region.height) - Math.max(box.y, region.y));
  const intersection = width * height;
  return intersection / Math.max(0.001, Math.min(box.width * box.height, region.width * region.height));
}

function regionPenalty(label: ThumbnailProtectedRegion['label']): number {
  if (label === 'face') return 28;
  if (label === 'hand') return 18;
  if (label === 'weapon') return 14;
  if (label === 'subject') return 12;
  return 8;
}

function candidateBox(
  placement: 'left' | 'right' | 'center',
  analysis: ThumbnailPlacementAnalysis,
) {
  const margin = THUMBNAIL_SAFE_MARGIN;
  if (placement === 'center') {
    const width = clamp(analysis.width, 0.38, 0.48, 0.46);
    const height = clamp(analysis.height, 0.3, 0.44, 0.38);
    const requestedX = analysis.preferredPlacement === placement ? analysis.x : undefined;
    const requestedY = analysis.preferredPlacement === placement ? analysis.y : undefined;
    return {
      x: clamp(requestedX, margin, 1 - margin - width, (1 - width) / 2),
      y: clamp(requestedY, 0.5, 1 - margin - height, 1 - margin - height),
      width,
      height,
      align: 'center' as const,
    };
  }

  const width = clamp(analysis.width, 0.4, 0.48, 0.44);
  const height = clamp(analysis.height, 0.64, 0.82, 0.72);
  const defaultX = placement === 'left' ? margin : 1 - margin - width;
  const minX = placement === 'left' ? margin : Math.min(0.5, 1 - margin - width);
  const maxX = placement === 'left' ? Math.min(0.15, 0.5 - width) : 1 - margin - width;
  const requestedX = analysis.preferredPlacement === placement ? analysis.x : undefined;
  const requestedY = analysis.preferredPlacement === placement ? analysis.y : undefined;
  return {
    x: clamp(requestedX, minX, Math.max(minX, maxX), defaultX),
    y: clamp(requestedY, margin, 1 - margin - height, 0.14),
    width,
    height,
    align: analysis.preferredPlacement === placement && analysis.align
      ? analysis.align
      : 'center' as const,
  };
}

export function resolveThumbnailPlacement(
  analysis: ThumbnailPlacementAnalysis,
  requestedLayout: ThumbnailLayout,
): PlacementGeometry {
  const protectedRegions = sanitizeRegions(analysis.protectedRegions);
  const requiredPlacement = forcedPlacement(requestedLayout);
  const placements: Array<'left' | 'right' | 'center'> = requiredPlacement
    ? [requiredPlacement]
    : ['left', 'right', 'center'];
  const spaceScores = {
    left: clamp(analysis.leftSpaceScore, 0, 100, 50),
    right: clamp(analysis.rightSpaceScore, 0, 100, 50),
    center: clamp(analysis.centerSpaceScore, 0, 100, 35),
  };

  const ranked = placements.map((placement) => {
    const box = candidateBox(placement, analysis);
    let score = spaceScores[placement] / 18;
    if (analysis.preferredPlacement === placement) score += 1.5;
    if (analysis.gazeDirection === placement) score += 0.45;
    protectedRegions.forEach((region) => {
      score -= intersectionRatio(box, region) * regionPenalty(region.label);
    });
    return { placement, box, score, freeSpaceScore: spaceScores[placement] };
  }).sort((left, right) => right.score - left.score);

  const winner = ranked[0];
  const backdropStrength = analysis.requiresBackdrop || winner.freeSpaceScore < 62
    ? 0.78
    : winner.freeSpaceScore < 78 ? 0.48 : 0.24;
  return {
    ...winner.box,
    placement: winner.placement,
    safeMargin: THUMBNAIL_SAFE_MARGIN,
    backdropStrength,
    freeSpaceScore: winner.freeSpaceScore,
    gazeDirection: analysis.gazeDirection ?? 'center',
    protectedRegions,
  };
}
