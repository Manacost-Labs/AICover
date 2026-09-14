import { get, set, del } from 'idb-keyval';

export const supabase = null;
export const isSupabaseConfigured = true;
const CLIENT_MEDIA_RESET_VERSION = '2026-06-30-server-authoritative-v2';
const CLIENT_MEDIA_RESET_KEY = 'cover_client_media_reset_version';
const CLIENT_MEDIA_KEYS = [
  'fusion_history',
  'fusion_liked',
  'fusion_favorite_choice_notes',
  'fusion_reference_library',
  'fusion_video_history',
  'fusion_video_liked',
  'fusion_video_favorite_choice_notes',
];

export function formatSupabaseClientError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    try {
      return JSON.stringify(err);
    } catch {
      return 'Неизвестная ошибка';
    }
  }
  return String(err ?? 'Неизвестная ошибка');
}

export interface ReferenceLibraryEntry {
  id: string;
  name: string;
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  addedAt: number;
  visionAnalysis: string | null;
  storageAvailable?: boolean;
}

export interface CardLibraryEntry {
  id: string;
  name: string;
  cardId: string;
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  addedAt: number;
  storageAvailable?: boolean;
}

function mergeUnique(primary: string[], secondary: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...primary, ...secondary]) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    merged.push(value);
  }
  return merged;
}

function localImageFallback(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => (
    typeof item === 'string' && (item.startsWith('data:image/') || item.startsWith('blob:'))
  ));
}

async function clearClientMediaCacheOnce(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem(CLIENT_MEDIA_RESET_KEY) === CLIENT_MEDIA_RESET_VERSION) return;
  await Promise.all(CLIENT_MEDIA_KEYS.map((key) => del(key).catch(() => {})));
  for (const key of CLIENT_MEDIA_KEYS) window.localStorage.removeItem(key);
  window.localStorage.setItem(CLIENT_MEDIA_RESET_KEY, CLIENT_MEDIA_RESET_VERSION);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function base64ToBytes(base64: string, mimeType: string): Blob {
  const raw = base64.split(',')[1] || base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function urlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ base64: reader.result as string, mimeType: blob.type });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function pathFromLocalUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.pathname.startsWith('/uploads/')) return null;
    return decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
  } catch {
    return null;
  }
}

async function normalizeMediaInput(input: string, fallbackMimeType: string): Promise<{ dataUrl: string; mimeType: string }> {
  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;]+);base64,/);
    return { dataUrl: input, mimeType: match?.[1] || fallbackMimeType };
  }
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('/')) {
    const converted = await urlToBase64(input);
    return { dataUrl: converted.base64, mimeType: converted.mimeType || fallbackMimeType };
  }
  throw new Error('Expected data URL or media URL');
}

export async function fetchUrlAsImageSource(url: string): Promise<{ data: string; mimeType: string }> {
  const { base64, mimeType } = await urlToBase64(url);
  return { data: base64, mimeType };
}

export async function imageUrlToImageSource(url: string): Promise<{ data: string; mimeType: string }> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:(image\/[^;]+);base64,/);
    return { data: url, mimeType: match ? match[1] : 'image/png' };
  }
  return fetchUrlAsImageSource(url);
}

export async function loadCardLibrary(): Promise<CardLibraryEntry[]> {
  return api<CardLibraryEntry[]>('/api/card-library').catch((error) => {
    console.error('loadCardLibrary', error);
    return [];
  });
}

export async function saveCardToLibrary(
  name: string,
  cardId: string,
  imageData: string,
  mimeType: string
): Promise<CardLibraryEntry> {
  return api<CardLibraryEntry>('/api/card-library', {
    method: 'POST',
    body: JSON.stringify({ name, cardId, imageData, mimeType }),
  });
}

export async function deleteCardFromLibrary(id: string, _storagePath?: string): Promise<void> {
  await api('/api/card-library/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function loadReferenceLibrary(): Promise<ReferenceLibraryEntry[]> {
  return api<ReferenceLibraryEntry[]>('/api/reference-library').catch((error) => {
    console.error('loadReferenceLibrary', error);
    return [];
  });
}

export async function saveReferenceToLibrary(
  name: string,
  imageData: string,
  mimeType: string
): Promise<ReferenceLibraryEntry> {
  return api<ReferenceLibraryEntry>('/api/reference-library', {
    method: 'POST',
    body: JSON.stringify({ name, imageData, mimeType }),
  });
}

export async function updateReferenceVisionAnalysis(id: string, visionAnalysis: string): Promise<void> {
  await api('/api/reference-library/' + encodeURIComponent(id) + '/vision-analysis', {
    method: 'PATCH',
    body: JSON.stringify({ visionAnalysis }),
  });
}

export async function deleteReferenceFromLibrary(id: string, _storagePath?: string): Promise<void> {
  await api('/api/reference-library/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function loadHistory(): Promise<string[]> {
  try {
    return (await api<string[]>('/api/history')).slice(0, 50);
  } catch (error) {
    console.error('loadHistory', error);
    return localImageFallback(await get('fusion_history').catch(() => undefined)).slice(0, 50);
  }
}

export async function saveToHistory(imageInput: string, mimeType = 'image/png'): Promise<void> {
  const { dataUrl, mimeType: mt } = await normalizeMediaInput(imageInput, mimeType);
  try {
    await api('/api/history', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, mimeType: mt }),
    });
  } catch (error) {
    console.error('saveToHistory', error);
    const existing: string[] = (await get('fusion_history').catch(() => undefined)) || [];
    await set('fusion_history', mergeUnique([dataUrl], existing).slice(0, 50)).catch(() => {});
  }
}

export async function clearHistory(): Promise<void> {
  await del('fusion_history').catch(() => {});
  await api('/api/history', { method: 'DELETE' }).catch((error) => console.error('clearHistory', error));
}

export async function loadFavorites(): Promise<string[]> {
  try {
    return await api<string[]>('/api/favorites');
  } catch (error) {
    console.error('loadFavorites', error);
    return localImageFallback(await get('fusion_liked').catch(() => undefined));
  }
}

export async function addToFavorites(url: string): Promise<{ id: string } | null> {
  try {
    const { dataUrl, mimeType } = await normalizeMediaInput(url, 'image/png');
    return await api<{ id: string }>('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, mimeType }),
    });
  } catch (error) {
    console.error('addToFavorites', error);
    const existing: string[] = (await get('fusion_liked').catch(() => undefined)) || [];
    await set('fusion_liked', mergeUnique([url], existing)).catch(() => {});
    return null;
  }
}

export async function updateFavoriteChoiceAnalysis(id: string, choiceAnalysis: string): Promise<void> {
  await api('/api/favorites/' + encodeURIComponent(id) + '/choice-analysis', {
    method: 'PATCH',
    body: JSON.stringify({ choiceAnalysis }),
  }).catch((error) => console.error('updateFavoriteChoiceAnalysis', error));
}

export async function loadFavoriteChoiceNotesMap(): Promise<Record<string, string>> {
  return api<Record<string, string>>('/api/favorites/choice-notes').catch(() => ({}));
}

export async function removeFromFavorites(url: string): Promise<void> {
  const existing: string[] = (await get('fusion_liked').catch(() => undefined)) || [];
  await set('fusion_liked', existing.filter((item) => item !== url)).catch(() => {});
  const path = pathFromLocalUrl(url);
  if (!path) return;
  await api('/api/favorites?path=' + encodeURIComponent(path), { method: 'DELETE' }).catch((error) =>
    console.error('removeFromFavorites', error)
  );
}

export async function migrateFromIDB(): Promise<void> {
  await clearClientMediaCacheOnce();
}
