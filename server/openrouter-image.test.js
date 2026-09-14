import { describe, expect, it } from 'vitest';
import { buildOpenRouterImageRequest, extractOpenRouterImage } from './openrouter-image.js';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8Dwn+E/AwMAD/kC/ngnZtwAAAAASUVORK5CYII=';

describe('OpenRouter image request boundary', () => {
  it('uses the default GPT Image 2 profile and only supported provider fields', () => {
    const request = buildOpenRouterImageRequest({
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
      references: Array.from({ length: 17 }, () => ({ mimeType: 'image/png', data: tinyPng })),
    })).toThrow('at most 16');
  });

  it('normalizes a base64 provider response to a data URL', () => {
    expect(extractOpenRouterImage({ data: [{ b64_json: tinyPng, media_type: 'image/png' }] }))
      .toBe(`data:image/png;base64,${tinyPng}`);
  });
});
