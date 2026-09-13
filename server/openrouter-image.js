const MAX_PROMPT_LENGTH = 16_000;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 24 * 1024 * 1024;
const RIVERFLOW_REFERENCE_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 23 * 1024 * 1024;
const ALLOWED_INPUT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_OUTPUT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Source of truth: https://openrouter.ai/api/v1/images/models and per-model
// endpoint capabilities (checked 2026-09-13).
// Only declared parameters are forwarded. A catalog entry is not permission to
// accept arbitrary provider options from the browser.
export const OPENROUTER_IMAGE_MODELS = Object.freeze({
  'openai/gpt-image-2': Object.freeze({
    minReferences: 0,
    maxReferences: 16,
    aspectRatios: Object.freeze(['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']),
    resolutions: Object.freeze([]),
    supportsN: true,
    quality: 'high',
    background: 'opaque',
  }),
  'meta/muse-image': Object.freeze({
    minReferences: 0,
    maxReferences: 1,
    aspectRatios: Object.freeze([]),
    resolutions: Object.freeze([]),
    supportsN: false,
  }),
  'recraft/recraft-v4-styles-pro': Object.freeze({
    minReferences: 1,
    maxReferences: 10,
    aspectRatios: Object.freeze(['1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16']),
    resolutions: Object.freeze([]),
    supportsN: true,
  }),
  'bytedance-seed/seedream-5-0-lite': Object.freeze({
    minReferences: 0,
    maxReferences: 14,
    aspectRatios: Object.freeze(['1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '9:19.5', '19.5:9', '9:20', '20:9', '9:21', '21:9']),
    resolutions: Object.freeze(['2K', '4K']),
    supportsN: true,
  }),
  'bytedance-seed/seedream-5-0-pro': Object.freeze({
    minReferences: 0,
    maxReferences: 14,
    aspectRatios: Object.freeze(['1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '9:19.5', '19.5:9', '9:20', '20:9', '9:21', '21:9']),
    resolutions: Object.freeze(['1K', '2K']),
    supportsN: true,
  }),
  'x-ai/grok-imagine-image-2.0': Object.freeze({
    minReferences: 0,
    maxReferences: 3,
    aspectRatios: Object.freeze(['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1']),
    resolutions: Object.freeze(['1K', '2K']),
    supportsN: true,
    quality: 'medium',
  }),
  'qwen/qwen-image-3-pro': Object.freeze({
    minReferences: 0,
    maxReferences: 4,
    aspectRatios: Object.freeze(['1:1', '1:2', '1:4', '2:1', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '9:16', '16:9']),
    resolutions: Object.freeze(['1K', '2K']),
    supportsN: true,
  }),
  'krea/krea-2-large': Object.freeze({
    minReferences: 0,
    maxReferences: 1,
    aspectRatios: Object.freeze(['1:1', '4:3', '3:2', '16:9', '4:5', '2:3', '9:16']),
    resolutions: Object.freeze(['1K']),
    supportsN: false,
  }),
  'sourceful/riverflow-v2.5-pro': Object.freeze({
    minReferences: 0,
    maxReferences: 10,
    aspectRatios: Object.freeze(['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9']),
    resolutions: Object.freeze(['1K', '2K', '4K']),
    supportsN: true,
    outputFormat: 'png',
    background: 'opaque',
    maxTotalReferenceBytes: RIVERFLOW_REFERENCE_BYTES,
  }),
  'sourceful/riverflow-v2.5-fast': Object.freeze({
    minReferences: 0,
    maxReferences: 4,
    aspectRatios: Object.freeze(['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9']),
    resolutions: Object.freeze(['1K', '2K']),
    supportsN: true,
    outputFormat: 'jpeg',
    background: 'opaque',
    maxTotalReferenceBytes: RIVERFLOW_REFERENCE_BYTES,
  }),
});

export function isOpenRouterEnabled(env = process.env) {
  return Boolean(env.OPENROUTER_API_KEY) && env.OPENROUTER_ENABLED === 'true';
}

function validationError(message, status = 400, code = 'INVALID_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

function normalizedMimeType(value) {
  const mimeType = String(value || '').toLowerCase();
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function decodeBase64(value, label) {
  const data = String(value || '');
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw validationError(`${label} must be a valid base64 image`);
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) {
    throw validationError(`${label} must be a valid base64 image`);
  }
  return { data, bytes };
}

function bytesMatchMime(bytes, mimeType) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function decodeImage(value, mimeType, label, invalidStatus = 400) {
  let decoded;
  try {
    decoded = decodeBase64(value, label);
  } catch (error) {
    if (invalidStatus !== 400) error.status = invalidStatus;
    throw error;
  }
  if (!bytesMatchMime(decoded.bytes, mimeType)) {
    throw validationError(`${label} MIME type does not match its bytes`, invalidStatus);
  }
  return decoded;
}

export function buildOpenRouterRequestHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://cover.hs-manacost.ru',
    'X-OpenRouter-Title': 'Manacost Cover',
  };
}

export function createOpenRouterBodyAdmission(limit = 2) {
  let active = 0;
  return function openRouterBodyAdmission(req, res, next) {
    if (req.method !== 'POST') {
      next(validationError('OpenRouter generation method is not allowed', 405));
      return;
    }
    if (active >= limit) {
      next(validationError('Слишком много одновременных загрузок изображений', 503));
      return;
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    req.once('aborted', release);
    req.once('error', release);
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

export function acknowledgeOpenRouterJob(jobs, jobId, ownerKey) {
  const job = jobs.get(jobId);
  if (!job || job.ownerKey !== ownerKey) {
    throw validationError('Задача генерации не найдена', 404);
  }
  if (job.status === 'pending') {
    throw validationError('Генерация ещё выполняется', 409);
  }
  jobs.delete(jobId);
}

export function buildOpenRouterImageRequest(body) {
  const model = typeof body?.model === 'string' && body.model
    ? body.model
    : 'openai/gpt-image-2';
  if (!Object.hasOwn(OPENROUTER_IMAGE_MODELS, model)) {
    throw validationError('Selected OpenRouter model is not available');
  }
  const profile = OPENROUTER_IMAGE_MODELS[model];

  const prompt = String(body?.prompt || '').trim();
  if (!prompt) throw validationError('Prompt is required');
  if (prompt.length > MAX_PROMPT_LENGTH) throw validationError('Prompt is too long', 413);

  const references = Array.isArray(body?.references) ? body.references : [];
  if (references.length > 0 && profile.maxReferences === 0) {
    throw validationError('Selected OpenRouter model does not declare reference image support', 422);
  }
  if (references.length < profile.minReferences) {
    throw validationError(`Selected OpenRouter model requires at least ${profile.minReferences} reference image`, 422);
  }
  if (references.length > profile.maxReferences) {
    throw validationError(`Selected OpenRouter model accepts at most ${profile.maxReferences} reference images`, 422);
  }

  let totalBytes = 0;
  const inputReferences = references.map((reference, index) => {
    const mimeType = normalizedMimeType(reference?.mimeType);
    if (!ALLOWED_INPUT_MIME_TYPES.has(mimeType)) {
      throw validationError(`Reference ${index + 1} has an unsupported image type`, 415);
    }
    const decoded = decodeImage(reference?.data, mimeType, `Reference ${index + 1}`);
    if (decoded.bytes.byteLength > MAX_REFERENCE_BYTES) {
      throw validationError(`Reference ${index + 1} is too large`, 413);
    }
    totalBytes += decoded.bytes.byteLength;
    if (totalBytes > (profile.maxTotalReferenceBytes || MAX_TOTAL_REFERENCE_BYTES)) {
      throw validationError(
        'Image references are too large for the selected provider',
        413,
        'REFERENCE_PAYLOAD_TOO_LARGE',
      );
    }
    return {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${decoded.data}` },
    };
  });

  const aspectRatio = body?.aspectRatio;
  if (aspectRatio != null && !profile.aspectRatios.includes(aspectRatio)) {
    throw validationError('Selected OpenRouter model does not support this aspect ratio', 422);
  }
  const resolution = body?.resolution;
  if (resolution != null && !profile.resolutions.includes(resolution)) {
    throw validationError('Selected OpenRouter model does not support this resolution', 422);
  }

  const request = { model, prompt };
  if (profile.supportsN) request.n = 1;
  if (resolution != null) request.resolution = resolution;
  if (aspectRatio != null) request.aspect_ratio = aspectRatio;
  if (profile.quality) request.quality = profile.quality;
  if (profile.outputFormat) request.output_format = profile.outputFormat;
  if (profile.background) request.background = profile.background;
  if (inputReferences.length > 0) request.input_references = inputReferences;
  return request;
}

export function extractOpenRouterImage(payload) {
  const image = payload?.data?.[0];
  const mimeType = normalizedMimeType(image?.media_type || 'image/png');
  if (!ALLOWED_OUTPUT_MIME_TYPES.has(mimeType)) {
    throw validationError('Image provider returned an unsupported format', 502);
  }
  const decoded = decodeImage(image?.b64_json, mimeType, 'Generated image', 502);
  if (decoded.bytes.byteLength > MAX_OUTPUT_BYTES) {
    throw validationError('Generated image is too large', 502);
  }
  return `data:${mimeType};base64,${decoded.data}`;
}

export async function extractOpenRouterImageResponse(response) {
  const declaredLength = Number(response?.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    await response?.body?.cancel?.().catch(() => {});
    throw validationError('Image provider response is too large', 502);
  }
  if (!response?.body?.getReader) {
    throw validationError('Image provider returned an invalid response', 502);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
        throw validationError('Image provider response is too large', 502);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks, totalBytes).toString('utf8'));
  } catch {
    throw validationError('Image provider returned an invalid response', 502);
  }
  return extractOpenRouterImage(payload);
}

export async function requestOpenRouterImage(requestBody, apiKey, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);
  try {
    const upstream = await fetchImpl('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      signal: controller.signal,
      headers: buildOpenRouterRequestHeaders(apiKey),
      body: JSON.stringify(requestBody),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel?.().catch(() => {});
      const failures = {
        400: ['Выбранные параметры не поддерживаются моделью', 422, 'UNSUPPORTED_PARAMETERS'],
        401: ['Серверный ключ OpenRouter отклонён', 503, 'OPENROUTER_AUTH'],
        403: ['Серверный ключ OpenRouter не имеет доступа к модели', 503, 'OPENROUTER_AUTH'],
        402: ['На балансе OpenRouter недостаточно средств', 402, 'OPENROUTER_CREDITS'],
        404: ['У модели сейчас нет активного endpoint OpenRouter', 503, 'MODEL_UNAVAILABLE'],
        413: ['Референсы превышают лимит выбранного провайдера', 413, 'REFERENCE_PAYLOAD_TOO_LARGE'],
        422: ['Выбранные параметры не поддерживаются моделью', 422, 'UNSUPPORTED_PARAMETERS'],
        429: ['Сервис генерации занят. Попробуйте немного позже.', 429, 'RATE_LIMITED'],
      };
      const [message, status, code] = failures[upstream.status]
        || (upstream.status >= 500
          ? ['Провайдер модели временно недоступен', 503, 'PROVIDER_UNAVAILABLE']
          : ['Провайдер модели отклонил запрос', 502, 'PROVIDER_REJECTED']);
      throw validationError(message, status, code);
    }
    // Keep the timeout active until the complete bounded response has arrived.
    return await extractOpenRouterImageResponse(upstream);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw validationError('Генерация превысила лимит времени', 504, 'PROVIDER_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
