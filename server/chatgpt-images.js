const MIB = 1024 * 1024;
export const PUBLIC_ERROR = Symbol('cover-public-error');
const fail = (message, status = 400, code = 'INVALID_IMAGE_REQUEST') => Object.assign(new Error(message), { status, code, [PUBLIC_ERROR]: true });

export function imageError(status) {
  if (status === 401) return fail('Подключите ChatGPT заново.', 401, 'CHATGPT_RECONNECT');
  if (status === 403) return fail('Генерация изображений недоступна для этого аккаунта ChatGPT.', 403, 'CHATGPT_ACCESS_DENIED');
  if (status === 429) return fail('Достигнут лимит ChatGPT. Попробуйте позже.', 429, 'CHATGPT_LIMIT');
  return fail('ChatGPT не смог обработать запрос. Попробуйте позже.', 502, 'CHATGPT_UPSTREAM');
}

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decodeImage(data, maxBytes) {
  if (typeof data !== 'string' || !data.length || data.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw fail('Некорректное или слишком большое изображение.');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64').replace(/=+$/, '') !== data.replace(/=+$/, '') || !imageMime(bytes)) {
    throw fail('Некорректное изображение. Используйте PNG, JPG или WEBP.');
  }
  return bytes;
}

export function buildImageRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Некорректный запрос.');
  if (input.model !== undefined && input.model !== 'gpt-image-2') throw fail('Эта модель изображений пока не поддерживается.');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 24000) throw fail('Промпт должен содержать от 1 до 24000 символов.');
  const references = input.references ?? [];
  if (!Array.isArray(references) || references.length > 5) throw fail('Можно передать не более 5 исходных изображений.');
  let total = 0;
  const files = references.map(reference => {
    const bytes = decodeImage(reference?.data, 10 * MIB);
    const mime = imageMime(bytes);
    if (mime !== reference.mimeType) throw fail('Тип файла не соответствует изображению.');
    total += bytes.length;
    if (total > 24 * MIB) throw fail('Общий размер исходников не должен превышать 24 МБ.', 413);
    return new Blob([bytes], { type: mime });
  });
  const fields = { model: 'gpt-image-2', prompt: input.prompt.trim(), n: 1, size: 'auto', quality: 'auto', background: 'opaque' };
  if (!files.length) return { path: '/images/generations', body: JSON.stringify(fields), headers: { 'content-type': 'application/json' } };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  files.forEach((file, index) => form.append('image[]', file, `reference-${index}.${file.type.split('/')[1]}`));
  return { path: '/images/edits', body: form };
}

export async function readBoundedJson(response, maxBytes = 24 * MIB) {
  if (!response.ok) {
    await response.body?.cancel();
    throw imageError(response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw imageError(502);
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw imageError(502);
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    await reader.cancel().catch(() => {});
    throw imageError(502);
  } finally { reader.releaseLock(); }
}

export async function readImageResponse(response) {
  const payload = await readBoundedJson(response);
  const item = payload?.data?.[0];
  try {
    const bytes = decodeImage(item?.b64_json, 16 * MIB);
    return `data:${imageMime(bytes)};base64,${bytes.toString('base64')}`;
  } catch {
    throw fail('ChatGPT не вернул корректное изображение.', 502, 'CHATGPT_INVALID_IMAGE');
  }
}

// Raw Codex catalog only. The SDK's compatibility /models route fabricates an
// image-2 entry; neither a catalog entry nor its name proves generation access.
export function discoverImageModels(payload) {
  if (!Array.isArray(payload?.models)) throw imageError(502);
  return [...new Set(payload.models.map(model => model?.slug).filter(id => typeof id === 'string' && /^gpt-image-[a-z0-9.-]{1,80}$/.test(id)))].slice(0, 50)
    .map(id => ({ id, supported: id === 'gpt-image-2', verified: false }));
}
