import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, set } from 'idb-keyval';
import { loadVideoHistory, loadVideoFavorites, loadVideoFavoriteChoiceNotesMap } from './services/serverStorageService';

const state = vi.hoisted(() => ({ create: null as any, tools: null as any, generate: vi.fn(), upscale: vi.fn(), save: vi.fn() }));
vi.mock('idb-keyval', () => ({ get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./services/geminiService', async importOriginal => ({
  ...await importOriginal<typeof import('./services/geminiService')>(), generateFusedCover: state.generate, upscaleImage: state.upscale,
}));
vi.mock('./services/serverStorageService', async importOriginal => ({
  ...await importOriginal<typeof import('./services/serverStorageService')>(),
  loadHistory: async () => [], loadFavorites: async () => [], loadCardLibrary: async () => [], loadReferenceLibrary: async () => [],
  loadVideoHistory: vi.fn().mockResolvedValue([]), loadVideoFavorites: vi.fn().mockResolvedValue([]), loadFavoriteChoiceNotesMap: async () => ({}), loadVideoFavoriteChoiceNotesMap: vi.fn().mockResolvedValue({}), saveToHistory: state.save,
}));
vi.mock('./components/tabs/CreateTab', () => ({ CreateTab: (props: any) => { state.create = props; return React.createElement('div', null, 'Create fixture'); } }));
vi.mock('./components/tabs/ImageToolsTab', () => ({ ImageToolsTab: (props: any) => { state.tools = props.tools; return React.createElement('div', null, 'Image tools fixture'); } }));
vi.mock('./components/tabs/ThumbnailTab', () => ({ ThumbnailTab: () => React.createElement('input', { 'aria-label': 'Fixture title', defaultValue: 'Original' }) }));
vi.mock('./components/tabs/HistoryTab', () => ({ HistoryTab: () => React.createElement('div', null, 'History fixture') }));
vi.mock('./components/tabs/LibraryTab', () => ({ LibraryTab: () => React.createElement('div', null, 'Library fixture') }));
vi.mock('motion/react', async () => {
  const react = await import('react');
  return {
    AnimatePresence: ({ children }: any) => children,
    motion: { div: react.forwardRef(({ initial, animate, exit, transition, ...props }: any, ref: any) => react.createElement('div', { ...props, ref })) },
  };
});

import App from './App';
let root: Root;
let container: HTMLDivElement;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render() { await act(async () => root.render(React.createElement(App))); await settle(); }
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === text);
  expect(button, text).toBeDefined();
  await act(async () => button!.click()); await settle();
}
async function addSources() {
  await act(async () => state.create.setSources([{ id: 'one', data: 'data:image/png;base64,AA==', mimeType: 'image/png' }, { id: 'two', data: 'data:image/png;base64,AQ==', mimeType: 'image/png' }]));
}

beforeEach(() => {
  vi.mocked(get).mockResolvedValue(undefined); vi.mocked(set).mockResolvedValue(undefined);
  state.create = null; state.generate.mockReset(); state.upscale.mockReset(); state.save.mockReset().mockResolvedValue({ id: 'saved' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ gemini: true }))));
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: query.includes('1280'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => true, onchange: null }));
  localStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('redesign shell and generation boundaries', () => {
  it('does not load, migrate or overwrite stored video collections during startup or navigation', async () => {
    await render(); await click('История'); await click('Создать');
    for (const load of [loadVideoHistory, loadVideoFavorites, loadVideoFavoriteChoiceNotesMap]) expect(load).not.toHaveBeenCalled();
    expect(vi.mocked(get).mock.calls.some(([key]) => String(key).startsWith('fusion_video_'))).toBe(false);
    expect(vi.mocked(set).mock.calls.some(([key]) => String(key).startsWith('fusion_video_'))).toBe(false);
  });
  it('keeps shell and collections available while capabilities are pending or unavailable', async () => {
    const request = deferred<Response>(); vi.mocked(fetch).mockReturnValue(request.promise);
    await render();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(6);
    expect(container.querySelector('#studio-tab-image-tools')).not.toBeNull();
    expect(container.querySelector('#studio-tab-expand')).toBeNull();
    expect(container.querySelector('#studio-tab-upscale')).toBeNull();
    expect(container.querySelector('#studio-tab-thumbnail')?.textContent).toBe('Обложка');
    expect(container.querySelector('#studio-tab-video')).toBeNull();
    expect(container.querySelector('#studio-tab-library')).toBeNull();
    expect(state.create.availability).toBe('checking');
    await click('История');
    expect(container.textContent).toContain('History fixture');
    await act(async () => request.resolve(new Response(JSON.stringify({ gemini: false }))));
    expect(container.textContent).toContain('History fixture');
    await click('Создать'); expect(state.create.availability).toBe('unavailable');
    await addSources(); await act(async () => state.create.handleGenerate());
    expect(state.generate).not.toHaveBeenCalled();
  });

  it('persists theme selection without resetting Create inputs', async () => {
    await render(); await addSources();
    await act(async () => state.create.setSettings((settings: any) => ({ ...settings, prompt: 'Keep my prompt' })));
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Включить тёмную тему"]')!;
    await act(async () => toggle.click());
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('cover_theme')).toBe('dark');
    expect(state.create.sources).toHaveLength(2);
    expect(state.create.settings.prompt).toBe('Keep my prompt');
  });

  it('retains the mounted thumbnail editor when switching tabs', async () => {
    await render(); await click('Обложка');
    const input = container.querySelector<HTMLInputElement>('[aria-label="Fixture title"]')!;
    input.value = 'Unsaved title';
    await click('История');
    expect(input.closest('[hidden]')).not.toBeNull();
    await click('Обложка');
    expect(container.querySelector('[aria-label="Fixture title"]')).toBe(input);
    expect(input.value).toBe('Unsaved title');
  });

  it('keeps generated media visible when the history write fails', async () => {
    state.generate.mockResolvedValue(['data:image/png;base64,fixture']); state.save.mockResolvedValue(null);
    await render(); await addSources(); await act(async () => state.create.handleGenerate()); await settle();
    expect(state.create.results).toEqual(['data:image/png;base64,fixture']);
    expect(state.create.saveWarning).toContain('Не удалось сохранить');
    expect(state.create.error).toBeNull();
  });

  it('keeps a published OpenRouter variant when the next paid variant fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ gemini: true, openrouter: true })));
    state.generate.mockImplementation(async (...args: any[]) => {
      await args[8]('data:image/png;base64,first-paid-result');
      throw new Error('Второй вариант не создан');
    });
    await render();
    await addSources();
    await act(async () => state.create.setSettings((settings: any) => ({
      ...settings,
      model: 'x-ai/grok-imagine-image-2.0',
      batchSize: 2,
    })));

    await act(async () => state.create.handleGenerate());
    await settle();

    expect(state.create.results).toEqual(['data:image/png;base64,first-paid-result']);
    expect(state.create.error).toContain('Второй вариант не создан');
    expect(state.save).toHaveBeenCalledWith('data:image/png;base64,first-paid-result');
    expect(set).toHaveBeenCalledWith('fusion_history', ['data:image/png;base64,first-paid-result']);
  });

  it('keeps the OpenRouter result visible and stops when both history stores fail', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ gemini: true, openrouter: true })));
    state.save.mockResolvedValue(null);
    state.generate.mockImplementation(async (...args: any[]) => {
      await args[8]('data:image/png;base64,unpersisted-paid-result');
      return ['data:image/png;base64,unpersisted-paid-result'];
    });
    await render();
    vi.mocked(set).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    await addSources();
    await act(async () => state.create.setSettings((settings: any) => ({
      ...settings,
      model: 'x-ai/grok-imagine-image-2.0',
    })));

    await act(async () => state.create.handleGenerate());
    await settle();

    expect(state.create.results).toEqual(['data:image/png;base64,unpersisted-paid-result']);
    expect(state.create.error).toContain('не удалось надёжно сохранить');
    expect(state.create.saveWarning).toContain('Скачайте изображение');
  });

  it('ignores late progress/results from an operation whose waiting was stopped', async () => {
    const first = deferred<string[]>(), second = deferred<string[]>();
    state.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render(); await addSources();
    let firstCall!: Promise<void>, secondCall!: Promise<void>;
    await act(async () => { firstCall = state.create.handleGenerate(); });
    const firstProgress = state.generate.mock.calls[0][6];
    await act(async () => state.create.onCancelGeneration());
    expect(state.create.generationNotice).toContain('Ожидание остановлено');
    await act(async () => { secondCall = state.create.handleGenerate(); });
    await act(async () => { firstProgress({ done: 99, total: 99, phase: 'strict' }); first.resolve(['old']); await firstCall; });
    expect(state.create.isGenerating).toBe(true);
    expect(state.create.generationProgress.done).toBe(0);
    expect(state.create.results).toEqual([]);
    await act(async () => { second.resolve(['new']); await secondCall; });
    expect(state.create.results).toEqual(['new']); expect(state.create.isGenerating).toBe(false);
  });

  it('does not issue two generation requests from repeated synchronous clicks', async () => {
    const result = deferred<string[]>(); state.generate.mockReturnValue(result.promise);
    await render(); await addSources();
    let first!: Promise<void>;
    await act(async () => { first = state.create.handleGenerate(); void state.create.handleGenerate(); });
    expect(state.generate).toHaveBeenCalledTimes(1);
    await act(async () => { result.resolve(['one']); await first; });
  });

  it('prevents reset and new generation while a result is being upscaled', async () => {
    const operation = deferred<string>(); state.upscale.mockReturnValue(operation.promise);
    await render(); await addSources();
    let running!: Promise<void>;
    await act(async () => { running = state.create.handleUpscale('data:image/png;base64,original'); });
    const reset = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Сбросить')!;
    expect(reset.disabled).toBe(true);
    await act(async () => { reset.click(); await state.create.handleGenerate(); });
    expect(state.create.sources).toHaveLength(2); expect(state.generate).not.toHaveBeenCalled();
    await act(async () => { operation.resolve('data:image/png;base64,upscaled'); await running; });
    expect(state.create.results).toEqual(['data:image/png;base64,upscaled']);
    expect(reset.disabled).toBe(false); expect(state.create.isUpscaling).toBe(false);
  });

  it('keeps the current reference on failed or cancelled selection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    await act(async () => state.create.selectReferenceFromLibrary({ id: 'old', storageUrl: 'data:image/png;base64,previous', visionAnalysis: 'Old composition' }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await act(async () => { await expect(state.create.selectReferenceFromLibrary({ id: 'next', storageUrl: '/missing.png' })).rejects.toThrow(); });
    expect(state.create.reference.data).toBe('data:image/png;base64,previous');
    const controller = new AbortController(); controller.abort();
    await act(async () => { await expect(state.create.selectReferenceFromLibrary({ id: 'next', storageUrl: 'data:image/png;base64,new' }, controller.signal)).rejects.toThrow(); });
    expect(state.create.reference.data).toBe('data:image/png;base64,previous');
  });

  it('retains shared tool state and completes an operation after navigation', async () => {
    const operation = deferred<string>(); state.upscale.mockReturnValue(operation.promise);
    await render(); await click('Размер и качество');
    await act(async () => {
      state.tools.setSource({ data: 'data:image/jpeg;base64,input', mimeType: 'image/jpeg' });
      state.tools.setOperation('upscale');
      state.tools.setSettings((s: any) => ({ ...s, imageSize: '2K' }));
    });
    let running!: Promise<void>;
    await act(async () => { running = state.tools.run(); });
    await click('История');
    await act(async () => { operation.resolve('data:image/png;base64,done'); await running; });
    await click('Размер и качество');
    expect(state.tools.source.mimeType).toBe('image/jpeg');
    expect(state.tools.settings.imageSize).toBe('2K');
    expect(state.tools.results[0]).toMatchObject({ status: 'done', output: 'data:image/png;base64,done' });
    expect(state.save).toHaveBeenCalledWith('data:image/png;base64,done');
    expect(set).toHaveBeenCalledWith('fusion_history', ['data:image/png;base64,done']);
    expect(state.create.results).toEqual([]);
  });

  it('keeps the Create upscale result available on the unified tools page', async () => {
    state.upscale.mockResolvedValue('data:image/png;base64,upscaled');
    await render(); await act(async () => state.create.handleUpscale('data:image/jpeg;base64,original'));
    expect(state.create.results).toEqual(['data:image/png;base64,upscaled']);
    await click('Размер и качество');
    expect(state.tools.results[0]).toMatchObject({ operation: 'upscale', status: 'done', source: { mimeType: 'image/jpeg' } });
  });

  it('shares model settings with the modal picker without losing resolution safeguards', async () => {
    await render();
    await act(async () => state.create.setSettings((s: any) => ({ ...s, imageSize: '512px' })));
    await act(async () => state.create.onOpenSettings());
    await click('⚙️ Настройки');
    await act(async () => container.querySelector<HTMLInputElement>('.studio-settings-dialog .model-picker input[value="gemini-3-pro-image-preview"]')!.click());
    expect(state.create.settings.model).toBe('gemini-3-pro-image-preview');
    expect(state.create.settings.imageSize).toBe('1K');
    await click('Готово');
    expect(state.create.settings.model).toBe('gemini-3-pro-image-preview');
  });
});
