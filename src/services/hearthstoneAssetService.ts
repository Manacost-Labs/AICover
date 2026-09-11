import type { ThumbnailAsset } from '../features/thumbnail/types';

const API_BASE = 'https://api.kolodahearthstone.com/api/v1';

type ApiCard = {
  card_id: string;
  name?: string | { ru?: string; en?: string };
  images?: {
    art?: string | null;
    crop?: string | null;
    full_art?: string | null;
    card?: string | null;
  };
};

type ApiListResponse = { data?: ApiCard[] };

function displayName(card: ApiCard): string {
  if (typeof card.name === 'string') return card.name;
  return card.name?.ru || card.name?.en || card.card_id;
}

function bestImage(card: ApiCard): string | null {
  return card.images?.full_art || card.images?.art || card.images?.crop || card.images?.card || null;
}

async function searchEndpoint(
  endpoint: string,
  query: string,
  source: ThumbnailAsset['source']
): Promise<ThumbnailAsset[]> {
  const params = new URLSearchParams({ q: query, per_page: '10' });
  const response = await fetch(`${API_BASE}/${endpoint}?${params}`);
  if (!response.ok) throw new Error(`HSData ${endpoint}: HTTP ${response.status}`);
  const payload = await response.json() as ApiListResponse;

  return (payload.data || []).flatMap((card) => {
    const imageUrl = bestImage(card);
    if (!imageUrl) return [];
    return [{
      id: `${source}:${card.card_id}`,
      name: displayName(card),
      cardId: card.card_id,
      imageUrl,
      source,
    } satisfies ThumbnailAsset];
  });
}

export async function searchHearthstoneAssets(query: string): Promise<ThumbnailAsset[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const settled = await Promise.allSettled([
    searchEndpoint('cards', trimmed, 'battlegrounds'),
    searchEndpoint('heroes', trimmed, 'hero'),
    searchEndpoint('hero-skins', trimmed, 'hero'),
  ]);

  const deduped = new Map<string, ThumbnailAsset>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const asset of result.value) deduped.set(asset.id, asset);
  }
  return Array.from(deduped.values()).slice(0, 24);
}
