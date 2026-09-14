import { describe, expect, it } from 'vitest';
import { balanceHeadlineLines, calculateHeadlineLayout, resolveHeadlineDominantLine, resolveTypographyTreatment, splitHeadline } from './renderer';
import type { ThumbnailRenderSettings } from './types';

describe('splitHeadline', () => {
  it('trims empty lines and limits the cover to four lines', () => {
    expect(splitHeadline('  Новая  \n\n имба \n раз \n два \n три \n четыре')).toEqual([
      'Новая', 'имба', 'раз', 'два',
    ]);
  });
});

describe('balanceHeadlineLines', () => {
  it('avoids a long phrase shrinking every line in the block', () => {
    expect(balanceHeadlineLines('ГАЙД ПО ЖРЕЦУ НА ПОДГОТОВКЕ', 3)).toEqual([
      'ГАЙД', 'ПО ЖРЕЦУ', 'НА ПОДГОТОВКЕ',
    ]);
  });

  it('keeps a two-word hook together for the volumetric reference hierarchy', () => {
    expect(balanceHeadlineLines('НОВАЯ ИМБА? РАФААМ ВЕРНУЛСЯ!', 3)).toEqual([
      'НОВАЯ ИМБА?', 'РАФААМ', 'ВЕРНУЛСЯ!',
    ]);
  });

  it('keeps a completed hook phrase intact and never joins words after its question mark', () => {
    expect(balanceHeadlineLines('НОВАЯ ИМБА? ЖРЕЦ НА ПОДГОТОВКЕ', 3)).toEqual([
      'НОВАЯ ИМБА?', 'ЖРЕЦ', 'НА ПОДГОТОВКЕ',
    ]);
  });

  it('does not leave a preposition alone and supports four compact lines', () => {
    const lines = balanceHeadlineLines('НОВАЯ САМАЯ СИЛЬНАЯ КОЛОДА В ЭТОЙ МЕТЕ', 4);
    expect(lines).toHaveLength(4);
    expect(lines).not.toContain('В');
  });

  it.each([
    ['НОВАЯ ИМБА', 2],
    ['THE BEST PRIEST DECK IS BACK', 3],
    ['КАК ПОБЕДИТЬ ЛЮБУЮ КОЛОДУ НА ЛАДДЕРЕ СЕГОДНЯ', 4],
  ])('balances short, English and long headlines: %s', (headline, count) => {
    const lines = balanceHeadlineLines(headline, count);
    expect(lines).toHaveLength(count);
    expect(lines.every((line) => line.trim().length > 1)).toBe(true);
  });
});

describe('resolveHeadlineDominantLine', () => {
  it('promotes a single semantic class or character instead of a generic hook', () => {
    expect(resolveHeadlineDominantLine(['НОВАЯ ИМБА?', 'ЖРЕЦ', 'НА ПОДГОТОВКЕ'], 2)).toBe(1);
    expect(resolveHeadlineDominantLine(['НОВАЯ ИМБА?', 'РАФААМ', 'ВЕРНУЛСЯ!'], 2)).toBe(1);
  });

  it('keeps the requested emphasis when there is no standalone entity line', () => {
    expect(resolveHeadlineDominantLine(['ГАЙД', 'ПО ЖРЕЦУ', 'НА ПОДГОТОВКЕ'], 2)).toBe(2);
  });
});

describe('resolveTypographyTreatment', () => {
  const settings = {
    layout: 'text-left',
    darken: 0.7,
    frameEnabled: true,
    text: { treatment: 'auto' },
  } as ThumbnailRenderSettings;

  it('uses the AI art direction in automatic mode', () => {
    expect(resolveTypographyTreatment({ ...settings, autoLayout: { treatment: 'arcane' } as ThumbnailRenderSettings['autoLayout'] })).toBe('arcane');
  });

  it('keeps an explicit user preset', () => {
    expect(resolveTypographyTreatment({ ...settings, text: { ...settings.text, treatment: 'fire' } })).toBe('fire');
  });
});

describe('calculateHeadlineLayout', () => {
  const createContext = () => {
    let font = '900 100px sans-serif';
    return {
      canvas: { width: 1280, height: 720 },
      get font() { return font; },
      set font(value: string) { font = value; },
      measureText(text: string) {
        const fontSize = Number(font.match(/([\d.]+)px/)?.[1] ?? 100);
        return {
          width: text.length * fontSize * 0.54,
          actualBoundingBoxAscent: fontSize * 0.76,
          actualBoundingBoxDescent: fontSize * 0.18,
        };
      },
    } as unknown as CanvasRenderingContext2D;
  };

  it.each([
    ['ГАЙД ПО ЖРЕЦУ НА ПОДГОТОВКЕ', 3],
    ['НОВАЯ ИМБА ВЕРНУЛАСЬ', 3],
    ['THE BEST PRIEST DECK IS BACK', 3],
  ])('fills the safe zone independently for every line: %s', (headline, lineCount) => {
    const lines = balanceHeadlineLines(headline, lineCount);
    const layout = calculateHeadlineLayout(createContext(), lines, {
      x: 680, y: 100, width: 550, height: 520, align: 'left',
    }, {
      family: 'sans-serif',
      fontWeight: 900,
      maximumFontSize: 190,
      outputScale: 1,
      accentIndexes: new Set([lines.length - 1]),
      lineOffsets: lines.map(() => 0),
    });

    expect(layout.checks.readableAt320).toBe(true);
    expect(layout.checks.balancedHierarchy).toBe(true);
    expect(layout.checks.withinSafeBounds).toBe(true);
    expect(layout.checks.fillsWidth).toBe(true);
    expect(layout.checks.fillsHeight).toBe(true);
    expect(layout.lines.every((line) => line.width >= layout.box.width * 0.85)).toBe(true);
  });

  it('never pushes an oversized two-line title outside the canvas box', () => {
    const layout = calculateHeadlineLayout(createContext(), ['НОВАЯ ИМБА?', 'РАФААМ ВЕРНУЛСЯ!'], {
      x: 90, y: 150, width: 486, height: 435, align: 'left',
    }, {
      family: 'sans-serif',
      fontWeight: 900,
      maximumFontSize: 190,
      outputScale: 1,
      accentIndexes: new Set([1]),
      lineOffsets: [0, 0],
    });

    expect(layout.checks.withinSafeBounds).toBe(true);
    expect(layout.lines.every((line) => line.x >= layout.box.x)).toBe(true);
    expect(layout.lines.every((line) => line.x + line.width <= layout.box.x + layout.box.width + 0.5)).toBe(true);
  });
});
