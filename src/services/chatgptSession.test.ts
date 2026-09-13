import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('exchanges the callback once and removes query credentials before the request', async () => {
  vi.resetModules();
  window.history.replaceState(null, '', '/chatgpt/callback?code=one-time-code&state=state-value');
  const fetchMock = vi.fn().mockImplementation(() => {
    expect(window.location.search).toBe('');
    return Promise.resolve(new Response(JSON.stringify({ connected: true })));
  });
  vi.stubGlobal('fetch', fetchMock);
  const { completeChatGptLogin } = await import('./chatgptSession');
  await Promise.all([completeChatGptLogin(), completeChatGptLogin()]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/chatgpt/callback', expect.objectContaining({ credentials: 'same-origin', body: JSON.stringify({ code: 'one-time-code', state: 'state-value' }) }));
});
