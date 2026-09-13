import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { OPENROUTER_IMAGE_MODELS } from '../server/openrouter-image.js';

const OPENROUTER_ENDPOINT_ROOT = 'https://openrouter.ai/api/v1/images/models';
const MAX_CONTRACT_RESPONSE_BYTES = 256 * 1024;
const CONTRACT_REQUEST_TIMEOUT_MS = 10_000;
const EXPECTED_UNAVAILABLE_OPENROUTER_MODELS = new Set(['meta/muse-image']);
const GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-3.1-flash-lite-image',
];

function endpointUrl(modelId) {
  return `${OPENROUTER_ENDPOINT_ROOT}/${modelId.split('/').map(encodeURIComponent).join('/')}/endpoints`;
}

function enumContains(parameter, values) {
  const available = Array.isArray(parameter?.values) ? parameter.values : [];
  return values.every((value) => available.includes(value));
}

function rangeContains(parameter, min, max) {
  return parameter?.type === 'range'
    && Number(parameter.min) <= min
    && Number(parameter.max) >= max;
}

async function readBoundedJson(response, maxBytes = MAX_CONTRACT_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('response exceeds the contract-verifier byte limit');
  }
  if (!response.body?.getReader) throw new Error('response has no readable body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('response exceeds the contract-verifier byte limit');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
}

async function fetchContract(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(CONTRACT_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return { response, payload: null };
  return { response, payload: await readBoundedJson(response) };
}

function endpointSupportsProfile(endpoint, profile) {
  const parameters = endpoint?.supported_parameters;
  if (!parameters || typeof parameters !== 'object') return false;
  if (profile.maxReferences > 0 && !rangeContains(parameters.input_references, profile.minReferences, profile.maxReferences)) return false;
  if (profile.aspectRatios.length > 0 && !enumContains(parameters.aspect_ratio, profile.aspectRatios)) return false;
  if (profile.resolutions.length > 0 && !enumContains(parameters.resolution, profile.resolutions)) return false;
  if (profile.supportsN && !rangeContains(parameters.n, 1, 1)) return false;
  if (profile.quality && !enumContains(parameters.quality, [profile.quality])) return false;
  if (profile.background && !enumContains(parameters.background, [profile.background])) return false;
  if (profile.outputFormat && !enumContains(parameters.output_format, [profile.outputFormat])) return false;
  return true;
}

async function packageVersion(packagePath) {
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  return manifest.version;
}

export async function auditProviderContracts({
  fetchImpl = globalThis.fetch,
  geminiBaseUrl = 'http://127.0.0.1:3127/api/gemini/v1beta/models',
  oauthPackagePath = new URL('../node_modules/@openai-oauth/core/package.json', import.meta.url),
  readPackageVersion = packageVersion,
} = {}) {
  const errors = [];
  const openRouter = [];

  for (const [modelId, profile] of Object.entries(OPENROUTER_IMAGE_MODELS)) {
    let response;
    let payload;
    try {
      ({ response, payload } = await fetchContract(fetchImpl, endpointUrl(modelId)));
    } catch {
      errors.push(`OpenRouter ${modelId}: endpoint catalog request or bounded parse failed`);
      openRouter.push({ id: modelId, status: 'unknown' });
      continue;
    }
    if (!response.ok) {
      errors.push(`OpenRouter ${modelId}: endpoint catalog returned HTTP ${response.status}`);
      openRouter.push({ id: modelId, status: 'unknown' });
      continue;
    }
    const endpoints = Array.isArray(payload?.endpoints)
      ? payload.endpoints
      : Array.isArray(payload?.data?.endpoints) ? payload.data.endpoints : [];
    const expectedUnavailable = EXPECTED_UNAVAILABLE_OPENROUTER_MODELS.has(modelId);
    if (endpoints.length === 0) {
      if (!expectedUnavailable) errors.push(`OpenRouter ${modelId}: no active endpoint`);
      openRouter.push({ id: modelId, status: expectedUnavailable ? 'disabled-no-endpoint' : 'unavailable' });
      continue;
    }
    if (expectedUnavailable) {
      errors.push(`OpenRouter ${modelId}: endpoint appeared; review and enable its contract deliberately`);
      openRouter.push({ id: modelId, status: 'review-required' });
      continue;
    }
    if (!endpoints.some((endpoint) => endpointSupportsProfile(endpoint, profile))) {
      errors.push(`OpenRouter ${modelId}: no endpoint covers the server allowlist contract`);
      openRouter.push({ id: modelId, status: 'contract-mismatch' });
      continue;
    }
    openRouter.push({ id: modelId, status: 'ready' });
  }

  const gemini = [];
  for (const modelId of GEMINI_IMAGE_MODELS) {
    let response;
    let payload;
    try {
      ({ response, payload } = await fetchContract(fetchImpl, `${geminiBaseUrl}/${encodeURIComponent(modelId)}`));
    } catch {
      errors.push(`Gemini ${modelId}: model metadata request or bounded parse failed`);
      gemini.push({ id: modelId, status: 'unknown' });
      continue;
    }
    if (!response.ok) {
      errors.push(`Gemini ${modelId}: model metadata returned HTTP ${response.status}`);
      gemini.push({ id: modelId, status: 'unavailable' });
      continue;
    }
    const methods = Array.isArray(payload?.supportedGenerationMethods) ? payload.supportedGenerationMethods : [];
    if (!methods.includes('generateContent')) {
      errors.push(`Gemini ${modelId}: generateContent is not advertised`);
      gemini.push({ id: modelId, status: 'contract-mismatch' });
      continue;
    }
    gemini.push({ id: modelId, status: 'ready' });
  }

  let oauthVersion = null;
  try {
    oauthVersion = await readPackageVersion(oauthPackagePath);
    if (oauthVersion !== '2.0.0') errors.push(`ChatGPT OAuth adapter: expected @openai-oauth/core 2.0.0, found ${oauthVersion}`);
  } catch {
    errors.push('ChatGPT OAuth adapter: installed package metadata could not be read');
  }

  return {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    openRouter,
    gemini,
    chatgpt: { package: '@openai-oauth/core', version: oauthVersion, status: oauthVersion === '2.0.0' ? 'ready-static' : 'contract-mismatch' },
    errors,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await auditProviderContracts();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
