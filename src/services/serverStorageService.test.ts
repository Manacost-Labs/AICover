import { afterEach, describe, expect, it, vi } from 'vitest';
import { addToFavorites, loadCardLibrary, removeFromFavorites, saveToHistory } from './serverStorageService';

const fetchMock = vi.fn();

describe('serverStorageService', () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('loads card library entries from the Cover server API', async () => {
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response(JSON.stringify([{
      id: 'card-1',
      name: 'Jaina',
      cardId: 'HERO_08',
      storagePath: 'cards/card-1.png',
      storageUrl: '/uploads/cards/card-1.png',
      mimeType: 'image/png',
      addedAt: 1,
    }]), { status: 200 })));

    await expect(loadCardLibrary()).resolves.toEqual([expect.objectContaining({
      id: 'card-1',
      storageUrl: '/uploads/cards/card-1.png',
    })]);
    expect(fetchMock).toHaveBeenCalledWith('/api/card-library', expect.objectContaining({
      credentials: 'same-origin',
    }));
  });

  it('persists a generated image through the server history endpoint', async () => {
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'history-1' }), { status: 200 })));

    await saveToHistory('data:image/png;base64,aGVsbG8=', 'image/png');

    expect(fetchMock).toHaveBeenCalledWith('/api/history', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ dataUrl: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }),
    }));
  });

  it('removes a just-created favorite by its server id', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'favorite-1',
        storagePath: 'favorites/favorite-1.png',
        storageUrl: '/uploads/favorites/favorite-1.png',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await addToFavorites('data:image/png;base64,aGVsbG8=');
    await removeFromFavorites('data:image/png;base64,aGVsbG8=');

    expect(fetchMock).toHaveBeenLastCalledWith('/api/favorites?id=favorite-1', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  it('re-uploads a same-origin history URL when it becomes a favorite', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('image-bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'favorite-from-history',
        storagePath: 'favorites/favorite-from-history.png',
        storageUrl: '/uploads/favorites/favorite-from-history.png',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(addToFavorites('/uploads/history/source.png')).resolves.toEqual(expect.objectContaining({
      id: 'favorite-from-history',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/uploads/history/source.png');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/favorites', expect.objectContaining({ method: 'POST' }));
  });
});
