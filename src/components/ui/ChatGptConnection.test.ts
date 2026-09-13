import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatGptProvider, ProviderModelPicker } from './ChatGptConnection';
let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const picker = (openRouterEnabled = false) => React.createElement(ProviderModelPicker, { value: 'gemini', options: [{ id: 'gemini', name: 'Gemini' }], onChange: vi.fn(), openRouterEnabled });
async function render(connected: boolean, enabled = true, openRouterEnabled = false) {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
    String(url).includes('openrouter-models')
      ? { models: [
          { id: 'meta/muse-image', availability: 'unavailable' },
          { id: 'x-ai/grok-imagine-image-2.0', availability: 'available' },
        ] }
      : { enabled, connected, imageVerified: false },
  )))));
  await act(async () => root.render(React.createElement(ChatGptProvider, null, picker(openRouterEnabled))));
}
it('leaves Gemini usable while requiring a personal connection for GPT', async () => {
  await render(false);
  expect(container.querySelector<HTMLInputElement>('input[value="gemini"]')!.disabled).toBe(false);
  expect(container.querySelector<HTMLInputElement>('input[value="gpt-image-2"]')!.disabled).toBe(true);
  expect(container.querySelector('input[value="gpt-image-2"]')!.closest('label')!.querySelector('img')).not.toBeNull();
  expect(container.textContent).toContain('Подключить');
});
it('enables the GPT tile after connection without claiming verified model access', async () => {
  await render(true);
  expect(container.querySelector<HTMLInputElement>('input[value="gpt-image-2"]')!.disabled).toBe(false);
  expect(container.textContent).toContain('при первой генерации');
  expect(container.textContent).toContain('Отключить');
});
it('keeps the previous interface unchanged when the server feature is disabled', async () => {
  await render(false, false);
  expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(1);
  expect(container.querySelector('.chatgpt-connection')).toBeNull();
});
it('adds the OpenRouter catalog, disables models without endpoints and gives providers real distinct icons', async () => {
  await render(false, false, true);
  expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(11);
  expect(container.querySelector<HTMLInputElement>('input[value="x-ai/grok-imagine-image-2.0"]')!.disabled).toBe(false);
  expect(container.querySelector<HTMLInputElement>('input[value="meta/muse-image"]')!.disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[value="krea/krea-2-large"]')!.disabled).toBe(false);
  const logos = Array.from(container.querySelectorAll<HTMLImageElement>('.model-picker__logo img')).map(image => image.src);
  expect(new Set(logos).size).toBeGreaterThanOrEqual(8);
  expect(container.textContent).toContain('нет активного endpoint');
});
