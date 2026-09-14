import { describe, expect, it } from 'vitest';
import { buildAiThumbnailPrompt } from './prompt';
import type { ThumbnailGenerationSettings, ThumbnailTextSettings } from './types';

const generation: ThumbnailGenerationSettings = {
  model: 'gemini-3.1-flash-image',
  imageSize: '2K',
  batchSize: 2,
  layout: 'text-right',
  stylePrompt: 'Bright fantasy art.',
};

const text: ThumbnailTextSettings = {
  text: 'НОВАЯ ИМБА?\nЖРЕЦ\nНА ПОДГОТОВКЕ',
  typographyPrompt: '',
  fontFamily: 'sans-serif',
  treatment: 'auto',
  fontSize: 200,
  primaryColor: '#ffffff',
  accentColor: '#65e637',
  accentLines: 1,
  strokeWidth: 12,
  shadowBlur: 10,
  lineHeight: 0.84,
};

describe('buildAiThumbnailPrompt', () => {
  it('asks for a finished image with the exact headline present once', () => {
    const prompt = buildAiThumbnailPrompt(generation, text, 1, true);

    expect(prompt).toContain('render the final art and typography together');
    expect(prompt).toContain('Prefer the right side');
    expect(prompt).toContain('ONE TIME in ONE block');
    expect(prompt).toContain('carved wooden frame');
    expect(prompt.match(/НОВАЯ ИМБА\? ЖРЕЦ НА ПОДГОТОВКЕ/g)).toHaveLength(1);
    expect(prompt).not.toContain('ARTWORK ONLY');
  });

  it('forbids duplicate readable extrusion and extra lettering', () => {
    const prompt = buildAiThumbnailPrompt(
      { ...generation, layout: 'auto' },
      { ...text, typographyPrompt: 'Use a lime accent.' },
      2,
      false,
    );

    expect(prompt).toContain('cleanest dark negative space');
    expect(prompt).toContain('never look like a second readable copy');
    expect(prompt).toContain('No echo text, offset readable copy');
    expect(prompt).toContain('Additional typography preference');
    expect(prompt).toContain('Do not add a border');
  });
});
