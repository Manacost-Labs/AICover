import type { ImageSource } from './geminiService';

export interface SubjectLayer {
  provider: 'rmbg-2.0';
  cache: 'hit' | 'miss' | 'bypass';
  cacheKey: string;
  image: ImageSource;
  sourceIndex?: number;
}

export class SubjectLayerError extends Error {
  readonly code?: string;

  constructor(message = 'Не удалось подготовить персонажа для точной композиции.', code?: string) {
    super(message);
    this.name = 'SubjectLayerError';
    this.code = code;
  }
}

const CACHE_KEY = /^[a-f0-9]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Подготовка изображения отменена.', 'AbortError');
}

function userMessage(status: number, code?: string) {
  if (code === 'BRIA_SOURCE_TOO_LARGE' || status === 413) return 'Каждое исходное изображение для точной композиции должно быть не больше 10 МиБ.';
  if (code === 'BRIA_SOURCE_REJECTED' || status === 422) return 'Сервис не смог выделить персонажа на одном из изображений.';
  if (code === 'BRIA_BUDGET_EXHAUSTED') return 'Общий лимит обработки изображений временно исчерпан. Попробуйте позже.';
  if (code === 'BRIA_RATE_LIMITED' || status === 429) return 'Слишком много запросов на подготовку изображений. Попробуйте немного позже.';
  if (code === 'BRIA_BUSY') return 'Сервис уже обрабатывает другие изображения. Попробуйте немного позже.';
  if (code === 'BRIA_TIMEOUT' || status === 504) return 'Сервис подготовки изображения не ответил вовремя.';
  if (code === 'BRIA_DISABLED') return 'Точное выделение персонажей пока не настроено на сервере.';
  if (code === 'BRIA_AUTH') return 'Серверное подключение к обработке изображений требует проверки.';
  if (status === 503) return 'Сервис подготовки изображений временно недоступен.';
  return 'Не удалось подготовить персонажа для точной композиции.';
}

function safeCode(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const code = (payload as Record<string, unknown>).code;
  return typeof code === 'string' && /^BRIA_[A-Z0-9_]{2,48}$/.test(code) ? code : undefined;
}

function validImageData(data: string, mimeType: string) {
  if (!data || data.length % 4 !== 0 || !BASE64.test(data)) return false;
  if (mimeType === 'image/png') return data.startsWith('iVBORw0KGgo');
  return false;
}

export async function removeBackground(source: ImageSource, signal?: AbortSignal): Promise<SubjectLayer> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetch('/api/image/remove-background', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
    });
  } catch (cause) {
    throwIfAborted(signal);
    throw new SubjectLayerError(cause instanceof SubjectLayerError ? cause.message : undefined);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const code = safeCode(payload);
    throw new SubjectLayerError(userMessage(response.status, code), code);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SubjectLayerError();
  }
  const result = payload as Record<string, unknown>;
  const provider = result.provider;
  const cache = result.cache;
  const cacheKey = result.cacheKey;
  const mimeType = result.mimeType;
  const data = result.data;
  if (
    provider !== 'rmbg-2.0'
    || (cache !== 'hit' && cache !== 'miss' && cache !== 'bypass')
    || typeof cacheKey !== 'string'
    || !CACHE_KEY.test(cacheKey)
    || mimeType !== 'image/png'
    || typeof data !== 'string'
    || !validImageData(data, mimeType)
  ) {
    throw new SubjectLayerError();
  }
  return {
    provider,
    cache,
    cacheKey,
    image: { mimeType, data },
  };
}

export async function prepareSubjectLayers(
  sources: ImageSource[],
  signal?: AbortSignal,
  options: { concurrency?: number } = {},
): Promise<Array<SubjectLayer & { sourceIndex: number }>> {
  throwIfAborted(signal);
  const results = new Array<SubjectLayer & { sourceIndex: number }>(sources.length);
  const concurrency = Math.max(1, Math.min(sources.length || 1, Math.floor(options.concurrency ?? 2)));
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onOuterAbort();
  else signal?.addEventListener('abort', onOuterAbort, { once: true });
  const runSignal = controller.signal;
  let cursor = 0;
  let terminalFailure: unknown;

  const worker = async () => {
    while (cursor < sources.length) {
      if (terminalFailure) return;
      throwIfAborted(runSignal);
      const sourceIndex = cursor;
      cursor += 1;
      try {
        const layer = await removeBackground(sources[sourceIndex], runSignal);
        if (terminalFailure) return;
        results[sourceIndex] = { ...layer, sourceIndex };
      } catch (error) {
        if (!terminalFailure) {
          terminalFailure = error;
          controller.abort(error);
        }
        throw terminalFailure;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return results;
  } finally {
    signal?.removeEventListener('abort', onOuterAbort);
  }
}
