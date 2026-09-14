import { decode } from 'deckstrings';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { CardLibraryEntry } from './supabaseService';

const HS_CARDS_CACHE_KEY = 'hs_cards_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const HS_CARDS_URL = 'https://api.hearthstonejson.com/v1/latest/enUS/cards.json';
const IMAGE_INDEX_URL = 'https://image.kolodahs.ru';

interface CachedCards {
  data: Array<{ id: string; dbfId: number }>;
  fetchedAt: number;
}

interface ImageIndexSearchItem {
  type: string;
  id: string;
  dbf: number;
  name_ru?: string;
  name_en?: string;
}

interface ImageIndexArtItem {
  group?: string;
  label?: string;
  url?: string;
}

interface ImageIndexArtResponse {
  id: string;
  type: string;
  name?: {
    ru?: string;
    en?: string;
  };
  images?: ImageIndexArtItem[];
}

// Decode deckstring → array of dbfIds
export function decodeDeckstring(deckstring: string): number[] {
  const cleaned = deckstring.trim();
  const decoded = decode(cleaned);
  return decoded.cards.map(([dbfId]) => dbfId);
}

// Get dbfId → cardId mapping (cached in IDB, TTL 24h)
export async function getDbfIdToCardIdMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    // Try IDB cache first
    const cached: CachedCards | undefined = await idbGet(HS_CARDS_CACHE_KEY);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      for (const card of cached.data) map.set(card.dbfId, card.id);
      return map;
    }

    // Fetch from HearthstoneJSON
    const response = await fetch(HS_CARDS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const allCards: Array<{ id: string; dbfId: number; collectible?: number }> = await response.json();

    // Keep only collectible cards to reduce size
    const slim = allCards
      .filter(c => c.id && c.dbfId && c.collectible === 1)
      .map(c => ({ id: c.id, dbfId: c.dbfId }));

    const toCache: CachedCards = { data: slim, fetchedAt: Date.now() };
    await idbSet(HS_CARDS_CACHE_KEY, toCache).catch(() => {});

    for (const card of slim) map.set(card.dbfId, card.id);
  } catch (e) {
    console.error('getDbfIdToCardIdMap', e);
  }
  return map;
}

// Main: find which library cards are in the deck
export async function findLibraryCardsInDeck(
  deckstring: string,
  library: CardLibraryEntry[]
): Promise<Array<{ entry: CardLibraryEntry; count: number }>> {
  if (!library.length) return [];

  // Decode deckstring → [ [dbfId, count], ... ]
  const cleaned = deckstring.trim();
  const decoded = decode(cleaned);
  const deckMap = new Map<number, number>(); // dbfId → count
  for (const [dbfId, count] of decoded.cards) deckMap.set(dbfId, count);

  // Build dbfId → cardId mapping
  const dbfToCardId = await getDbfIdToCardIdMap();

  // Map dbfIds in deck to cardIds
  const deckCardIds = new Set<string>();
  const deckCountByCardId = new Map<string, number>();
  for (const [dbfId, count] of deckMap) {
    const cardId = dbfToCardId.get(dbfId);
    if (cardId) {
      const key = cardId.toLowerCase();
      deckCardIds.add(key);
      deckCountByCardId.set(key, count);
    }
  }

  const results: Array<{ entry: CardLibraryEntry; count: number }> = [];
  for (const entry of library) {
    const normalId = entry.cardId.trim().toLowerCase();
    if (deckCardIds.has(normalId)) {
      results.push({ entry, count: deckCountByCardId.get(normalId) ?? 1 });
    }
  }

  return results;
}

function isFullArtImage(image: ImageIndexArtItem): boolean {
  const group = String(image.group || '').toLowerCase();
  const label = String(image.label || '').toLowerCase();
  return group === 'gallery' || group === 'art' || label.includes('full art');
}

function proxiedImageUrl(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.data ?? null;
  } catch (e) {
    console.error('image index fetch failed', e);
    return null;
  }
}

async function resolveConstructedCard(dbfId: number, cardId?: string): Promise<ImageIndexSearchItem | null> {
  if (cardId) {
    const direct = await fetchJson<ImageIndexArtResponse>(
      `${IMAGE_INDEX_URL}/api/art?type=constructed&id=${encodeURIComponent(cardId)}`
    );
    if (direct?.id) {
      return {
        type: direct.type || 'constructed',
        id: direct.id,
        dbf: dbfId,
        name_ru: direct.name?.ru,
        name_en: direct.name?.en,
      };
    }
  }

  const matches = await fetchJson<ImageIndexSearchItem[]>(
    `${IMAGE_INDEX_URL}/api/search?q=${encodeURIComponent(String(dbfId))}&format=all&limit=10`
  );
  return matches?.find((item) => item.type === 'constructed' && Number(item.dbf) === dbfId) ?? null;
}

async function loadFullArtForCard(
  dbfId: number,
  count: number,
  cardId?: string
): Promise<Array<{ entry: CardLibraryEntry; count: number }>> {
  const card = await resolveConstructedCard(dbfId, cardId);
  if (!card) return [];

  const art = await fetchJson<ImageIndexArtResponse>(
    `${IMAGE_INDEX_URL}/api/art?type=${encodeURIComponent(card.type)}&id=${encodeURIComponent(card.id)}`
  );
  if (!art?.images?.length) return [];

  const fullArts = art.images.filter((image) => image.url && isFullArtImage(image));
  return fullArts.map((image, index) => {
    const rawUrl = image.url as string;
    const name = art.name?.ru || card.name_ru || art.name?.en || card.name_en || card.id;
    const suffix = fullArts.length > 1 && image.label ? ` — ${image.label}` : '';
    return {
      entry: {
        id: `deck_full_art_${card.id}_${index}`,
        name: `${name}${suffix}`,
        cardId: card.id,
        storageUrl: proxiedImageUrl(rawUrl),
        storagePath: rawUrl,
        mimeType: 'image/jpeg',
        addedAt: Date.now(),
      },
      count,
    };
  });
}

// Decode deckstring and return every Full Art found in image.kolodahs.ru for deck cards.
export async function findDeckFullArtCardsInDeck(
  deckstring: string
): Promise<Array<{ entry: CardLibraryEntry; count: number }>> {
  const cleaned = deckstring.trim();
  const decoded = decode(cleaned);
  const dbfToCardId = await getDbfIdToCardIdMap();
  const jobs = decoded.cards.map(([dbfId, count]) => loadFullArtForCard(dbfId, count, dbfToCardId.get(dbfId)));
  const nested = await Promise.all(jobs);
  return nested.flat();
}
