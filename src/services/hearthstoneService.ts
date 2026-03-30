import { decode } from 'deckstrings';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { CardLibraryEntry } from './supabaseService';

const HS_CARDS_CACHE_KEY = 'hs_cards_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const HS_CARDS_URL = 'https://api.hearthstonejson.com/v1/latest/enUS/cards.json';

interface CachedCards {
  data: Array<{ id: string; dbfId: number }>;
  fetchedAt: number;
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
