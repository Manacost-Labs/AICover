import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const BRIA_RMBG_ENDPOINT = 'https://engine.prod.bria-api.com/v2/image/edit/remove_background';
const BRIA_RMBG_VERSION = 'rmbg-2.0';
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_CACHE_ENTRY_BYTES = 28 * 1024 * 1024;
const DEFAULT_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_CACHE_MAX_ENTRIES = 128;
const ALLOWED_INPUT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_OUTPUT_MIME_TYPES = new Set(['image/png']);
const ALLOWED_RESULT_HOSTS = new Set(['temp.bria.ai']);
const CACHE_FILE_NAME = /^[a-f0-9]{64}\.json$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_EDGE = 8_192;
const MAX_PNG_PIXELS = 24_000_000;
const MAX_PNG_DECODE_BYTES = 128 * 1024 * 1024;
const PNG_CHANNELS = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
const PNG_BIT_DEPTHS = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])],
]);
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function requestError(message, status = 400, code = 'BRIA_INVALID_REQUEST') {
  return Object.assign(new Error(message), { status, code });
}

function normalizedMimeType(value) {
  const mimeType = String(value || '').toLowerCase();
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum
    ? Math.min(parsed, maximum)
    : fallback;
}

function decodeCanonicalBase64(value, label, status = 400) {
  const data = String(value || '');
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw requestError(`${label} must be valid canonical base64`, status, status === 400 ? 'BRIA_INVALID_REQUEST' : 'BRIA_INVALID_IMAGE');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.toString('base64') !== data) {
    throw requestError(`${label} must be valid canonical base64`, status, status === 400 ? 'BRIA_INVALID_REQUEST' : 'BRIA_INVALID_IMAGE');
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

function invalidPngCutout() {
  return requestError('BRIA returned an invalid subject cutout', 502, 'BRIA_INVALID_IMAGE');
}

function pngCrc32(typeBytes, data) {
  let crc = 0xffffffff;
  for (const bytes of [typeBytes, data]) {
    for (const byte of bytes) crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterPngRow(filtered, previous, filterType, bytesPerPixel) {
  const row = Buffer.allocUnsafe(filtered.length);
  for (let index = 0; index < filtered.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const above = previous?.[index] || 0;
    const upperLeft = index >= bytesPerPixel ? previous?.[index - bytesPerPixel] || 0 : 0;
    let predictor;
    if (filterType === 0) predictor = 0;
    else if (filterType === 1) predictor = left;
    else if (filterType === 2) predictor = above;
    else if (filterType === 3) predictor = Math.floor((left + above) / 2);
    else if (filterType === 4) predictor = paethPredictor(left, above, upperLeft);
    else throw invalidPngCutout();
    row[index] = (filtered[index] + predictor) & 0xff;
  }
  return row;
}

function pngSample(row, sampleIndex, bitDepth) {
  if (bitDepth === 16) return row.readUInt16BE(sampleIndex * 2);
  if (bitDepth === 8) return row[sampleIndex];
  const bitOffset = sampleIndex * bitDepth;
  const shift = 8 - bitDepth - (bitOffset % 8);
  return (row[Math.floor(bitOffset / 8)] >>> shift) & ((1 << bitDepth) - 1);
}

function validatePngCutout(bytes) {
  try {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw invalidPngCutout();
    let offset = 8;
    let header;
    let transparency;
    let paletteEntries = 0;
    let seenPalette = false;
    let seenIdat = false;
    let idatEnded = false;
    let seenIend = false;
    const idat = [];

    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) throw invalidPngCutout();
      const length = bytes.readUInt32BE(offset);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const chunkEnd = dataEnd + 4;
      if (dataEnd < dataStart || chunkEnd > bytes.length) throw invalidPngCutout();
      const typeBytes = bytes.subarray(offset + 4, offset + 8);
      const type = typeBytes.toString('ascii');
      const data = bytes.subarray(dataStart, dataEnd);
      if (!/^[A-Za-z]{4}$/.test(type) || bytes.readUInt32BE(dataEnd) !== pngCrc32(typeBytes, data)) {
        throw invalidPngCutout();
      }
      if (!header && type !== 'IHDR') throw invalidPngCutout();
      if (seenIend) throw invalidPngCutout();
      if (seenIdat && type !== 'IDAT') idatEnded = true;

      if (type === 'IHDR') {
        if (header || length !== 13) throw invalidPngCutout();
        const width = data.readUInt32BE(0);
        const height = data.readUInt32BE(4);
        const bitDepth = data[8];
        const colorType = data[9];
        if (
          !width || !height
          || width > MAX_PNG_EDGE || height > MAX_PNG_EDGE
          || width * height > MAX_PNG_PIXELS
          || !PNG_BIT_DEPTHS.get(colorType)?.has(bitDepth)
          || data[10] !== 0 || data[11] !== 0 || data[12] !== 0
        ) throw invalidPngCutout();
        header = { width, height, bitDepth, colorType };
      } else if (type === 'PLTE') {
        if (
          seenPalette || seenIdat || transparency
          || header.colorType === 0 || header.colorType === 4
          || length === 0 || length % 3 !== 0 || length > 768
        ) throw invalidPngCutout();
        paletteEntries = length / 3;
        if (header.colorType === 3 && paletteEntries > (1 << header.bitDepth)) throw invalidPngCutout();
        seenPalette = true;
      } else if (type === 'tRNS') {
        if (
          seenIdat || transparency
          || header.colorType === 4 || header.colorType === 6
          || (header.colorType === 3 && !seenPalette)
        ) throw invalidPngCutout();
        transparency = Buffer.from(data);
      } else if (type === 'IDAT') {
        if (!header || idatEnded || (header.colorType === 3 && !seenPalette)) throw invalidPngCutout();
        seenIdat = true;
        idat.push(Buffer.from(data));
      } else if (type === 'IEND') {
        if (!seenIdat || length !== 0 || chunkEnd !== bytes.length) throw invalidPngCutout();
        seenIend = true;
      } else if (type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90) {
        throw invalidPngCutout();
      }
      offset = chunkEnd;
    }

    if (!header || !seenIend) throw invalidPngCutout();
    const { width, height, bitDepth, colorType } = header;
    const channels = PNG_CHANNELS.get(colorType);
    if (!channels) throw invalidPngCutout();
    if (colorType === 3 && (!seenPalette || !transparency || transparency.length > paletteEntries)) throw invalidPngCutout();
    if (colorType === 0 && transparency?.length !== 2) throw invalidPngCutout();
    if (colorType === 2 && transparency?.length !== 6) throw invalidPngCutout();
    if ((colorType === 4 || colorType === 6) && transparency) throw invalidPngCutout();
    if ((colorType === 0 || colorType === 2) && !transparency) throw invalidPngCutout();

    const bitsPerPixel = channels * bitDepth;
    const rowBytes = Math.ceil(width * bitsPerPixel / 8);
    const expectedBytes = height * (rowBytes + 1);
    if (!expectedBytes || expectedBytes > MAX_PNG_DECODE_BYTES) throw invalidPngCutout();
    const inflated = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expectedBytes });
    if (inflated.length !== expectedBytes) throw invalidPngCutout();
    const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
    const maxSample = bitDepth === 16 ? 0xffff : (1 << bitDepth) - 1;
    const maxAlpha = colorType === 3 ? 0xff : maxSample;
    let hasVisiblePixel = false;
    let hasTransparentPixel = false;
    let previous = null;
    let rowOffset = 0;

    for (let y = 0; y < height; y += 1) {
      const filterType = inflated[rowOffset];
      const row = unfilterPngRow(
        inflated.subarray(rowOffset + 1, rowOffset + 1 + rowBytes),
        previous,
        filterType,
        filterBytesPerPixel,
      );
      for (let x = 0; x < width; x += 1) {
        let alpha = maxSample;
        if (colorType === 6) alpha = pngSample(row, x * 4 + 3, bitDepth);
        else if (colorType === 4) alpha = pngSample(row, x * 2 + 1, bitDepth);
        else if (colorType === 3) {
          const paletteIndex = pngSample(row, x, bitDepth);
          if (paletteIndex >= paletteEntries) throw invalidPngCutout();
          alpha = paletteIndex < transparency.length ? transparency[paletteIndex] : 0xff;
        } else if (colorType === 0) {
          alpha = pngSample(row, x, bitDepth) === transparency.readUInt16BE(0) ? 0 : maxSample;
        } else if (colorType === 2) {
          const sampleIndex = x * 3;
          alpha = pngSample(row, sampleIndex, bitDepth) === transparency.readUInt16BE(0)
            && pngSample(row, sampleIndex + 1, bitDepth) === transparency.readUInt16BE(2)
            && pngSample(row, sampleIndex + 2, bitDepth) === transparency.readUInt16BE(4)
            ? 0
            : maxSample;
        }
        if (alpha > 0) hasVisiblePixel = true;
        if (alpha < maxAlpha) hasTransparentPixel = true;
      }
      previous = row;
      rowOffset += rowBytes + 1;
    }
    if (!hasVisiblePixel || !hasTransparentPixel) throw invalidPngCutout();
  } catch (error) {
    if (error?.code === 'BRIA_INVALID_IMAGE') throw error;
    throw invalidPngCutout();
  }
}

function decodeInput(input) {
  const mimeType = normalizedMimeType(input?.mimeType);
  if (!ALLOWED_INPUT_MIME_TYPES.has(mimeType)) {
    throw requestError('BRIA source has an unsupported image type', 415, 'BRIA_UNSUPPORTED_IMAGE');
  }
  const decoded = decodeCanonicalBase64(input?.data, 'BRIA source');
  if (decoded.bytes.byteLength > MAX_INPUT_BYTES) {
    throw requestError('BRIA source is larger than 10 MiB', 413, 'BRIA_SOURCE_TOO_LARGE');
  }
  if (!bytesMatchMime(decoded.bytes, mimeType)) {
    throw requestError('BRIA source MIME type does not match its bytes', 415, 'BRIA_UNSUPPORTED_IMAGE');
  }
  return { ...decoded, mimeType };
}

function decodeOutput(data, mimeType) {
  const normalized = normalizedMimeType(mimeType);
  if (!ALLOWED_OUTPUT_MIME_TYPES.has(normalized)) {
    throw requestError('BRIA returned an image without a transparency-capable format', 502, 'BRIA_INVALID_IMAGE');
  }
  const decoded = decodeCanonicalBase64(data, 'BRIA result', 502);
  if (decoded.bytes.byteLength > MAX_OUTPUT_BYTES || !bytesMatchMime(decoded.bytes, normalized)) {
    throw requestError('BRIA returned an invalid image', 502, 'BRIA_INVALID_IMAGE');
  }
  if (normalized === 'image/png') validatePngCutout(decoded.bytes);
  return { ...decoded, mimeType: normalized };
}

async function readBoundedBytes(response, maxBytes, code) {
  const declaredLength = Number(response?.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response?.body?.cancel?.().catch(() => {});
    throw requestError('BRIA response is too large', 502, code);
  }
  if (!response?.body?.getReader) {
    throw requestError('BRIA returned an invalid response', 502, code);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw requestError('BRIA response is too large', 502, code);
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, total);
}

function mapUpstreamFailure(status) {
  if (status === 401 || status === 403) {
    return requestError('BRIA credential was rejected by the provider', 503, 'BRIA_AUTH');
  }
  if (status === 429) {
    return requestError('BRIA is rate limiting requests', 429, 'BRIA_RATE_LIMITED');
  }
  if (status === 400 || status === 415 || status === 422) {
    return requestError('BRIA rejected the source image', 422, 'BRIA_SOURCE_REJECTED');
  }
  if (status >= 500) {
    return requestError('BRIA is temporarily unavailable', 503, 'BRIA_UNAVAILABLE');
  }
  return requestError('BRIA rejected the request', 502, 'BRIA_REJECTED');
}

export function isBriaEnabled(env = process.env) {
  return Boolean(env.BRIA_API_TOKEN) && env.BRIA_RMBG_ENABLED === 'true';
}

export function createBriaBodyAdmission(limit = 2) {
  const parsedLimit = Number(limit);
  const safeLimit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 4)
    : 2;
  let active = 0;
  return function briaBodyAdmission(req, res, next) {
    if (req.method !== 'POST') {
      next(requestError('BRIA background removal method is not allowed', 405, 'BRIA_METHOD_NOT_ALLOWED'));
      return;
    }
    if (active >= safeLimit) {
      next(requestError('Слишком много одновременных загрузок изображений', 503, 'BRIA_BUSY'));
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

export function sanitizeBriaBodyError(error, _req, _res, next) {
  if (error?.type === 'entity.too.large' || Number(error?.status) === 413) {
    next(requestError('BRIA request body is too large', 413, 'BRIA_SOURCE_TOO_LARGE'));
    return;
  }
  if (error?.type || Object.hasOwn(error || {}, 'body')) {
    next(requestError('BRIA request body is invalid JSON', 400, 'BRIA_INVALID_JSON'));
    return;
  }
  next(error);
}

export function createBriaRequestRateLimiter(options = {}) {
  const limit = boundedInteger(options.limit, 20, 1, 100);
  const windowMs = boundedInteger(options.windowMs, 10 * 60 * 1000, 1_000, 60 * 60 * 1000);
  const maxBuckets = boundedInteger(options.maxBuckets, 1_000, 1, 10_000);
  const now = options.now || Date.now;
  const buckets = new Map();

  return function limitBriaRequests(req, _res, next) {
    const timestamp = now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const recent = (buckets.get(key) || [])
      .filter((startedAt) => timestamp - startedAt < windowMs);
    if (recent.length >= limit) {
      next(requestError('Слишком много запросов на подготовку изображений', 429, 'BRIA_RATE_LIMITED'));
      return;
    }
    if (!buckets.has(key) && buckets.size >= maxBuckets) {
      for (const [bucketKey, starts] of buckets) {
        if (!starts.some((startedAt) => timestamp - startedAt < windowMs)) buckets.delete(bucketKey);
      }
      if (buckets.size >= maxBuckets) {
        next(requestError('Слишком много запросов на подготовку изображений', 429, 'BRIA_RATE_LIMITED'));
        return;
      }
    }
    recent.push(timestamp);
    buckets.set(key, recent);
    next();
  };
}

export function buildBriaRequest(input) {
  const source = decodeInput(input);
  return {
    image: source.data,
    preserve_alpha: true,
    sync: true,
  };
}

export function subjectLayerCacheKey(bytes, version = BRIA_RMBG_VERSION) {
  return crypto.createHash('sha256')
    .update('cover-subject-layer\0')
    .update(String(version))
    .update('\0')
    .update(bytes)
    .digest('hex');
}

async function readCache(cachePath, expectedVersion) {
  try {
    const stat = await fs.stat(cachePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CACHE_ENTRY_BYTES) return null;
    const payload = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (payload?.schema !== 1 || payload?.version !== expectedVersion) return null;
    const output = decodeOutput(payload.data, payload.mimeType);
    return { data: output.data, mimeType: output.mimeType };
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError || error?.code === 'BRIA_INVALID_IMAGE') return null;
    throw error;
  }
}

async function writeCache(cachePath, serializedPayload) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, serializedPayload, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, cachePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function verifyCacheWritable(cacheDir) {
  const probePath = path.join(cacheDir, `.write-probe.${process.pid}.${crypto.randomUUID()}`);
  try {
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(probePath, '', { mode: 0o600, flag: 'wx' });
    await fs.rm(probePath);
  } catch {
    await fs.rm(probePath, { force: true }).catch(() => {});
    throw requestError('BRIA cache is unavailable', 503, 'BRIA_CACHE_UNAVAILABLE');
  }
}

async function cacheEntries(cacheDir) {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(cacheDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const entries = await Promise.all(directoryEntries
    .filter((entry) => entry.isFile() && CACHE_FILE_NAME.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(cacheDir, entry.name);
      try {
        const stat = await fs.stat(filePath);
        return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    }));
  return entries.filter(Boolean).sort((left, right) => left.mtimeMs - right.mtimeMs);
}

async function pruneCache(cacheDir, limits, incoming = null) {
  const entries = await cacheEntries(cacheDir);
  const incomingExists = incoming
    ? entries.some((entry) => entry.filePath === incoming.filePath)
    : false;
  let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  let totalEntries = entries.length;
  if (incoming) {
    const previousSize = incomingExists
      ? entries.find((entry) => entry.filePath === incoming.filePath)?.size || 0
      : 0;
    totalBytes += incoming.size - previousSize;
    if (!incomingExists) totalEntries += 1;
  }
  for (const entry of entries) {
    if (totalBytes <= limits.maxBytes && totalEntries <= limits.maxEntries) break;
    if (incoming && entry.filePath === incoming.filePath) continue;
    await fs.rm(entry.filePath, { force: true });
    totalBytes -= entry.size;
    totalEntries -= 1;
  }
  if (totalBytes > limits.maxBytes || totalEntries > limits.maxEntries) {
    throw requestError('BRIA cache quota is exhausted', 507, 'BRIA_CACHE_FULL');
  }
}

function validateResultUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    throw requestError('BRIA returned an invalid result URL', 502, 'BRIA_INVALID_RESPONSE');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || !ALLOWED_RESULT_HOSTS.has(parsed.hostname)
  ) {
    throw requestError('BRIA returned an invalid result URL', 502, 'BRIA_INVALID_RESPONSE');
  }
  return parsed.toString();
}

export function createBriaRmbgService(options = {}) {
  const apiToken = String(options.apiToken || '');
  const cacheDir = path.resolve(options.cacheDir || '/var/lib/cover-image/bria-rmbg-cache');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 120_000);
  const version = String(options.version || BRIA_RMBG_VERSION);
  const providerConcurrency = boundedInteger(options.providerConcurrency, 2, 1, 4);
  const providerBudgetLimit = boundedInteger(options.providerBudgetLimit, 30, 1, 10_000);
  const providerBudgetWindowMs = boundedInteger(
    options.providerBudgetWindowMs,
    10 * 60 * 1000,
    1_000,
    24 * 60 * 60 * 1000,
  );
  const providerBudgetNow = options.providerBudgetNow || Date.now;
  const cacheLimits = {
    maxBytes: boundedInteger(options.cacheMaxBytes, DEFAULT_CACHE_MAX_BYTES, MAX_CACHE_ENTRY_BYTES, 4 * 1024 * 1024 * 1024),
    maxEntries: boundedInteger(options.cacheMaxEntries, DEFAULT_CACHE_MAX_ENTRIES, 1, 512),
  };
  const pending = new Map();
  let activeProviderOperations = 0;
  let providerStarts = [];
  let cacheMutation = Promise.resolve();
  let cacheReady;
  let cacheHealthy = false;

  function mutateCache(operation) {
    const result = cacheMutation.then(operation, operation);
    cacheMutation = result.catch(() => {});
    return result;
  }

  function ensureCacheReady() {
    if (!cacheReady) {
      cacheReady = mutateCache(async () => {
        await verifyCacheWritable(cacheDir);
        await pruneCache(cacheDir, cacheLimits);
        cacheHealthy = true;
      }).catch((error) => {
        cacheHealthy = false;
        if (error?.code === 'BRIA_CACHE_UNAVAILABLE' || error?.code === 'BRIA_CACHE_FULL') throw error;
        throw requestError('BRIA cache is unavailable', 503, 'BRIA_CACHE_UNAVAILABLE');
      });
    }
    return cacheReady;
  }

  async function fetchSubjectLayer(source, cacheKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetchImpl(BRIA_RMBG_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          api_token: apiToken,
        },
        body: JSON.stringify(buildBriaRequest(source)),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel?.().catch(() => {});
        throw mapUpstreamFailure(upstream.status);
      }
      const metadataBytes = await readBoundedBytes(upstream, MAX_METADATA_BYTES, 'BRIA_INVALID_RESPONSE');
      let metadata;
      try {
        metadata = JSON.parse(metadataBytes.toString('utf8'));
      } catch {
        throw requestError('BRIA returned invalid metadata', 502, 'BRIA_INVALID_RESPONSE');
      }
      const resultUrl = validateResultUrl(metadata?.result?.image_url);

      const resultResponse = await fetchImpl(resultUrl, {
        redirect: 'error',
        signal: controller.signal,
        headers: { Accept: 'image/png' },
      });
      if (!resultResponse.ok) {
        await resultResponse.body?.cancel?.().catch(() => {});
        throw requestError('BRIA result could not be downloaded', 502, 'BRIA_RESULT_UNAVAILABLE');
      }
      const mimeType = normalizedMimeType(resultResponse.headers.get('content-type')?.split(';')[0]);
      const bytes = await readBoundedBytes(resultResponse, MAX_OUTPUT_BYTES, 'BRIA_INVALID_IMAGE');
      const output = decodeOutput(bytes.toString('base64'), mimeType);
      const cachePath = path.join(cacheDir, `${cacheKey}.json`);
      const serializedCache = JSON.stringify({
        schema: 1,
        version,
        mimeType: output.mimeType,
        data: output.data,
      });
      const cacheSize = Buffer.byteLength(serializedCache);
      if (cacheSize > MAX_CACHE_ENTRY_BYTES) {
        throw requestError('BRIA cache entry is too large', 502, 'BRIA_INVALID_IMAGE');
      }
      let cacheStatus = 'miss';
      try {
        await mutateCache(async () => {
          await pruneCache(cacheDir, cacheLimits, { filePath: cachePath, size: cacheSize });
          await writeCache(cachePath, serializedCache);
        });
      } catch (error) {
        // The paid, validated cutout is still useful. Return it once, mark the
        // service unhealthy, and make the next request fail its local preflight.
        cacheHealthy = false;
        cacheReady = undefined;
        cacheStatus = 'bypass';
        try { options.onCacheError?.(error); } catch { /* logging must not drop paid output */ }
      }
      return {
        provider: BRIA_RMBG_VERSION,
        cache: cacheStatus,
        cacheKey,
        mimeType: output.mimeType,
        data: output.data,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw requestError('BRIA request timed out', 504, 'BRIA_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function removeBackground(input) {
    if (!apiToken) throw requestError('BRIA is not configured', 503, 'BRIA_DISABLED');
    const source = decodeInput(input);
    await ensureCacheReady();
    const cacheKey = subjectLayerCacheKey(source.bytes, version);
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);
    const cached = await readCache(cachePath, version);
    if (cached) {
      return {
        provider: BRIA_RMBG_VERSION,
        cache: 'hit',
        cacheKey,
        mimeType: cached.mimeType,
        data: cached.data,
      };
    }
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    const now = providerBudgetNow();
    providerStarts = providerStarts
      .filter((startedAt) => now - startedAt < providerBudgetWindowMs);
    if (providerStarts.length >= providerBudgetLimit) {
      throw requestError('BRIA provider budget is temporarily exhausted', 429, 'BRIA_BUDGET_EXHAUSTED');
    }
    if (activeProviderOperations >= providerConcurrency) {
      throw requestError('BRIA provider capacity is busy', 503, 'BRIA_BUSY');
    }
    providerStarts.push(now);
    activeProviderOperations += 1;
    const operation = fetchSubjectLayer(source, cacheKey).finally(() => {
      activeProviderOperations -= 1;
      pending.delete(cacheKey);
    });
    pending.set(cacheKey, operation);
    return operation;
  }

  return {
    removeBackground,
    ready: ensureCacheReady,
    isReady: () => cacheHealthy,
  };
}
