const OPENROUTER_IMAGE_MODEL_ORIGIN = 'https://openrouter.ai';
const MAX_CATALOG_RESPONSE_BYTES = 64 * 1024;

function modelEndpointUrl(modelId) {
  const path = modelId.split('/').map(encodeURIComponent).join('/');
  return `${OPENROUTER_IMAGE_MODEL_ORIGIN}/api/v1/images/models/${path}/endpoints`;
}

async function readBoundedResponseBytes(response) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength <= MAX_CATALOG_RESPONSE_BYTES ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CATALOG_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function readEndpointAvailability(modelId, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(modelEndpointUrl(modelId), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return 'unknown';
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_CATALOG_RESPONSE_BYTES) return 'unknown';
    const bytes = await readBoundedResponseBytes(response);
    if (!bytes) return 'unknown';
    const payload = JSON.parse(bytes.toString('utf8'));
    const endpoints = Array.isArray(payload?.endpoints)
      ? payload.endpoints
      : Array.isArray(payload?.data?.endpoints) ? payload.data.endpoints : null;
    if (!endpoints) return 'unknown';
    return endpoints.length > 0 ? 'available' : 'unavailable';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

/** Public, credential-free availability projected onto the server allowlist. */
export function createOpenRouterModelAvailability({
  modelIds,
  fetchImpl = globalThis.fetch,
  ttlMs = 10 * 60 * 1000,
  timeoutMs = 5_000,
  now = () => Date.now(),
}) {
  let cached = null;
  let expiresAt = 0;
  let inflight = null;

  async function refresh() {
    const models = await Promise.all(modelIds.map(async (id) => ({
      id,
      availability: await readEndpointAvailability(id, fetchImpl, timeoutMs),
    })));
    cached = models;
    expiresAt = now() + ttlMs;
    return models;
  }

  return {
    async list() {
      if (cached && now() < expiresAt) return cached;
      if (!inflight) inflight = refresh().finally(() => { inflight = null; });
      return inflight;
    },
  };
}
