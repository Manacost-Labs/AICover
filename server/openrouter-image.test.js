import { describe, expect, it } from 'vitest';
import { buildOpenRouterImageRequest, extractOpenRouterImage } from './openrouter-image.js';

const tinyPng = Buffer.from('test-image').toString('base64');

describe('OpenRouter image request boundary', () => {
  it('forces GPT Image 2 and only supported provider fields', () => {
    const request = buildOpenRouterImageRequest({
      model: 'attacker/other-model',
      prompt: 'Finished thumbnail',
      references: [{ mimeType: 'image/png', data: tinyPng }],
    });

    expect(request.model).toBe('openai/gpt-image-2');
    expect(request.quality).toBe('high');
    expect(request.background).toBe('opaque');
    expect(request).not.toHaveProperty('size');
    expect(request).not.toHaveProperty('aspect_ratio');
    expect(request.input_references[0].image_url.url).toContain('data:image/png;base64,');
  });

  it('rejects unsupported files and too many references', () => {
    expect(() => buildOpenRouterImageRequest({
      prompt: 'x',
      references: [{ mimeType: 'image/svg+xml', data: tinyPng }],
    })).toThrow('unsupported image type');

    expect(() => buildOpenRouterImageRequest({
      prompt: 'x',
      references: Array.from({ length: 5 }, () => ({ mimeType: 'image/png', data: tinyPng })),
    })).toThrow('between 1 and 4');
  });

  it('normalizes a base64 provider response to a data URL', () => {
    expect(extractOpenRouterImage({ data: [{ b64_json: tinyPng, media_type: 'image/webp' }] }))
      .toBe(`data:image/webp;base64,${tinyPng}`);
  });
});
