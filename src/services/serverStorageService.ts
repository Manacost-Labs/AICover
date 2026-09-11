import { del, get, set } from 'idb-keyval';

export interface ReferenceLibraryEntry {
  id: string;
  name: string;
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  addedAt: number;
  visionAnalysis: string | null;
}

export interface CardLibraryEntry {
  id: string;
  name: string;
  cardId: string;
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  addedAt: number;
}

interface StoredMedia {
  id: string;
  storageUrl: string;
  storagePath: string;
}

const favoriteIds = new Map<string, string>();
const videoFavoriteIds = new Map<string, string>();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Серверное хранилище недоступно: HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function urlToDataUrl(url: string): Promise<{ dataUrl: string; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить файл: HTTP ${response.status}`);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { dataUrl, mimeType: blob.type };
}

async function uploadInput(input: string, fallbackMimeType: string): Promise<{ dataUrl: string; mimeType: string }> {
  if (input.startsWith('data:')) {
    const match = input.match(/^data:([^;]+);base64,/);
    return { dataUrl: input, mimeType: match?.[1] || fallbackMimeType };
  }
  if (input.startsWith('/') || input.startsWith('http://') || input.startsWith('https://')) return urlToDataUrl(input);
  throw new Error('Ожидался data URL или URL файла');
}

function storagePathFromUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url, window.location.origin);
    const marker = '/uploads/';
    const offset = pathname.indexOf(marker);
    return offset === -1 ? null : pathname.slice(offset + marker.length);
  } catch {
    return null;
  }
}

async function loadMedia(kind: string, localKey: string): Promise<string[]> {
  try {
    return await request<string[]>(`/api/${kind}`);
  } catch (error) {
    console.warn(`load ${kind} from server failed`, error);
    return (await get<string[]>(localKey)) || [];
  }
}

async function saveMedia(kind: string, localKey: string, input: string, fallbackMimeType: string): Promise<StoredMedia | null> {
  let upload: { dataUrl: string; mimeType: string };
  try {
    upload = await uploadInput(input, fallbackMimeType);
  } catch (error) {
    console.warn(`prepare ${kind} upload failed`, error);
    return null;
  }

  try {
    const existing = (await get<string[]>(localKey)) || [];
    await set(localKey, [upload.dataUrl, ...existing].slice(0, 50));
  } catch {
    // Server persistence remains the source of truth.
  }

  try {
    return await request<StoredMedia>(`/api/${kind}`, {
      method: 'POST',
      body: JSON.stringify(upload),
    });
  } catch (error) {
    console.warn(`save ${kind} to server failed`, error);
    return null;
  }
}

async function clearMedia(kind: string, localKey: string): Promise<void> {
  try {
    await del(localKey);
  } catch {
    // Clearing the server record is still attempted below.
  }
  await request<{ ok: true }>(`/api/${kind}`, { method: 'DELETE' });
}

export function formatStorageError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Не удалось сохранить данные в хранилище сервиса.';
}

export async function loadCardLibrary(): Promise<CardLibraryEntry[]> {
  return request<CardLibraryEntry[]>('/api/card-library');
}

export async function saveCardToLibrary(name: string, cardId: string, imageData: string, mimeType: string): Promise<CardLibraryEntry> {
  return request<CardLibraryEntry>('/api/card-library', {
    method: 'POST',
    body: JSON.stringify({ name, cardId, imageData, mimeType }),
  });
}

export async function deleteCardFromLibrary(id: string, _storagePath: string): Promise<void> {
  await request<{ ok: true }>(`/api/card-library/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function loadReferenceLibrary(): Promise<ReferenceLibraryEntry[]> {
  return request<ReferenceLibraryEntry[]>('/api/reference-library');
}

export async function saveReferenceToLibrary(name: string, imageData: string, mimeType: string): Promise<ReferenceLibraryEntry> {
  return request<ReferenceLibraryEntry>('/api/reference-library', {
    method: 'POST',
    body: JSON.stringify({ name, imageData, mimeType }),
  });
}

export async function updateReferenceVisionAnalysis(id: string, visionAnalysis: string): Promise<void> {
  await request<{ ok: true }>(`/api/reference-library/${encodeURIComponent(id)}/vision-analysis`, {
    method: 'PATCH',
    body: JSON.stringify({ visionAnalysis }),
  });
}

export async function fetchUrlAsImageSource(url: string): Promise<{ data: string; mimeType: string }> {
  const { dataUrl, mimeType } = await urlToDataUrl(url);
  return { data: dataUrl, mimeType };
}

export async function imageUrlToImageSource(url: string): Promise<{ data: string; mimeType: string }> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:(image\/[^;]+);base64,/);
    return { data: url, mimeType: match?.[1] || 'image/png' };
  }
  return fetchUrlAsImageSource(url);
}

export async function deleteReferenceFromLibrary(id: string, _storagePath: string): Promise<void> {
  await request<{ ok: true }>(`/api/reference-library/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function loadHistory(): Promise<string[]> {
  return loadMedia('history', 'fusion_history');
}

export function saveToHistory(input: string, mimeType = 'image/png'): Promise<StoredMedia | null> {
  return saveMedia('history', 'fusion_history', input, mimeType);
}

export function clearHistory(): Promise<void> {
  return clearMedia('history', 'fusion_history');
}

export function loadFavorites(): Promise<string[]> {
  return loadMedia('favorites', 'fusion_liked');
}

export async function addToFavorites(input: string): Promise<StoredMedia | null> {
  const stored = await saveMedia('favorites', 'fusion_liked', input, 'image/png');
  if (stored) favoriteIds.set(input, stored.id);
  return stored;
}

export async function updateFavoriteChoiceAnalysis(id: string, choiceAnalysis: string): Promise<void> {
  await request<{ ok: true }>(`/api/favorites/${encodeURIComponent(id)}/choice-analysis`, {
    method: 'PATCH',
    body: JSON.stringify({ choiceAnalysis }),
  });
}

export function loadFavoriteChoiceNotesMap(): Promise<Record<string, string>> {
  return request<Record<string, string>>('/api/favorites/choice-notes');
}

export async function removeFromFavorites(url: string): Promise<void> {
  const id = favoriteIds.get(url);
  const params = new URLSearchParams(id ? { id } : {});
  if (!id) {
    const path = storagePathFromUrl(url);
    if (!path) return;
    params.set('path', path);
  }
  await request<{ ok: true }>(`/api/favorites?${params.toString()}`, { method: 'DELETE' });
  favoriteIds.delete(url);
}

export function loadVideoHistory(): Promise<string[]> {
  return loadMedia('video-history', 'fusion_video_history');
}

export function saveVideoToHistory(input: string, mimeType = 'video/mp4'): Promise<StoredMedia | null> {
  return saveMedia('video-history', 'fusion_video_history', input, mimeType);
}

export function clearVideoHistory(): Promise<void> {
  return clearMedia('video-history', 'fusion_video_history');
}

export function loadVideoFavorites(): Promise<string[]> {
  return loadMedia('video-favorites', 'fusion_video_liked');
}

export async function addVideoToFavorites(input: string): Promise<StoredMedia | null> {
  const stored = await saveMedia('video-favorites', 'fusion_video_liked', input, 'video/mp4');
  if (stored) videoFavoriteIds.set(input, stored.id);
  return stored;
}

export async function updateVideoFavoriteChoiceAnalysis(id: string, choiceAnalysis: string): Promise<void> {
  await request<{ ok: true }>(`/api/video-favorites/${encodeURIComponent(id)}/choice-analysis`, {
    method: 'PATCH',
    body: JSON.stringify({ choiceAnalysis }),
  });
}

export function loadVideoFavoriteChoiceNotesMap(): Promise<Record<string, string>> {
  return request<Record<string, string>>('/api/video-favorites/choice-notes');
}

export async function removeVideoFromFavorites(url: string): Promise<void> {
  const id = videoFavoriteIds.get(url);
  const params = new URLSearchParams(id ? { id } : {});
  if (!id) {
    const path = storagePathFromUrl(url);
    if (!path) return;
    params.set('path', path);
  }
  await request<{ ok: true }>(`/api/video-favorites?${params.toString()}`, { method: 'DELETE' });
  videoFavoriteIds.delete(url);
}
