import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ImageToolsTab } from './ImageToolsTab';
import type { ImageToolsController } from '../../features/image-tools/useImageTools';

const readers: DeferredReader[] = [];
class DeferredReader {
  result = '';
  onload?: () => void;
  onerror?: () => void;
  readAsDataURL() { readers.push(this); }
  complete(data: string) { this.result = data; this.onload?.(); }
}
class DecodableImage {
  onload?: () => void;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}
let root: Root;
let host: HTMLDivElement;
const setSource = vi.fn();
async function upload(file: File) {
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
beforeEach(async () => {
  readers.length = 0; setSource.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('FileReader', DeferredReader); vi.stubGlobal('Image', DecodableImage);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const tools = {
    source: { data: 'data:image/png;base64,previous', mimeType: 'image/png', name: 'Previous.png' }, setSource,
    settings: { model: 'gemini-3.1-flash-image-preview', aspectRatio: '16:9', imageSize: '4K', prompt: '' },
    results: [], operation: 'expand', busy: false,
  } as unknown as ImageToolsController;
  await act(async () => root.render(React.createElement(ImageToolsTab, { tools, available: true, onFullscreen: vi.fn(), onRefine: vi.fn() })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('rejects unsupported and oversized uploads without replacing the source', async () => {
  await upload(new File(['text'], 'note.txt', { type: 'text/plain' }));
  expect(host.querySelector('[role=alert]')?.textContent).toContain('до 10 МБ');
  const large = new File(['image'], 'large.png', { type: 'image/png' });
  Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 });
  await upload(large);
  expect(readers).toHaveLength(0); expect(setSource).not.toHaveBeenCalled();
});

it('ignores an earlier upload that finishes after a newer selection', async () => {
  await upload(new File(['one'], 'first.png', { type: 'image/png' }));
  await upload(new File(['two'], 'second.webp', { type: 'image/webp' }));
  await act(async () => readers[1].complete('data:image/webp;base64,second'));
  await act(async () => readers[0].complete('data:image/png;base64,first'));
  expect(setSource).toHaveBeenCalledTimes(1);
  expect(setSource).toHaveBeenCalledWith({ data: 'data:image/webp;base64,second', mimeType: 'image/webp', name: 'second.webp' });
});

it('does not restore a cleared source when the pending file finishes', async () => {
  await upload(new File(['one'], 'first.png', { type: 'image/png' }));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Убрать изображение"]')!.click());
  await act(async () => readers[0].complete('data:image/png;base64,first'));
  expect(setSource).toHaveBeenCalledTimes(1); expect(setSource).toHaveBeenCalledWith(null);
});
