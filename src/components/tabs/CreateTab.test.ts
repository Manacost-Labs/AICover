import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTab } from './CreateTab';
import { MODELS_NO_512PX } from '../../constants';
vi.mock('../DeckImportSection', () => ({ DeckImportSection: () => React.createElement('span', null, 'Deck library fixture') }));
const noop = () => {};
let container: HTMLDivElement, root: Root;
function props(overrides: Record<string, unknown> = {}) {
  return {
    sources: [], setSources: vi.fn(), createLayoutMode: 'cover', onCreateLayoutModeChange: vi.fn(), scenePlan: 3, onScenePlanChange: vi.fn(), focusedSceneSlot: 'left', onFocusedSceneSlotChange: noop, onRequestSourceUploadForSlot: vi.fn(),
    reference: null, setReference: noop, settings: { model: 'gemini-2.5-flash-image', aspectRatio: '16:9', imageSize: '1K', prompt: '', negativePrompt: '', batchSize: 1, strictMode: true }, setSettings: vi.fn(), baseImage: null, setBaseImage: vi.fn(), isGenerating: false, handleGenerate: vi.fn(), generationProgress: null, onCancelGeneration: vi.fn(), sceneToCoverWarning: false, results: [], isUpscaling: false, handleUpscale: vi.fn(), setFullscreenImage: vi.fn(), toggleLike: vi.fn(), likedSet: new Set(), error: null,
    isDragging: false, handleDragOver: noop, handleDragLeave: noop, handleDrop: noop, handleLocalPaste: noop, sourceInputRef: createRef(), refInputRef: createRef(), promptRef: createRef(), handleFileChange: noop, handleDragOverRef: noop, handleDragLeaveRef: noop, handleDropRef: noop, selectReferenceFromLibrary: vi.fn(), ASPECT_RATIOS: ['16:9','1:1'], RESOLUTIONS: ['512px','1K','2K','4K'], isDraggingRef: false, userReferenceLibrary: [], cardLibrary: [], onAddCardSource: noop, onRemoveCardSource: noop, availability: 'available', ...overrides,
  } as any;
}
const source = (id: string, role?: string) => ({ id, role, data: `data:image/png;base64,${id}`, mimeType: 'image/png' });
async function render(value: any) { await act(async () => root.render(React.createElement(CreateTab, value))); }
function button(text: string) { return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === text)!; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Create editor contract', () => {
  it('explains missing sources and capabilities before enabling generate', async () => {
    await render(props()); expect(container.textContent).toContain('минимум два'); expect(button('Создать 1 вариант').disabled).toBe(true);
    await render(props({ sources: [source('a')] })); expect(container.textContent).toContain('ещё одно');
    await render(props({ sources: [source('a'),source('b')], availability: 'unavailable' })); expect(button('Создать 1 вариант').disabled).toBe(true);
    await render(props({ sources: [source('a'),source('b')] })); expect(button('Создать 1 вариант').disabled).toBe(false);
  });
  it('requires every scene role and confirms dropping the center image', async () => {
    const options = props({ createLayoutMode: 'scene', sources: [source('a','left'),source('b','center')] });
    await render(options); expect(button('Создать 1 вариант').disabled).toBe(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => button('2 персонажа').click()); expect(options.onScenePlanChange).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => button('2 персонажа').click()); expect(options.onScenePlanChange).toHaveBeenCalledWith(2);
  });
  it('offers a keyboard alternative for cover source ordering', async () => {
    const options = props({ sources: [source('a'),source('b')] }); await render(options);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Переместить исходник 2 влево"]')!.click());
    expect(options.setSources.mock.calls[0][0](options.sources).map((item: any) => item.id)).toEqual(['b','a']);
  });
  it('does not hide later entries in the reference library', async () => {
    const references = Array.from({ length: 7 }, (_, index) => ({ id: `${index}`, name: `Reference ${index}`, storageUrl: `/fixture/${index}.png` }));
    const options = props({ userReferenceLibrary: references }); await render(options);
    expect(container.querySelectorAll('.studio-reference-choice')).toHaveLength(7);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Выбрать Reference 6"]')!.click());
    expect(options.selectReferenceFromLibrary).toHaveBeenCalledWith(references[6], expect.any(AbortSignal));
  });
  it('keeps previous output available during generation without allowing competing mutations', async () => {
    const options = props({ sources: [source('a'),source('b')], results: ['data:image/png;base64,previous'], isGenerating: true }); await render(options);
    expect(container.querySelector('[alt="Вариант 1"]')).not.toBeNull();
    expect(button('Скачать').disabled).toBe(false); expect(button('Открыть').disabled).toBe(false);
    expect(button('Апскейл').disabled).toBe(true); expect(button('Доработать').disabled).toBe(true); expect(button('В избранное').disabled).toBe(true);
    await act(async () => button('Остановить ожидание').click()); expect(options.onCancelGeneration).toHaveBeenCalledOnce();
  });
  it('shows a three-stage generation timeline and a distinct result reveal surface', async () => {
    await render(props({ sources: [source('a'), source('b')], isGenerating: true, generationProgress: { phase: 'generating', done: 0, total: 2 } }));
    expect(container.querySelector('[data-generation-stage="generating"]')).not.toBeNull();
    expect(container.textContent).toContain('Подготовка');
    expect(container.textContent).toContain('Создание');
    expect(container.textContent).toContain('Финализация');
    await render(props({ sources: [source('a'), source('b')], results: ['data:image/png;base64,result'] }));
    expect(container.querySelector('[data-result-reveal="true"]')).not.toBeNull();
  });
  it('keeps the 512px model restriction in native format controls', async () => {
    const options = props(); options.settings.model = [...MODELS_NO_512PX][0]; await render(options);
    expect(container.querySelector<HTMLOptionElement>('option[value="512px"]')!.disabled).toBe(true);
    expect(container.textContent).toContain('от 1K');
  });
  it('coerces 512px to 1K when Pro is selected through the logo picker', async () => {
    const options = props(); options.settings.imageSize = '512px'; await render(options);
    await act(async () => container.querySelector<HTMLInputElement>('.model-picker input[value="gemini-3-pro-image-preview"]')!.click());
    const next = options.setSettings.mock.calls[0][0](options.settings);
    expect(next).toMatchObject({ model: 'gemini-3-pro-image-preview', imageSize: '1K' });
    expect(next.prompt).toBe(options.settings.prompt);
  });
  it('announces upscale progress and prevents competing generation while keeping downloads available', async () => {
    await render(props({ sources: [source('a'),source('b')], results: ['data:image/png;base64,original'], isUpscaling: true }));
    expect(container.textContent).toContain('Увеличиваем разрешение');
    expect(button('Создать 1 вариант').disabled).toBe(true);
    expect(button('Скачать').disabled).toBe(false);
    expect(button('Апскейл').disabled).toBe(true);
  });
});
