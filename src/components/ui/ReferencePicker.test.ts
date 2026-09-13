import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { ReferencePicker } from './ReferencePicker';
let container: HTMLDivElement, root: Root;
const entries = ['Дуэль', 'Три героя'].map((name, id) => ({ id: String(id), name, storageUrl: `/ref-${id}.png`, storagePath: `ref-${id}`, mimeType: 'image/png', addedAt: 0, visionAnalysis: null }));
const options = () => ({ entries, reference: null, onSelect: vi.fn().mockResolvedValue(undefined), onUpload: vi.fn(), onClear: vi.fn(), onPreview: vi.fn() });
const find = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
async function open() { await act(async () => container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click()); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Reference picker', () => {
  it('opens a named picker with searchable entries and visible names', async () => {
    await act(async () => root.render(React.createElement(ReferencePicker, options()))); await open();
    expect(container.querySelector('dialog')!.open).toBe(true);
    const input = container.querySelector('input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'дуэль'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.querySelectorAll('.studio-reference-choice')).toHaveLength(1);
    expect(container.querySelector('.studio-reference-choice')!.textContent).toBe('Дуэль');
  });
  it('keeps selection failure in the dialog and allows retry', async () => {
    const props = options(); props.onSelect.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(React.createElement(ReferencePicker, props))); await open();
    await act(async () => find('Выбрать Дуэль').click());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Не удалось выбрать');
    expect(container.querySelector('dialog')!.open).toBe(true);
    await act(async () => find('Выбрать Дуэль').click());
    expect(container.querySelector('dialog')!.open).toBe(false);
  });
  it('allows closing a pending choice and aborts its request', async () => {
    const props = options(); let signal!: AbortSignal;
    props.onSelect.mockImplementation((_entry, value) => { signal = value; return new Promise(() => {}); });
    await act(async () => root.render(React.createElement(ReferencePicker, props))); await open();
    await act(async () => find('Выбрать Дуэль').click());
    expect(find('Выбрать Три героя').disabled).toBe(true);
    await act(async () => find('Закрыть выбор референса').click());
    expect(signal.aborted).toBe(true); expect(container.querySelector('dialog')!.open).toBe(false);
  });
});
