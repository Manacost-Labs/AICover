import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelPicker, type ModelOption } from './ModelPicker';

let root: Root, host: HTMLDivElement;
const change = vi.fn();
const options: ModelOption[] = [
  { id: 'first', name: 'Flash', providerName: 'Gemini', logoSrc: '/fixture-gemini.svg', description: 'First description' },
  { id: 'second', name: 'Other model', providerName: 'Another provider', logoSrc: '/fixture-other.png', description: 'Second description' },
  { id: 'disabled', name: 'Unavailable', disabled: true, disabledReason: 'Not enabled' },
];
async function render(value = 'first', disabled = false, choices = options) {
  await act(async () => root.render(React.createElement(ModelPicker, { label: 'Модель', options: choices, value, onChange: change, disabled })));
}
beforeEach(() => { change.mockReset(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('shows native controlled choices with provider images instead of a select', async () => {
  await render();
  expect(host.querySelector('select')).toBeNull();
  expect(host.querySelectorAll('input[type=radio]')).toHaveLength(3);
  expect(host.querySelector<HTMLInputElement>('input[value=first]')!.checked).toBe(true);
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/fixture-gemini.svg');
  await act(async () => host.querySelector<HTMLInputElement>('input[value=second]')!.click());
  expect(change).toHaveBeenCalledWith('second');
  await render('second');
  expect(host.querySelector<HTMLInputElement>('input[value=second]')!.checked).toBe(true);
  expect(host.querySelector('.model-picker__description')?.textContent).toBe('Second description');
});

it('does not select disabled options or mutate a globally disabled picker', async () => {
  await render(); await act(async () => host.querySelector<HTMLInputElement>('input[value=disabled]')!.click());
  expect(change).not.toHaveBeenCalled();
  await render('first', true); await act(async () => host.querySelector<HTMLInputElement>('input[value=second]')!.click());
  expect(change).not.toHaveBeenCalled();
});

it('uses independent radio names in multiple picker instances', async () => {
  await act(async () => root.render(React.createElement('div', null,
    React.createElement(ModelPicker, { label: 'First', options, value: 'first', onChange: change }),
    React.createElement(ModelPicker, { label: 'Second', options, value: 'second', onChange: change }))));
  const groups = host.querySelectorAll('fieldset');
  expect(groups[0].querySelector('input')!.name).not.toBe(groups[1].querySelector('input')!.name);
  expect(host.querySelectorAll('input:checked')).toHaveLength(2);
});

it('supports additional providers and falls back when their image is missing', async () => {
  await render('future', false, [...options, { id: 'future', name: 'Future model', providerName: 'New', logoSrc: '/future.png' }]);
  expect(host.querySelectorAll('input')).toHaveLength(4);
  const img = host.querySelector<HTMLImageElement>('img[src="/future.png"]')!;
  await act(async () => img.dispatchEvent(new Event('error')));
  expect(host.querySelector('img[src="/future.png"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('input[value=future]')!.checked).toBe(true);
  expect(change).not.toHaveBeenCalled();
});
