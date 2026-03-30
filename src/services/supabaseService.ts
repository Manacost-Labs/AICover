import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { get, set, del } from 'idb-keyval';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Strip wrapping quotes often pasted by mistake from dashboards / docs. */
function stripEnvQuotes(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/** JWT must be one line; line breaks inside the key break "Compact JWS" parsing. */
function normalizeAnonKey(raw: string): string {
  return stripEnvQuotes(raw).replace(/\s+/g, '');
}

/** Legacy anon key is a JWT (three dot-separated segments). New keys use `sb_publishable_...`. */
function isValidSupabaseClientKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  const parts = key.split('.');
  return parts.length === 3 && parts.every(p => p.length > 0);
}

/** Never throw at module load — invalid env would otherwise blank-screen the whole app. */
function createSupabaseSafe(): SupabaseClient | null {
  const urlRaw = supabaseUrl?.trim();
  const keyRaw = supabaseKey?.trim();
  if (!urlRaw || !keyRaw || urlRaw === 'undefined' || keyRaw === 'undefined') return null;

  const url = stripEnvQuotes(urlRaw);
  const key = normalizeAnonKey(keyRaw);
  if (!isValidSupabaseClientKey(key)) {
    console.error(
      'VITE_SUPABASE_ANON_KEY: use Publishable key (sb_publishable_…) or legacy anon JWT from Supabase → Project Settings → API.'
    );
    return null;
  }
  try {
    new URL(url);
    return createClient(url, key);
  } catch (e) {
    console.error('Supabase init failed (check VITE_SUPABASE_URL / ANON_KEY):', e);
    return null;
  }
}

export const supabase = createSupabaseSafe();

export const isSupabaseConfigured = !!supabase;

/** User-facing text for PostgREST / auth errors (e.g. Invalid Compact JWS). */
export function formatSupabaseClientError(err: unknown): string {
  let raw: string;
  if (err instanceof Error) {
    raw = err.message;
  } else if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.length > 0) {
      raw = o.message;
      if (typeof o.details === 'string' && o.details.trim()) raw += ` — ${o.details.trim()}`;
      else if (typeof o.hint === 'string' && o.hint.trim()) raw += ` — ${o.hint.trim()}`;
      if (typeof o.code === 'string' && o.code) raw += ` [${o.code}]`;
    } else {
      try {
        raw = JSON.stringify(err);
      } catch {
        raw = 'Неизвестная ошибка';
      }
    }
  } else {
    raw = String(err ?? '');
  }
  if (/invalid compact jws|jwt|jws/i.test(raw)) {
    return 'Ключ anon public повреждён или обрезан: откройте Supabase → Project Settings → API, скопируйте ключ полностью (одна строка, начинается с eyJ…), в Vercel вставьте без кавычек и переносов строк, затем Redeploy.';
  }
  if (/row-level security|rls/i.test(raw)) {
    return 'Доступ к таблице заблокирован RLS: в Supabase → SQL Editor выполните скрипт supabase/rls-anon-policies.sql из репозитория (политики для роли anon на card_library, reference_library, history, favorites и bucket images).';
  }
  if (/storage|bucket|object|upload|policy/i.test(raw) && /violat|denied|forbidden|403|unauthor/i.test(raw)) {
    return 'Ошибка Storage: проверьте bucket images и политики в supabase/rls-anon-policies.sql (раздел Storage).';
  }
  return raw;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReferenceLibraryEntry {
  id: string;
  name: string;
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  addedAt: number;
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

// ─── Storage helpers ──────────────────────────────────────────────────────────

function base64ToBytes(base64: string, mimeType: string): Blob {
  const raw = base64.split(',')[1] || base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function getPublicUrl(path: string): string {
  if (!supabase) return '';
  return supabase.storage.from('images').getPublicUrl(path).data.publicUrl;
}

function extractPathFromUrl(url: string): string | null {
  const match = url.match(/\/storage\/v1\/object\/public\/images\/(.+?)(\?.*)?$/);
  return match ? match[1] : null;
}

async function uploadBlob(blob: Blob, path: string): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.storage.from('images').upload(path, blob, {
    contentType: blob.type,
    upsert: true,
  });
  if (error) throw error;
  return getPublicUrl(path);
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

function newId(): string {
  return Math.random().toString(36).substring(2, 12);
}

// ─── Card Library ─────────────────────────────────────────────────────────────

export async function loadCardLibrary(): Promise<CardLibraryEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('card_library')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) { console.error('loadCardLibrary', error); return []; }
  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    cardId: row.card_id,
    storagePath: row.storage_path,
    storageUrl: getPublicUrl(row.storage_path),
    mimeType: row.mime_type,
    addedAt: row.added_at,
  }));
}

export async function saveCardToLibrary(
  name: string,
  cardId: string,
  imageData: string,
  mimeType: string
): Promise<CardLibraryEntry> {
  if (!supabase) throw new Error('Supabase not configured');
  const id = newId();
  const ext = mimeType.split('/')[1]?.split('+')[0] || 'png';
  const storagePath = `cards/${id}.${ext}`;
  const blob = base64ToBytes(imageData, mimeType);
  const storageUrl = await uploadBlob(blob, storagePath);
  const { error } = await supabase.from('card_library').insert({
    id,
    name,
    card_id: cardId,
    storage_path: storagePath,
    mime_type: mimeType,
    added_at: Date.now(),
  });
  if (error) throw error;
  return { id, name, cardId, storageUrl, storagePath, mimeType, addedAt: Date.now() };
}

export async function deleteCardFromLibrary(id: string, storagePath: string): Promise<void> {
  if (!supabase) return;
  await supabase.storage.from('images').remove([storagePath]);
  await supabase.from('card_library').delete().eq('id', id);
}
// ─── Reference library ───────────────────────────────────────────────────────

export async function loadReferenceLibrary(): Promise<ReferenceLibraryEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('reference_library')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) {
    console.error('loadReferenceLibrary', error);
    return [];
  }
  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    storagePath: row.storage_path,
    storageUrl: getPublicUrl(row.storage_path),
    mimeType: row.mime_type,
    addedAt: row.added_at,
  }));
}

export async function saveReferenceToLibrary(
  name: string,
  imageData: string,
  mimeType: string
): Promise<ReferenceLibraryEntry> {
  if (!supabase) throw new Error('Supabase not configured');
  const id = newId();
  const ext = mimeType.split('/')[1]?.split('+')[0] || 'png';
  const storagePath = `references/${id}.${ext}`;
  const blob = base64ToBytes(imageData, mimeType);
  const storageUrl = await uploadBlob(blob, storagePath);
  const { error } = await supabase.from('reference_library').insert({
    id,
    name,
    storage_path: storagePath,
    mime_type: mimeType,
    added_at: Date.now(),
  });
  if (error) throw error;
  return { id, name, storageUrl, storagePath, mimeType, addedAt: Date.now() };
}

export async function deleteReferenceFromLibrary(id: string, storagePath: string): Promise<void> {
  if (!supabase) return;
  await supabase.storage.from('images').remove([storagePath]);
  await supabase.from('reference_library').delete().eq('id', id);
}


// ─── History ─────────────────────────────────────────────────────────────────

export async function loadHistory(): Promise<string[]> {
  if (!supabase) {
    const data = await get('fusion_history');
    return data || [];
  }
  const { data, error } = await supabase
    .from('history')
    .select('storage_path')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) { console.error('loadHistory', error); return []; }
  return (data || []).map(row => getPublicUrl(row.storage_path));
}

export async function saveToHistory(imageInput: string, mimeType = 'image/png'): Promise<void> {
  let dataUrl = imageInput;
  let mt = mimeType;
  try {
    if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
      const conv = await urlToBase64(imageInput);
      dataUrl = conv.base64;
      mt = conv.mimeType || mimeType;
    } else if (!imageInput.startsWith('data:')) {
      console.warn('saveToHistory: expected data URL or http(s) URL, skipping');
      return;
    }
  } catch (e) {
    console.error('saveToHistory: could not resolve image', e);
    return;
  }

  try {
    const existing: string[] = (await get('fusion_history')) || [];
    const updated = [dataUrl, ...existing].slice(0, 50);
    await set('fusion_history', updated);
  } catch {}

  if (!supabase) return;
  try {
    const id = newId();
    const ext = mt.split('/')[1]?.split('+')[0] || 'png';
    const storagePath = `history/${id}.${ext}`;
    const blob = base64ToBytes(dataUrl, mt);
    await uploadBlob(blob, storagePath);
    await supabase.from('history').insert({ id, storage_path: storagePath, created_at: Date.now() });
  } catch (e) {
    console.error('saveToHistory Supabase', e);
  }
}

export async function clearHistory(): Promise<void> {
  try { await del('fusion_history'); } catch {}
  if (!supabase) return;
  try {
    const { data } = await supabase.from('history').select('storage_path');
    if (data?.length) await supabase.storage.from('images').remove(data.map(r => r.storage_path));
    await supabase.from('history').delete().neq('id', '');
  } catch (e) {
    console.error('clearHistory Supabase', e);
  }
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function loadFavorites(): Promise<string[]> {
  if (!supabase) {
    const data = await get('fusion_liked');
    return data || [];
  }
  const { data, error } = await supabase
    .from('favorites')
    .select('storage_path')
    .order('created_at', { ascending: false });
  if (error) { console.error('loadFavorites', error); return []; }
  return (data || []).map(row => getPublicUrl(row.storage_path));
}

export async function addToFavorites(url: string): Promise<void> {
  if (!supabase) return;
  try {
    const id = newId();
    let storagePath: string;
    let mimeType = 'image/png';

    if (url.startsWith('data:')) {
      // base64 data URL
      const m = url.match(/^data:(image\/[^;]+);base64,/);
      if (m) mimeType = m[1];
      const ext = mimeType.split('/')[1]?.split('+')[0] || 'png';
      storagePath = `favorites/${id}.${ext}`;
      const blob = base64ToBytes(url, mimeType);
      await uploadBlob(blob, storagePath);
    } else {
      // Already a URL (e.g., Supabase history URL) — re-upload to favorites
      const existing = extractPathFromUrl(url);
      if (existing) {
        // Copy within Supabase storage by downloading and re-uploading
        const { base64, mimeType: mt } = await urlToBase64(url);
        mimeType = mt;
        const ext = mimeType.split('/')[1]?.split('+')[0] || 'png';
        storagePath = `favorites/${id}.${ext}`;
        const blob = base64ToBytes(base64, mimeType);
        await uploadBlob(blob, storagePath);
      } else {
        const { base64, mimeType: mt } = await urlToBase64(url);
        mimeType = mt;
        const ext = mimeType.split('/')[1]?.split('+')[0] || 'png';
        storagePath = `favorites/${id}.${ext}`;
        const blob = base64ToBytes(base64, mimeType);
        await uploadBlob(blob, storagePath);
      }
    }
    await supabase.from('favorites').insert({ id, storage_path: storagePath, created_at: Date.now() });
  } catch (e) {
    console.error('addToFavorites Supabase', e);
  }
}

export async function removeFromFavorites(url: string): Promise<void> {
  if (!supabase) return;
  try {
    // Find by matching public URL pattern or direct path
    const path = extractPathFromUrl(url);
    if (path) {
      await supabase.storage.from('images').remove([path]);
      await supabase.from('favorites').delete().eq('storage_path', path);
    } else {
      // Fallback: delete all favorites with matching URL prefix won't work well
      console.warn('removeFromFavorites: could not extract path from', url.slice(0, 50));
    }
  } catch (e) {
    console.error('removeFromFavorites Supabase', e);
  }
}

// ─── Migration IDB → Supabase ─────────────────────────────────────────────────

export async function migrateFromIDB(): Promise<void> {
  if (!supabase) return;
  try {
    // Check if already migrated (Supabase has data)
    const [histRes, favRes] = await Promise.all([
      supabase.from('history').select('id', { count: 'exact', head: true }),
      supabase.from('favorites').select('id', { count: 'exact', head: true }),
    ]);
    if ((histRes.count ?? 0) > 0 || (favRes.count ?? 0) > 0) return;

    const [idbHistory, idbLiked]: [string[] | undefined, string[] | undefined] = await Promise.all([
      get('fusion_history'),
      get('fusion_liked'),
    ]);

    if (!idbHistory?.length && !idbLiked?.length) return;

    console.log('Migrating IDB data to Supabase...');
    if (idbHistory?.length) {
      for (const item of idbHistory.slice(0, 50)) {
        await saveToHistory(item).catch(() => {});
        await new Promise(r => setTimeout(r, 0));
      }
    }
    if (idbLiked?.length) {
      for (const base64 of idbLiked) {
        await addToFavorites(base64).catch(() => {});
      }
      // Save liked URLs to IDB as Supabase URLs (so likedSet works after reload)
      const supabaseLiked = await loadFavorites();
      if (supabaseLiked.length) await set('fusion_liked', supabaseLiked);
    }
    console.log('Migration complete');
  } catch (e) {
    console.error('Migration failed', e);
  }
}
