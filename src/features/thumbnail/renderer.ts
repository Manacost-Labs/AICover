import { WOOD_FRAME_URL } from './templates';
import { THUMBNAIL_SAFE_MARGIN } from './layout';
import type {
  ResolvedThumbnailTypographyTreatment,
  ThumbnailLayout,
  ThumbnailRenderSettings,
} from './types';

const BASE_WIDTH = 1920;
const BASE_HEIGHT = 1080;

type TypographyPalette = {
  main: [string, string];
  accent: [string, string];
  outerStroke: string;
  innerStroke: string;
  extrusion: string;
  glow: string;
};

const TYPOGRAPHY_PALETTES: Record<Exclude<ResolvedThumbnailTypographyTreatment, 'custom'>, TypographyPalette> = {
  poster: {
    main: ['#ffffff', '#eef0f3'],
    accent: ['#7cf548', '#43c91d'],
    outerStroke: '#090a10',
    innerStroke: '#202431',
    extrusion: '#11131b',
    glow: 'rgba(126, 81, 255, 0.12)',
  },
  gold: {
    main: ['#fff9dc', '#d8c9a0'],
    accent: ['#fff08a', '#e58b12'],
    outerStroke: '#120b05',
    innerStroke: '#6f3c10',
    extrusion: '#351808',
    glow: 'rgba(255, 166, 36, 0.42)',
  },
  arcane: {
    main: ['#ffffff', '#d8d0ff'],
    accent: ['#8bfff4', '#8c55ff'],
    outerStroke: '#090514',
    innerStroke: '#492681',
    extrusion: '#221039',
    glow: 'rgba(155, 82, 255, 0.46)',
  },
  frost: {
    main: ['#ffffff', '#bed8ed'],
    accent: ['#d5ffff', '#52bce8'],
    outerStroke: '#05101a',
    innerStroke: '#275a78',
    extrusion: '#0c293d',
    glow: 'rgba(81, 204, 255, 0.4)',
  },
  fel: {
    main: ['#ffffec', '#dce4c2'],
    accent: ['#dfff62', '#58c91f'],
    outerStroke: '#080d05',
    innerStroke: '#315d18',
    extrusion: '#14250d',
    glow: 'rgba(112, 255, 54, 0.4)',
  },
  fire: {
    main: ['#fff9df', '#e3c4a8'],
    accent: ['#ffd95e', '#f04b1b'],
    outerStroke: '#140605',
    innerStroke: '#76251a',
    extrusion: '#3a100b',
    glow: 'rgba(255, 82, 25, 0.42)',
  },
};

const ACCENT_TONES: Record<'lime' | 'violet' | 'pink' | 'cyan' | 'orange' | 'yellow', [string, string]> = {
  lime: ['#a7ff5d', '#49d928'],
  violet: ['#f0d6ff', '#a855f7'],
  pink: ['#ffb7ee', '#ec4899'],
  cyan: ['#c8ffff', '#22d3ee'],
  orange: ['#ffe08a', '#f97316'],
  yellow: ['#fff789', '#facc15'],
};

export function resolveTypographyTreatment(settings: ThumbnailRenderSettings): ResolvedThumbnailTypographyTreatment {
  if (settings.text.treatment !== 'auto') return settings.text.treatment;
  return settings.autoLayout?.treatment ?? 'poster';
}

export function typographyPalette(settings: ThumbnailRenderSettings): TypographyPalette {
  const treatment = resolveTypographyTreatment(settings);
  if (treatment !== 'custom') {
    const palette = TYPOGRAPHY_PALETTES[treatment];
    const accent = settings.text.treatment === 'auto' && settings.autoLayout?.accentTone
      ? ACCENT_TONES[settings.autoLayout.accentTone]
      : null;
    return accent ? { ...palette, accent } : palette;
  }
  return {
    main: ['#ffffff', settings.text.primaryColor],
    accent: ['#fff8cf', settings.text.accentColor],
    outerStroke: '#050505',
    innerStroke: settings.text.accentColor,
    extrusion: '#111111',
    glow: `${settings.text.accentColor}66`,
  };
}

export function splitHeadline(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.trim() ? [line.trim()] : [])
    .slice(0, 4);
}

export function balanceHeadlineLines(text: string, desiredLineCount: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const hookWords = new Set(['ГАЙД', 'GUIDE', 'ТОП', 'TOP', 'ИМБА', 'BEST']);
  const prepositions = new Set(['В', 'ВО', 'НА', 'ПО', 'С', 'СО', 'К', 'КО', 'ИЗ', 'ЗА', 'ДЛЯ', 'О', 'ОБ', 'ОТ', 'ДО', 'БЕЗ', 'AND', 'OF', 'TO', 'IN', 'ON', 'FOR']);
  if (words.length <= 1) return words;
  const lineCount = Math.min(4, words.length, Math.max(2, Math.round(desiredLineCount)));
  let bestLines: string[] = [];
  let bestScore = Number.POSITIVE_INFINITY;

  const visit = (start: number, lines: string[]) => {
    const remainingLines = lineCount - lines.length;
    if (remainingLines === 1) {
      const candidate = [...lines, words.slice(start).join(' ')];
      const lengths = candidate.map((line) => line.length);
      const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
      const variance = lengths.reduce((sum, length) => sum + (length - average) ** 2, 0);
      const orphanPenalty = lengths.reduce((sum, length) => sum + (length <= 2 ? 36 : 0), 0);
      const internalPunctuationPenalty = candidate.reduce((sum, line) => {
        const lineWords = line.trim().split(/\s+/);
        const splitsACompletedPhrase = lineWords.slice(0, -1).some((word) => /[?!:…]$/.test(word));
        return sum + (splitsACompletedPhrase ? 280 : 0);
      }, 0);
      const completedPhraseBonus = candidate.slice(0, -1).reduce((sum, line) => (
        sum + (/[?!:…]$/.test(line.trim()) ? 180 : 0)
      ), 0);
      const danglingPrepositionPenalty = candidate.slice(0, -1).reduce((sum, line) => {
        const lastWord = line.trim().split(/\s+/).at(-1)?.toUpperCase() ?? '';
        return sum + (prepositions.has(lastWord) ? 180 : 0);
      }, 0);
      const hasStandaloneHook = lineCount >= 3 && candidate[0].split(/\s+/).length === 1 && hookWords.has(candidate[0].toUpperCase());
      const semanticHookBonus = hasStandaloneHook ? 120 : 0;
      const score = variance
        + Math.max(...lengths) * 0.22
        + orphanPenalty
        + danglingPrepositionPenalty
        + internalPunctuationPenalty
        - semanticHookBonus
        - completedPhraseBonus;
      if (score < bestScore) {
        bestScore = score;
        bestLines = candidate;
      }
      return;
    }

    const lastBreak = words.length - (remainingLines - 1);
    for (let end = start + 1; end <= lastBreak; end += 1) {
      visit(end, [...lines, words.slice(start, end).join(' ')]);
    }
  };

  visit(0, []);
  return bestLines.length ? bestLines : splitHeadline(text);
}

export function resolveHeadlineDominantLine(lines: string[], requestedIndex?: number): number {
  const genericHooks = new Set(['ГАЙД', 'GUIDE', 'ТОП', 'TOP', 'ИМБА', 'BEST', 'НОВАЯ', 'NEW', 'НОВЫЙ']);
  for (let index = 0; index < lines.length; index += 1) {
    const words = lines[index].trim().split(/\s+/).filter(Boolean);
    const normalized = words[0]?.replace(/[^\p{L}\p{N}-]+/gu, '').toUpperCase() ?? '';
    if (words.length === 1 && normalized.length >= 4 && !genericHooks.has(normalized)) return index;
  }
  if (Number.isInteger(requestedIndex) && requestedIndex! >= 0 && requestedIndex! < lines.length) {
    return requestedIndex!;
  }
  return Math.max(0, lines.length - 1);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:/i.test(src)) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось загрузить изображение для холста'));
    image.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sx = (image.naturalWidth - sourceWidth) / 2;
  const sy = (image.naturalHeight - sourceHeight) / 2;
  ctx.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, width, height);
}

function drawSafeZoneShade(
  ctx: CanvasRenderingContext2D,
  layout: ThumbnailLayout,
  width: number,
  height: number,
  strength: number,
) {
  if (strength <= 0) return;
  let gradient: CanvasGradient;
  if (layout === 'text-right') {
    gradient = ctx.createLinearGradient(width, 0, width * 0.42, 0);
  } else if (layout === 'center') {
    gradient = ctx.createLinearGradient(0, height, 0, height * 0.5);
  } else {
    gradient = ctx.createLinearGradient(0, 0, width * 0.58, 0);
  }
  gradient.addColorStop(0, `rgba(5, 3, 12, ${Math.min(0.92, strength)})`);
  gradient.addColorStop(0.72, `rgba(5, 3, 12, ${strength * 0.45})`);
  gradient.addColorStop(1, 'rgba(5, 3, 12, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawLocalizedBackdrop(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  strength: number,
) {
  if (strength <= 0) return;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const radius = Math.max(box.width, box.height) * 0.68;
  const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius);
  gradient.addColorStop(0, `rgba(3, 4, 12, ${Math.min(0.78, strength * 0.78)})`);
  gradient.addColorStop(0.58, `rgba(3, 4, 12, ${strength * 0.48})`);
  gradient.addColorStop(1, 'rgba(3, 4, 12, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function textBox(layout: ThumbnailLayout, width: number, height: number, settings: ThumbnailRenderSettings) {
  const safeMargin = settings.autoLayout?.safeMargin ?? THUMBNAIL_SAFE_MARGIN;
  const clampBox = (box: { x: number; y: number; width: number; height: number; align: 'left' | 'center' | 'right' }) => {
    const marginX = width * safeMargin;
    const marginY = height * safeMargin;
    const boxWidth = Math.min(box.width, width - marginX * 2);
    const boxHeight = Math.min(box.height, height - marginY * 2);
    return {
      ...box,
      x: Math.min(width - marginX - boxWidth, Math.max(marginX, box.x)),
      y: Math.min(height - marginY - boxHeight, Math.max(marginY, box.y)),
      width: boxWidth,
      height: boxHeight,
    };
  };
  if (settings.autoLayout) {
    return clampBox({
      x: width * settings.autoLayout.x,
      y: height * settings.autoLayout.y,
      width: width * settings.autoLayout.width,
      height: height * settings.autoLayout.height,
      align: settings.autoLayout.align,
    });
  }
  if (layout === 'text-right') {
    return clampBox({ x: width * 0.525, y: height * 0.14, width: width * 0.42, height: height * 0.72, align: 'center' as const });
  }
  if (layout === 'center') {
    return clampBox({ x: width * 0.26, y: height * 0.56, width: width * 0.48, height: height * 0.38, align: 'center' as const });
  }
  return clampBox({ x: width * 0.055, y: height * 0.14, width: width * 0.42, height: height * 0.72, align: 'center' as const });
}

type HeadlineBox = { x: number; y: number; width: number; height: number; align: 'left' | 'center' | 'right' };

export type ThumbnailLineMetrics = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  horizontalScale: number;
  accent: boolean;
  extrusionDepth?: number;
  rotation?: number;
  skew?: number;
};

export type ThumbnailHeadlineMetrics = {
  box: HeadlineBox;
  bounds: { x: number; y: number; width: number; height: number };
  widthFill: number;
  heightFill: number;
  canvasAreaFill: number;
  lines: ThumbnailLineMetrics[];
  checks: {
    readableAt320: boolean;
    balancedHierarchy: boolean;
    withinSafeBounds: boolean;
    fillsWidth: boolean;
    fillsHeight: boolean;
    avoidsProtectedRegions: boolean;
    protectedOverlapRatio: number;
    visualPriority: boolean;
  };
};

function measureLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  family: string,
  fontWeight: number,
) {
  ctx.font = `${fontWeight} ${fontSize}px ${family}`;
  const measured = ctx.measureText(text);
  const ascent = measured.actualBoundingBoxAscent || fontSize * 0.76;
  const descent = measured.actualBoundingBoxDescent || fontSize * 0.18;
  return { width: Math.max(1, measured.width), ascent, descent, height: ascent + descent };
}

export function calculateHeadlineLayout(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  box: HeadlineBox,
  options: {
    family: string;
    fontWeight: number;
    maximumFontSize: number;
    outputScale: number;
    accentIndexes: Set<number>;
    lineOffsets: number[];
    dominantLineIndex?: number;
  },
): ThumbnailHeadlineMetrics {
  const gap = -5 * options.outputScale;
  const targetWidths = lines.map((_, index) => {
    if (index === options.dominantLineIndex) return box.width * 0.98;
    if (index === 0) return box.width * 0.9;
    if (index === lines.length - 1) return box.width * 0.95;
    return box.width * 0.93;
  });
  const minimumFontSize = Math.min(options.maximumFontSize, box.height * (lines.length >= 3 ? 0.2 : 0.26));
  const maximumFontSize = Math.min(options.maximumFontSize * 1.35, box.height * (lines.length >= 3 ? 0.35 : 0.46));
  let fontSizes = lines.map((line, index) => {
    const unit = measureLine(ctx, line, 100, options.family, options.fontWeight);
    const widthFit = targetWidths[index] / unit.width * 100;
    return Math.min(maximumFontSize, Math.max(minimumFontSize, widthFit));
  });

  const measureAll = () => fontSizes.map((fontSize, index) => measureLine(ctx, lines[index], fontSize, options.family, options.fontWeight));
  let measurements = measureAll();
  let totalHeight = measurements.reduce((sum, measurement) => sum + measurement.height, 0) + gap * Math.max(0, lines.length - 1);
  const minimumBlockHeight = box.height * 0.62;
  const maximumBlockHeight = box.height * 0.94;
  if (totalHeight < minimumBlockHeight) {
    const boost = Math.min(1.24, minimumBlockHeight / Math.max(1, totalHeight));
    fontSizes = fontSizes.map((size) => Math.min(maximumFontSize, size * boost));
  } else if (totalHeight > maximumBlockHeight) {
    const reduction = maximumBlockHeight / totalHeight;
    fontSizes = fontSizes.map((size) => size * reduction);
  }
  measurements = measureAll();

  // Height boosting must never make a long line wider than the box at the
  // narrowest acceptable condensed scale. Reduce that line only, not the
  // complete headline block.
  const minimumHorizontalScale = 0.58;
  fontSizes = fontSizes.map((fontSize, index) => {
    const widthPerPixel = measurements[index].width / Math.max(1, fontSize);
    const largestFittingSize = box.width / Math.max(0.001, widthPerPixel * minimumHorizontalScale);
    return Math.min(fontSize, largestFittingSize);
  });
  measurements = measureAll();

  const horizontalScales = measurements.map((measurement, index) => {
    const required = targetWidths[index] / measurement.width;
    return Math.min(1.32, Math.max(minimumHorizontalScale, required));
  });
  const renderedWidths = measurements.map((measurement, index) => measurement.width * horizontalScales[index]);
  totalHeight = measurements.reduce((sum, measurement) => sum + measurement.height, 0) + gap * Math.max(0, lines.length - 1);
  const blockTop = box.y + Math.max(0, (box.height - totalHeight) / 2);
  let cursorY = blockTop;
  const metrics = lines.map((text, index) => {
    const measurement = measurements[index];
    const renderedWidth = renderedWidths[index];
    const alignedX = box.align === 'left'
      ? box.x
      : box.align === 'right'
        ? box.x + box.width - renderedWidth
        : box.x + (box.width - renderedWidth) / 2;
    const requestedX = alignedX + (options.lineOffsets[index] ?? 0) * box.width;
    const maximumX = Math.max(box.x, box.x + box.width - renderedWidth);
    const x = Math.min(maximumX, Math.max(box.x, requestedX));
    const line = {
      text,
      x,
      y: cursorY,
      width: renderedWidth,
      height: measurement.height,
      fontSize: fontSizes[index],
      horizontalScale: horizontalScales[index],
      accent: options.accentIndexes.has(index),
    };
    cursorY += measurement.height + gap;
    return line;
  });
  const minX = Math.min(...metrics.map((line) => line.x));
  const maxX = Math.max(...metrics.map((line) => line.x + line.width));
  const minY = Math.min(...metrics.map((line) => line.y));
  const maxY = Math.max(...metrics.map((line) => line.y + line.height));
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const widthFill = bounds.width / box.width;
  const heightFill = bounds.height / box.height;
  const minimumLineSize = Math.min(...metrics.map((line) => line.fontSize));
  const maximumLineSize = Math.max(...metrics.map((line) => line.fontSize));
  const withinSafeBounds = metrics.every((line) => (
    line.x >= box.x - 0.5
    && line.y >= box.y - 0.5
    && line.x + line.width <= box.x + box.width + 0.5
    && line.y + line.height <= box.y + box.height + 0.5
  ));
  return {
    box,
    bounds,
    widthFill,
    heightFill,
    canvasAreaFill: bounds.width * bounds.height / Math.max(1, ctx.canvas.width * ctx.canvas.height),
    lines: metrics,
    checks: {
      readableAt320: metrics.every((line) => line.fontSize * 0.25 >= 18),
      balancedHierarchy: minimumLineSize / Math.max(1, maximumLineSize) >= 0.55,
      withinSafeBounds,
      fillsWidth: metrics.every((line) => line.width / box.width >= 0.85) && widthFill >= 0.85,
      fillsHeight: heightFill >= 0.55 && heightFill <= 0.96,
      avoidsProtectedRegions: true,
      protectedOverlapRatio: 0,
      visualPriority: widthFill >= 0.85 && heightFill >= 0.55,
    },
  };
}

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  settings: ThumbnailRenderSettings,
  width: number,
  height: number,
): ThumbnailHeadlineMetrics | null {
  const scale = width / BASE_WIDTH;
  const auto = settings.autoLayout;
  const palette = typographyPalette(settings);
  const treatment = resolveTypographyTreatment(settings);
  const isEditorial = treatment === 'poster';
  const useKineticComposition = Boolean(auto) || isEditorial;
  const lines = (auto?.lines?.length ? auto.lines : splitHeadline(settings.text.text)).map((line) => line.toUpperCase());
  if (lines.length === 0) return null;
  const outputScale = width / 1280;
  const maximumTextSize = settings.text.fontSize * scale * (auto?.fontScale ?? 1);
  const plannedExtrusionDepth = Math.min(
    28 * outputScale,
    Math.max(14 * outputScale, maximumTextSize * 0.16),
  );
  const safeBox = textBox(settings.layout, width, height, settings);
  const effectPadding = Math.max(
    6 * scale,
    (settings.text.strokeWidth + settings.text.shadowBlur * 0.45) * scale,
    plannedExtrusionDepth + 9 * outputScale,
  );
  const box = {
    ...safeBox,
    x: safeBox.x + effectPadding,
    y: safeBox.y + effectPadding,
    width: Math.max(1, safeBox.width - effectPadding * 2),
    height: Math.max(1, safeBox.height - effectPadding * 2),
  };
  const fontWeight = settings.text.fontFamily.includes('Thumbnail Oswald') ? 700 : 900;
  const fallbackAccentIndexes: number[] = [];
  for (let index = Math.max(0, lines.length - settings.text.accentLines); index < lines.length; index += 1) {
    fallbackAccentIndexes.push(index);
  }
  const accentIndexes = new Set(auto?.accentLineIndexes ?? fallbackAccentIndexes);
  const firstAccentIndex = accentIndexes.values().next().value;
  const dominantLineIndex = resolveHeadlineDominantLine(lines, auto?.dominantLineIndex ?? firstAccentIndex);
  const layout = calculateHeadlineLayout(ctx, lines, box, {
    family: settings.text.fontFamily,
    fontWeight,
    maximumFontSize: maximumTextSize,
    outputScale,
    accentIndexes,
    lineOffsets: auto?.lineOffsets ?? lines.map(() => 0),
    dominantLineIndex,
  });
  if (auto?.protectedRegions?.length) {
    let maximumOverlap = 0;
    for (const line of layout.lines) {
      for (const region of auto.protectedRegions) {
        if (!['face', 'hand', 'weapon'].includes(region.label)) continue;
        const regionBox = {
          x: region.x * width,
          y: region.y * height,
          width: region.width * width,
          height: region.height * height,
        };
        const overlapWidth = Math.max(0, Math.min(line.x + line.width, regionBox.x + regionBox.width) - Math.max(line.x, regionBox.x));
        const overlapHeight = Math.max(0, Math.min(line.y + line.height, regionBox.y + regionBox.height) - Math.max(line.y, regionBox.y));
        const overlapArea = overlapWidth * overlapHeight;
        const smallerArea = Math.min(line.width * line.height, regionBox.width * regionBox.height);
        maximumOverlap = Math.max(maximumOverlap, overlapArea / Math.max(1, smallerArea));
      }
    }
    layout.checks.protectedOverlapRatio = maximumOverlap;
    layout.checks.avoidsProtectedRegions = maximumOverlap <= 0.04;
  }

  ctx.save();
  const safeMargin = auto?.safeMargin ?? THUMBNAIL_SAFE_MARGIN;
  ctx.beginPath();
  ctx.rect(width * safeMargin, height * safeMargin, width * (1 - safeMargin * 2), height * (1 - safeMargin * 2));
  ctx.clip();
  if (auto?.rotation) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate((auto.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  layout.lines.forEach((line, lineIndex) => {
    const measurement = measureLine(ctx, line.text, line.fontSize, settings.text.fontFamily, fontWeight);
    const baseline = line.y + measurement.ascent;
    const isDominantLine = lineIndex === dominantLineIndex;
    const colors: [string, string] = useKineticComposition
      ? isDominantLine
        ? palette.main
        : isEditorial ? ['#fff45e', '#f3b400'] : palette.accent
      : line.accent ? palette.accent : palette.main;
    const blackOutline = Math.min(10 * outputScale, Math.max(6 * outputScale, line.fontSize * 0.06));
    const purpleOutline = Math.min(4 * outputScale, Math.max(2 * outputScale, line.fontSize * 0.024));
    const shadowOffset = Math.min(10 * outputScale, Math.max(5 * outputScale, line.fontSize * 0.045));
    const extrusionDepth = Math.min(28 * outputScale, Math.max(14 * outputScale, line.fontSize * 0.16));
    const extrusionX = extrusionDepth * 0.78;
    const rimColor = useKineticComposition
      ? isEditorial
        ? isDominantLine ? '#b84cff' : '#39e75f'
        : isDominantLine ? palette.innerStroke : colors[1]
      : line.accent ? colors[1] : palette.innerStroke;
    const farExtrusionFill = useKineticComposition
      ? isEditorial
        ? isDominantLine ? '#351147' : '#143c19'
        : palette.extrusion
      : palette.extrusion;
    const nearExtrusionFill = useKineticComposition
      ? isEditorial
        ? isDominantLine ? '#69208a' : '#2f812e'
        : isDominantLine ? palette.innerStroke : colors[1]
      : palette.innerStroke;
    const editorialRotations = lines.length === 2
      ? [-2.4, 1.4]
      : lines.length === 3
        ? [-2.6, 1.15, -1.55]
        : [-2.8, 1.25, -1.4, 0.9];
    const editorialOffsets = lines.length === 2
      ? [0.018, -0.012]
      : lines.length === 3
        ? [0.018, -0.016, 0.012]
        : [0.018, -0.014, 0.014, -0.008];
    const lineRotation = useKineticComposition ? editorialRotations[lineIndex] ?? 0 : 0;
    const lineSkew = useKineticComposition ? (lineIndex % 2 === 0 ? -0.035 : 0.022) : 0;
    const visualOffsetX = useKineticComposition ? (editorialOffsets[lineIndex] ?? 0) * box.width : 0;
    const visualScaleY = isDominantLine ? 1.055 : 1;
    line.extrusionDepth = extrusionDepth;
    line.rotation = lineRotation;
    line.skew = lineSkew;

    ctx.save();
    if (useKineticComposition) {
      const centerX = line.x + line.width / 2 + visualOffsetX;
      const centerY = baseline - measurement.ascent / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate((lineRotation * Math.PI) / 180);
      ctx.transform(1, 0, lineSkew, 1, 0, 0);
      ctx.scale(line.horizontalScale, visualScaleY);
      ctx.translate(-measurement.width / 2, measurement.ascent / 2);
    } else {
      ctx.translate(line.x, baseline);
      ctx.scale(line.horizontalScale, 1);
    }
    ctx.font = `${fontWeight} ${line.fontSize}px ${settings.text.fontFamily}`;

    // A dense silhouette behind the side face keeps the 3D text readable over
    // bright spell effects, while the stepped fill creates real extrusion.
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.96)';
    ctx.shadowBlur = Math.max(4 * outputScale, extrusionDepth * 0.5);
    ctx.shadowOffsetX = shadowOffset + extrusionX * 0.45;
    ctx.shadowOffsetY = shadowOffset + extrusionDepth * 0.55;
    ctx.strokeStyle = '#050307';
    ctx.lineWidth = blackOutline + purpleOutline * 3.2;
    ctx.strokeText(line.text, extrusionX, extrusionDepth);
    ctx.fillStyle = '#050307';
    ctx.fillText(line.text, extrusionX, extrusionDepth);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = blackOutline + purpleOutline * 2.45;
    ctx.strokeText(line.text, extrusionX, extrusionDepth);
    ctx.restore();

    const extrusionSteps = Math.max(1, Math.round(extrusionDepth));
    for (let step = extrusionSteps; step >= 1; step -= 1) {
      const progress = step / extrusionSteps;
      const sideColor = progress > 0.58 ? farExtrusionFill : nearExtrusionFill;
      ctx.strokeStyle = sideColor;
      ctx.lineWidth = blackOutline + purpleOutline * 1.55;
      ctx.strokeText(line.text, extrusionX * progress, extrusionDepth * progress);
      ctx.fillStyle = sideColor;
      ctx.fillText(line.text, extrusionX * progress, extrusionDepth * progress);
    }

    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = Math.max(1.5 * outputScale, purpleOutline * 0.7);
    ctx.strokeText(line.text, extrusionX * 0.28, extrusionDepth * 0.28);
    ctx.restore();

    if (line.accent || useKineticComposition) {
      ctx.save();
      ctx.globalAlpha = isDominantLine ? 0.32 : 0.24;
      ctx.strokeStyle = rimColor;
      ctx.lineWidth = blackOutline + purpleOutline * 2.4;
      ctx.shadowColor = rimColor;
      ctx.shadowBlur = Math.min(12 * outputScale, line.fontSize * 0.08);
      ctx.strokeText(line.text, 0, 0);
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.92)';
    ctx.shadowBlur = Math.max(3 * outputScale, shadowOffset * 0.55);
    ctx.shadowOffsetX = shadowOffset;
    ctx.shadowOffsetY = shadowOffset;
    ctx.strokeStyle = '#090611';
    ctx.lineWidth = blackOutline;
    ctx.strokeText(line.text, 0, 0);
    ctx.fillStyle = '#090611';
    ctx.fillText(line.text, 0, 0);
    ctx.restore();

    ctx.strokeStyle = rimColor;
    ctx.lineWidth = blackOutline + purpleOutline * 2;
    ctx.strokeText(line.text, 0, 0);
    ctx.strokeStyle = palette.outerStroke;
    ctx.lineWidth = blackOutline;
    ctx.strokeText(line.text, 0, 0);
    const fill = ctx.createLinearGradient(0, -measurement.ascent, 0, measurement.descent);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(0.08, colors[0]);
    fill.addColorStop(0.58, colors[0]);
    fill.addColorStop(1, colors[1]);
    ctx.fillStyle = fill;
    ctx.fillText(line.text, 0, 0);

    // A restrained top-face sheen and lower shade emulate a bevel without
    // compromising the exact glyph shapes or Cyrillic readability.
    const sheen = ctx.createLinearGradient(0, -measurement.ascent, 0, measurement.descent);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
    sheen.addColorStop(0.18, 'rgba(255, 255, 255, 0.2)');
    sheen.addColorStop(0.42, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillText(line.text, -0.8 * outputScale, -1.2 * outputScale);

    ctx.save();
    ctx.globalAlpha = 0.48;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = Math.max(1 * outputScale, Math.min(2.2 * outputScale, line.fontSize * 0.012));
    ctx.strokeText(line.text, -0.8 * outputScale, -1.1 * outputScale);
    ctx.restore();
    ctx.restore();
  });
  ctx.restore();
  return layout;
}

function drawNineSlice(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  // The source is authored for border-image-slice: 13; keep the thin carved edge
  // and stretch only its long rails.
  const sourceSlice = Math.min(16, Math.floor(Math.min(image.naturalWidth, image.naturalHeight) * 0.02));
  const targetSlice = Math.max(18, Math.round(width * 0.018));
  const sw = image.naturalWidth;
  const sh = image.naturalHeight;
  const s = sourceSlice;
  const t = targetSlice;
  const cells = [
    [0, 0, s, s, 0, 0, t, t],
    [s, 0, sw - 2 * s, s, t, 0, width - 2 * t, t],
    [sw - s, 0, s, s, width - t, 0, t, t],
    [0, s, s, sh - 2 * s, 0, t, t, height - 2 * t],
    [sw - s, s, s, sh - 2 * s, width - t, t, t, height - 2 * t],
    [0, sh - s, s, s, 0, height - t, t, t],
    [s, sh - s, sw - 2 * s, s, t, height - t, width - 2 * t, t],
    [sw - s, sh - s, s, s, width - t, height - t, t, t],
  ];
  cells.forEach((args) => ctx.drawImage(image, ...args as [number, number, number, number, number, number, number, number]));
}

export async function renderThumbnail(
  canvas: HTMLCanvasElement,
  backgroundUrl: string,
  settings: ThumbnailRenderSettings,
  width = BASE_WIDTH,
  height = BASE_HEIGHT,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#160a22';
  ctx.fillRect(0, 0, width, height);

  const background = await loadImage(backgroundUrl);
  drawCover(ctx, background, width, height);
  if (settings.drawText !== false) {
    const primaryFont = settings.text.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (typeof document !== 'undefined' && document.fonts?.load) {
      await Promise.all([
        document.fonts.load(`700 96px "${primaryFont}"`),
        document.fonts.load(`900 96px "${primaryFont}"`),
      ]).catch(() => undefined);
    }
    const shadeLayout: Exclude<ThumbnailLayout, 'auto'> = settings.autoLayout
      ? settings.autoLayout.placement === 'center' || settings.autoLayout.y > 0.52
        ? 'center'
        : settings.autoLayout.placement === 'right' || settings.autoLayout.x > 0.48
          ? 'text-right'
          : 'text-left'
      : settings.layout === 'auto' ? 'text-right' : settings.layout;
    const backdropStrength = settings.autoLayout?.backdropStrength ?? 0;
    drawSafeZoneShade(ctx, shadeLayout, width, height, Math.max(settings.darken * 0.68, backdropStrength));
    if (settings.autoLayout && backdropStrength >= 0.48) {
      drawLocalizedBackdrop(ctx, textBox(settings.layout, width, height, settings), backdropStrength);
    }
    const headlineMetrics = drawHeadline(ctx, settings, width, height);
    if (headlineMetrics) canvas.dataset.textMetrics = JSON.stringify(headlineMetrics);
    else delete canvas.dataset.textMetrics;
  } else {
    delete canvas.dataset.textMetrics;
  }

  if (settings.frameEnabled) {
    try {
      const frame = await loadImage(WOOD_FRAME_URL);
      drawNineSlice(ctx, frame, width, height);
    } catch (error) {
      console.warn('Wood frame unavailable', error);
    }
  }
}

export async function exportThumbnail(backgroundUrl: string, settings: ThumbnailRenderSettings) {
  const canvas = document.createElement('canvas');
  await renderThumbnail(canvas, backgroundUrl, settings, 1280, 720);
  return canvas.toDataURL('image/png');
}
