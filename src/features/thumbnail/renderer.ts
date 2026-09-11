import { WOOD_FRAME_URL } from './templates';
import type { ThumbnailLayout, ThumbnailRenderSettings } from './types';

const BASE_WIDTH = 1920;
const BASE_HEIGHT = 1080;

export function splitHeadline(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
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

function textBox(layout: ThumbnailLayout, width: number, height: number) {
  if (layout === 'text-right') {
    return { x: width * 0.52, y: height * 0.18, width: width * 0.42, height: height * 0.68, align: 'right' as const };
  }
  if (layout === 'center') {
    return { x: width * 0.08, y: height * 0.61, width: width * 0.84, height: height * 0.32, align: 'center' as const };
  }
  return { x: width * 0.06, y: height * 0.15, width: width * 0.46, height: height * 0.72, align: 'left' as const };
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  family: string,
  desiredSize: number,
  maxWidth: number,
  maxHeight: number,
  lineHeight: number,
) {
  let size = desiredSize;
  while (size > 34) {
    ctx.font = `900 ${size}px ${family}`;
    const widest = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
    if (widest <= maxWidth && lines.length * size * lineHeight <= maxHeight) break;
    size -= 2;
  }
  return size;
}

function drawHeadline(
  ctx: CanvasRenderingContext2D,
  settings: ThumbnailRenderSettings,
  width: number,
  height: number,
) {
  const scale = width / BASE_WIDTH;
  const lines = splitHeadline(settings.text.text.toUpperCase());
  if (lines.length === 0) return;
  const box = textBox(settings.layout, width, height);
  const fontSize = fitFontSize(
    ctx,
    lines,
    settings.text.fontFamily,
    settings.text.fontSize * scale,
    box.width,
    box.height,
    settings.text.lineHeight,
  );
  const step = fontSize * settings.text.lineHeight;
  const totalHeight = lines.length * step;
  let y = box.y + Math.max(0, (box.height - totalHeight) / 2) + fontSize;

  ctx.save();
  ctx.font = `900 ${fontSize}px ${settings.text.fontFamily}`;
  ctx.textAlign = box.align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = '#050505';
  ctx.lineWidth = settings.text.strokeWidth * scale;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.92)';
  ctx.shadowBlur = settings.text.shadowBlur * scale;
  ctx.shadowOffsetX = 8 * scale;
  ctx.shadowOffsetY = 10 * scale;

  const x = box.align === 'right' ? box.x + box.width : box.align === 'center' ? box.x + box.width / 2 : box.x;
  lines.forEach((line, index) => {
    ctx.fillStyle = index < settings.text.accentLines ? settings.text.accentColor : settings.text.primaryColor;
    ctx.strokeText(line, x, y, box.width);
    ctx.fillText(line, x, y, box.width);
    y += step;
  });
  ctx.restore();
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
  drawSafeZoneShade(ctx, settings.layout, width, height, settings.darken);
  drawHeadline(ctx, settings, width, height);

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
  await renderThumbnail(canvas, backgroundUrl, settings, BASE_WIDTH, BASE_HEIGHT);
  return canvas.toDataURL('image/png');
}
