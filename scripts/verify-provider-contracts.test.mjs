import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditProviderContracts } from './verify-provider-contracts.mjs';
import { OPENROUTER_IMAGE_MODELS } from '../server/openrouter-image.js';

function parametersFor(profile) {
  return {
    input_references: { type: 'range', min: profile.minReferences, max: profile.maxReferences },
    aspect_ratio: { type: 'enum', values: [...profile.aspectRatios] },
    resolution: { type: 'enum', values: [...profile.resolutions] },
    n: { type: 'range', min: 1, max: 1 },
    quality: { type: 'enum', values: profile.quality ? [profile.quality] : [] },
    background: { type: 'enum', values: profile.background ? [profile.background] : [] },
    output_format: { type: 'enum', values: profile.outputFormat ? [profile.outputFormat] : [] },
  };
}

function fetchFixture({ mismatchModel } = {}) {
  return async (url) => {
    const value = String(url);
    if (value.includes('/api/gemini/')) {
      return new Response(JSON.stringify({ supportedGenerationMethods: ['generateContent'] }));
    }
    const modelId = Object.keys(OPENROUTER_IMAGE_MODELS).find((id) => value.includes(id.split('/').map(encodeURIComponent).join('/')));
    if (!modelId) return new Response('{}', { status: 404 });
    if (modelId === 'meta/muse-image') return new Response(JSON.stringify({ endpoints: [] }));
    const profile = OPENROUTER_IMAGE_MODELS[modelId];
    const parameters = parametersFor(profile);
    if (modelId === mismatchModel) parameters.input_references.max = 0;
    return new Response(JSON.stringify({ endpoints: [{ supported_parameters: parameters }] }));
  };
}

describe('provider contract verifier', () => {
  it('accepts compatible endpoints, stable Gemini models, and OAuth adapter 2.0.0', async () => {
    const report = await auditProviderContracts({
      fetchImpl: fetchFixture(),
      geminiBaseUrl: 'http://cover.test/api/gemini/v1beta/models',
      readPackageVersion: async () => '2.0.0',
    });
    assert.equal(report.ok, true);
    assert.equal(report.openRouter.filter((row) => row.status === 'ready').length, 9);
    assert.deepEqual(report.openRouter.find((row) => row.id === 'meta/muse-image'), {
      id: 'meta/muse-image',
      status: 'disabled-no-endpoint',
    });
    assert.equal(report.gemini.every((row) => row.status === 'ready'), true);
  });

  it('fails closed when a selectable endpoint no longer covers the allowlist', async () => {
    const report = await auditProviderContracts({
      fetchImpl: fetchFixture({ mismatchModel: 'bytedance-seed/seedream-5-0-pro' }),
      geminiBaseUrl: 'http://cover.test/api/gemini/v1beta/models',
      readPackageVersion: async () => '2.0.0',
    });
    assert.equal(report.ok, false);
    assert.match(report.errors.join('\n'), /seedream-5-0-pro: no endpoint covers/);
  });
});
