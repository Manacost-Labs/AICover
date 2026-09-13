export const OPENROUTER_IMAGE_MODEL = 'openai/gpt-image-2';

// Mirrored display/UX capabilities from the server allowlist. The server is
// authoritative and validates every request again at the trust boundary.
export const OPENROUTER_IMAGE_MODELS = [
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    providerName: 'OpenAI · OpenRouter',
    description: 'Высокая точность редактирования и сохранения деталей',
    maxReferences: 16,
    coverCompatible: true,
    referenceStrategy: 'individual',
    maxReferenceBytes: 24 * 1024 * 1024,
    resolutions: [],
    aspectRatios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'],
  },
  {
    id: 'meta/muse-image',
    name: 'Muse Image',
    providerName: 'Meta · OpenRouter',
    description: 'Агентная генерация Meta; доступ зависит от endpoint OpenRouter',
    maxReferences: 1,
    // OpenRouter currently publishes no usable endpoint for Muse. Keep the
    // catalog entry visible, but fail closed until its endpoint contract has
    // been reviewed and this explicit hold is removed on both client/server.
    coverCompatible: false,
    referenceStrategy: 'contact-sheet',
    maxReferenceBytes: 10 * 1024 * 1024,
    resolutions: [],
    aspectRatios: [],
  },
  {
    id: 'recraft/recraft-v4-styles-pro',
    name: 'Recraft V4 Styles Pro',
    providerName: 'Recraft · OpenRouter',
    description: 'Перенос визуального стиля с референсов',
    maxReferences: 10,
    coverCompatible: true,
    referenceStrategy: 'individual',
    maxReferenceBytes: 24 * 1024 * 1024,
    resolutions: [],
    aspectRatios: ['1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16'],
  },
  {
    id: 'bytedance-seed/seedream-5-0-lite',
    name: 'Seedream 5.0 Lite',
    providerName: 'ByteDance · OpenRouter',
    description: 'Быстрая генерация с большим числом референсов',
    maxReferences: 14,
    coverCompatible: true,
    referenceStrategy: 'individual',
    maxReferenceBytes: 24 * 1024 * 1024,
    resolutions: ['2K', '4K'],
    aspectRatios: ['1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  },
  {
    id: 'bytedance-seed/seedream-5-0-pro',
    name: 'Seedream 5.0 Pro',
    providerName: 'ByteDance · OpenRouter',
    description: 'Точная коммерческая генерация и редактирование',
    maxReferences: 14,
    coverCompatible: true,
    referenceStrategy: 'individual',
    maxReferenceBytes: 24 * 1024 * 1024,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  },
  {
    id: 'x-ai/grok-imagine-image-2.0',
    name: 'Grok Imagine Image 2.0',
    providerName: 'xAI · OpenRouter',
    description: 'Быстрая генерация и редактирование до трёх референсов',
    maxReferences: 3,
    coverCompatible: true,
    referenceStrategy: 'individual',
    maxReferenceBytes: 24 * 1024 * 1024,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '1:2', '2:1'],
  },
  {
    id: 'qwen/qwen-image-3-pro',
    name: 'Qwen Image 3 Pro',
    providerName: 'Qwen · OpenRouter',
    description: 'Точная работа с текстом и мелкими деталями',
    maxReferences: 4,
    coverCompatible: true,
    referenceStrategy: 'individual',
    maxReferenceBytes: 24 * 1024 * 1024,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '1:2', '1:4', '2:1', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '9:16', '16:9'],
  },
  {
    id: 'krea/krea-2-large',
    name: 'Krea 2 Large',
    providerName: 'Krea · OpenRouter',
    description: 'Текстурная генерация с единым листом референсов',
    maxReferences: 1,
    coverCompatible: true,
    referenceStrategy: 'contact-sheet',
    maxReferenceBytes: 10 * 1024 * 1024,
    resolutions: ['1K'],
    aspectRatios: ['1:1', '4:3', '3:2', '16:9', '4:5', '2:3', '9:16'],
  },
  {
    id: 'sourceful/riverflow-v2.5-pro',
    name: 'Riverflow 2.5 Pro',
    providerName: 'Sourceful · OpenRouter',
    description: 'Максимальный контроль, PNG и разрешение до 4K',
    maxReferences: 10,
    coverCompatible: true,
    referenceStrategy: 'contact-sheet',
    maxReferenceBytes: 3 * 1024 * 1024,
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'],
  },
  {
    id: 'sourceful/riverflow-v2.5-fast',
    name: 'Riverflow 2.5 Fast',
    providerName: 'Sourceful · OpenRouter',
    description: 'Быстрый production-вариант с JPEG-выводом',
    maxReferences: 4,
    coverCompatible: true,
    referenceStrategy: 'contact-sheet',
    maxReferenceBytes: 3 * 1024 * 1024,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'],
  },
] as const;

export type OpenRouterImageModelId = typeof OPENROUTER_IMAGE_MODELS[number]['id'];
export type OpenRouterModelAvailability = 'available' | 'unavailable' | 'unknown';
export type OpenRouterModelAvailabilityMap = Partial<Record<OpenRouterImageModelId, OpenRouterModelAvailability>>;
type CoverImageSize = '512px' | '1K' | '2K' | '4K';
type CoverAspectRatio = '1:1' | '1:4' | '1:8' | '2:3' | '3:2' | '3:4' | '4:1' | '4:3' | '4:5' | '5:4' | '8:1' | '9:16' | '16:9' | '21:9';

export function getOpenRouterModel(id: string) {
  return OPENROUTER_IMAGE_MODELS.find(model => model.id === id);
}

export function isOpenRouterImageModel(id: string): id is OpenRouterImageModelId {
  return getOpenRouterModel(id) != null;
}

export function normalizeOpenRouterSettings(
  modelId: string,
  imageSize: CoverImageSize,
  aspectRatio: CoverAspectRatio,
): { imageSize: CoverImageSize; aspectRatio: CoverAspectRatio } {
  const model = getOpenRouterModel(modelId);
  if (!model) return { imageSize, aspectRatio };
  const resolutions = model.resolutions as readonly CoverImageSize[];
  const ratios = model.aspectRatios as readonly CoverAspectRatio[];
  return {
    imageSize: resolutions.length === 0 || resolutions.includes(imageSize)
      ? imageSize
      : resolutions.includes('2K') ? '2K' : resolutions[0],
    aspectRatio: ratios.length === 0 || ratios.includes(aspectRatio)
      ? aspectRatio
      : ratios.includes('16:9') ? '16:9' : ratios[0],
  };
}

export interface OpenRouterImageReference {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
}

export interface OpenRouterImageRequest {
  model: OpenRouterImageModelId;
  prompt: string;
  references: OpenRouterImageReference[];
  aspectRatio?: CoverAspectRatio;
  resolution?: Exclude<CoverImageSize, '512px'>;
}

interface PollOptions {
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onResult?: (imageUrl: string) => void | Promise<void>;
}

export class OpenRouterImageError extends Error {
  readonly code?: string;
  constructor(message = 'Выбранная модель OpenRouter не смогла создать изображение.', code?: string) {
    super(message);
    this.name = 'OpenRouterImageError';
    this.code = code;
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Генерация отменена.', 'AbortError');
}

function userMessageForFailure(status: number, code?: string) {
  if (code === 'MODEL_UNAVAILABLE') return 'У этой модели сейчас нет активного endpoint OpenRouter. Выберите другую модель.';
  if (code === 'OPENROUTER_CREDITS') return 'На балансе OpenRouter недостаточно средств. Пополните баланс или выберите другую модель.';
  if (code === 'OPENROUTER_AUTH') return 'Серверный ключ OpenRouter отклонён. Сообщите администратору сервиса.';
  if (code === 'REFERENCE_PAYLOAD_TOO_LARGE') return 'Референсы превышают лимит провайдера. Cover уже сжал их; уберите один источник или загрузите файл меньшего размера.';
  if (code === 'UNSUPPORTED_PARAMETERS') return 'Модель не принимает выбранные параметры. Проверьте формат и разрешение.';
  if (code === 'RATE_LIMITED') return 'OpenRouter ограничил частоту запросов. Попробуйте через несколько минут.';
  if (code === 'PROVIDER_RETRY_EXHAUSTED') return 'Провайдер модели не ответил после автоматической повторной попытки. Повторите позже или выберите другую модель.';
  if (code === 'PROVIDER_UNAVAILABLE') return 'Провайдер выбранной модели временно недоступен. Выберите другую модель или повторите позже.';
  if (code === 'PROVIDER_TIMEOUT') return 'OpenRouter не ответил вовремя. Запрос не повторялся автоматически.';
  if (status === 413) return 'Исходные изображения слишком большие для OpenRouter.';
  if (status === 422) return 'Выбранные параметры не поддерживаются этой моделью OpenRouter.';
  if (status === 429) return 'Слишком много генераций. Попробуйте через несколько минут.';
  if (status === 503) return 'OpenRouter временно недоступен.';
  if (status === 504) return 'OpenRouter не ответил вовремя. Запрос не повторялся автоматически.';
  return 'Выбранная модель OpenRouter не смогла создать изображение.';
}

function publicErrorCode(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const code = (payload as Record<string, unknown>).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,48}$/.test(code) ? code : undefined;
}

async function fetchJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<Record<string, unknown>> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: 'same-origin', signal });
  } catch (cause) {
    throwIfAborted(signal);
    throw new OpenRouterImageError(cause instanceof OpenRouterImageError ? cause.message : undefined);
  }
  if (!response.ok) {
    let code: string | undefined;
    try { code = publicErrorCode(await response.json()); } catch { /* stable status fallback below */ }
    throw new OpenRouterImageError(userMessageForFailure(response.status, code), code);
  }
  try {
    const payload = await response.json();
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload as Record<string, unknown>;
  } catch {
    throwIfAborted(signal);
    // Provider and proxy response details deliberately stay outside the UI contract.
  }
  throw new OpenRouterImageError();
}

function wait(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        throwIfAborted(signal);
      } catch (cause) {
        reject(cause);
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function boundedSignal(userSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onUserAbort = () => controller.abort(userSignal?.reason);
  if (userSignal?.aborted) onUserAbort();
  else userSignal?.addEventListener('abort', onUserAbort, { once: true });
  const timer = window.setTimeout(() => {
    controller.abort(new OpenRouterImageError(userMessageForFailure(504, 'PROVIDER_TIMEOUT'), 'PROVIDER_TIMEOUT'));
  }, Math.max(0, timeoutMs));
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timer);
      userSignal?.removeEventListener('abort', onUserAbort);
    },
  };
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Same-origin browser adapter. The OpenRouter credential remains server-only;
 * a generation start is never retried automatically because it can be billable.
 */
export async function generateOpenRouterImage(
  request: OpenRouterImageRequest,
  signal?: AbortSignal,
  options: PollOptions = {},
): Promise<string> {
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const maxWaitMs = options.maxWaitMs ?? 5 * 60 * 1_000;
  const deadline = Date.now() + maxWaitMs;
  const bounded = boundedSignal(signal, maxWaitMs);

  try {
    const start = await fetchJson('/api/thumbnail/openrouter-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }, bounded.signal);
    const jobId = typeof start.jobId === 'string' && JOB_ID.test(start.jobId) ? start.jobId : null;
    if (!jobId) throw new OpenRouterImageError();

    while (Date.now() <= deadline) {
      const result = await fetchJson(`/api/thumbnail/openrouter-jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
      }, bounded.signal);
      if (result.status === 'complete') {
        if (typeof result.imageUrl !== 'string' || !IMAGE_DATA_URL.test(result.imageUrl)) {
          throw new OpenRouterImageError();
        }
        // Publish/persist the paid result before acknowledgement so a later
        // batch failure or cancellation cannot make it disappear from Cover.
        await options.onResult?.(result.imageUrl);
        // If acknowledgement fails, TTL retention keeps the result recoverable.
        try {
          await fetch(`/api/thumbnail/openrouter-jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
            signal: bounded.signal,
          });
        } catch {
          // The image is already local; cleanup remains bounded by server TTL.
        }
        return result.imageUrl;
      }
      if (result.status !== 'pending') throw new OpenRouterImageError();
      if (Date.now() >= deadline) break;
      await wait(pollIntervalMs, bounded.signal);
    }
    throw new OpenRouterImageError(userMessageForFailure(504, 'PROVIDER_TIMEOUT'), 'PROVIDER_TIMEOUT');
  } finally {
    bounded.cleanup();
  }
}

export async function loadOpenRouterModelAvailability(): Promise<OpenRouterModelAvailabilityMap> {
  const response = await fetch('/api/thumbnail/openrouter-models', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return {};
  const payload = await response.json();
  const rows = Array.isArray(payload?.models) ? payload.models : [];
  const out: OpenRouterModelAvailabilityMap = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' && isOpenRouterImageModel(row.id) ? row.id : null;
    const availability = row.availability;
    if (id && (availability === 'available' || availability === 'unavailable' || availability === 'unknown')) {
      out[id] = availability;
    }
  }
  return out;
}
