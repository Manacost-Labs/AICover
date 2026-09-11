const MAX_PROMPT_LENGTH = 16_000;
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 60 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 40 * 1024 * 1024;
const ALLOWED_INPUT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_OUTPUT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function validationError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function normalizedMimeType(value) {
  const mimeType = String(value || '').toLowerCase();
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function validateBase64(value, label) {
  const data = String(value || '');
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw validationError(`${label} must be a valid base64 image`);
  }
  return data;
}

export function buildOpenRouterImageRequest(body) {
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) throw validationError('Prompt is required');
  if (prompt.length > MAX_PROMPT_LENGTH) throw validationError('Prompt is too long', 413);

  const references = Array.isArray(body?.references) ? body.references : [];
  if (references.length < 1 || references.length > 4) {
    throw validationError('Use between 1 and 4 image references');
  }

  let totalBytes = 0;
  const inputReferences = references.map((reference, index) => {
    const mimeType = normalizedMimeType(reference?.mimeType);
    if (!ALLOWED_INPUT_MIME_TYPES.has(mimeType)) {
      throw validationError(`Reference ${index + 1} has an unsupported image type`, 415);
    }
    const data = validateBase64(reference?.data, `Reference ${index + 1}`);
    const bytes = Buffer.from(data, 'base64').byteLength;
    if (bytes < 1 || bytes > MAX_REFERENCE_BYTES) {
      throw validationError(`Reference ${index + 1} is too large`, 413);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
      throw validationError('Image references are too large', 413);
    }
    return {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${data}` },
    };
  });

  return {
    model: 'openai/gpt-image-2',
    prompt,
    quality: 'high',
    background: 'opaque',
    n: 1,
    input_references: inputReferences,
  };
}

export function extractOpenRouterImage(payload) {
  const image = payload?.data?.[0];
  const data = validateBase64(image?.b64_json, 'Generated image');
  const mimeType = normalizedMimeType(image?.media_type || 'image/png');
  if (!ALLOWED_OUTPUT_MIME_TYPES.has(mimeType)) {
    throw validationError('Image provider returned an unsupported format', 502);
  }
  if (Buffer.from(data, 'base64').byteLength > MAX_OUTPUT_BYTES) {
    throw validationError('Generated image is too large', 502);
  }
  return `data:${mimeType};base64,${data}`;
}
