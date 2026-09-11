import { describe, expect, it } from 'vitest';
import { buildThumbnailPrompt } from './prompt';

describe('buildThumbnailPrompt', () => {
  it('locks the requested safe zone and forbids generated text', () => {
    const prompt = buildThumbnailPrompt({
      model: 'gemini-3.1-flash-image',
      imageSize: '2K',
      batchSize: 2,
      layout: 'text-left',
      stylePrompt: 'Bright fantasy art.',
    }, 1);

    expect(prompt).toContain('RIGHT 55%');
    expect(prompt).toContain('NO words, letters, numbers');
    expect(prompt).toContain('Bright fantasy art.');
  });
});
