import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Isolated build-artifact test. Every request is fulfilled locally: no production,
// credentials, database writes or paid generation. Supply the existing OpenDesign
// Playwright module via COVER_PLAYWRIGHT_MODULE; no dependency is installed here.
const { chromium } = await import(process.env.COVER_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(process.argv[2] || 'dist');
const output = process.argv[3] ? path.resolve(process.argv[3]) : await mkdtemp(path.join(tmpdir(), 'cover-redesign-'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.COVER_CHROMIUM || '/usr/bin/chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const capture = async options => {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.studio-main > div')).every(element => getComputedStyle(element).opacity === '1'));
  // Capture the settled theme, not an intermediate background-color transition.
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
  return page.screenshot(options);
};
const errors = [];
const missing = [];
const checks = [];
let available = true;
let generated = 0;
let saveAttempts = 0;
let collectionFixtures = false;
const videoRequests = [];
const modelRequests = [];
const fixture = (name, color) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="${color}"/><circle cx="290" cy="255" r="150" fill="#c2b5a0"/><path d="M530 395V115L805 395Z" fill="#596e68"/><text x="40" y="500" font-family="sans-serif" font-size="26" fill="white">${name} · offline test fixture</text></svg>`);
const resultImage = fixture('Result', '#303933').toString('base64');
const collectionImages = Array.from({ length: 30 }, (_, i) => `data:image/svg+xml;base64,${fixture(`Cover ${i + 1}`, '#495a57').toString('base64')}`);
const references = Array.from({ length: 7 }, (_, index) => ({ id: `reference-${index}`, name: ['Диалог', 'Центральный герой', 'Дальний план', 'Три персонажа', 'Крупный план', 'Дуэль', 'Симметричная композиция'][index], storageUrl: `data:image/svg+xml;base64,${fixture(`Reference ${index + 1}`, index % 2 ? '#48594f' : '#584e43').toString('base64')}`, storagePath: `fixtures/${index}`, visionAnalysis: 'Fixture composition' }));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  // External fonts are intentionally omitted from this offline fixture.
  if (url.hostname !== 'cover-fixture.invalid') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname.startsWith('/api/video-')) videoRequests.push({ path: url.pathname, method: request.method() });
  if (collectionFixtures && ['/api/history', '/api/favorites'].includes(url.pathname) && request.method() === 'GET') return json(collectionImages);
  if (collectionFixtures && url.pathname === '/api/favorites/choice-notes') return json({ [collectionImages[0]]: JSON.stringify({ summary_ru: 'Сильная композиция', likely_reasons_ru: ['Читаемый силуэт'] }) });
  if (url.pathname === '/api/runtime-capabilities') return json({ gemini: available });
  if (url.pathname === '/api/reference-library') return json(references);
  if (url.pathname.startsWith('/api/gemini/')) {
    const body = request.postDataJSON();
    const image = !!body.generationConfig?.imageConfig;
    if (image) { generated++; modelRequests.push(url.pathname); }
    return json({ candidates: [{ content: { role: 'model', parts: [image ? { inlineData: { mimeType: 'image/svg+xml', data: resultImage } } : { text: '{"pass":true,"issues":[]}' }] }, finishReason: 'STOP' }] });
  }
  if (url.pathname === '/api/history' && request.method() === 'POST') {
    saveAttempts++;
    return json({ error: 'Offline persistence failure fixture' }, 503);
  }
  if (url.pathname.startsWith('/api/')) return json(url.pathname.endsWith('choice-notes') ? {} : []);
  const file = path.resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(dist + path.sep)) return route.abort();
  try { return route.fulfill({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body: await readFile(file) }); }
  catch { missing.push(url.pathname); return route.fulfill({ status: 404, body: 'Missing fixture asset' }); }
});

try {
  // Match the production secure context (crypto.randomUUID), still fully routed offline.
  await page.goto('https://cover-fixture.invalid/');
  await page.getByLabel('Промпт', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 6);
  assert.equal(await page.getByRole('tab', { name: 'Видео', exact: true }).count(), 0);
  assert.equal(await page.getByRole('tab', { name: 'Библиотека', exact: true }).count(), 0);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('15px Manrope', 'Создать обложку')), true);
  assert.ok((await page.locator('.studio-create__rail').boundingBox()).width >= 400);
  assert.equal(await page.getByRole('button', { name: /^Создать \d/ }).isDisabled(), true);
  const createModels = page.locator('.studio-create .model-picker');
  assert.equal(await createModels.getByRole('radio').count(), 3);
  assert.equal(await createModels.locator('select').count(), 0);
  assert.equal(await createModels.locator('img').count(), 3);
  await page.getByRole('combobox', { name: /^Размер/ }).selectOption('512px');
  await createModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).check();
  assert.equal(await page.getByRole('combobox', { name: /^Размер/ }).inputValue(), '1K');
  assert.equal(await page.locator('option[value="512px"]').evaluate(option => option.disabled), true);
  await createModels.getByRole('radio', { name: 'Gemini 2.5 Flash', exact: true }).check();
  await createModels.getByRole('radio', { name: 'Gemini 2.5 Flash', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await createModels.getByRole('radio', { name: 'Gemini 3.1 Flash', exact: true }).isChecked(), true);
  assert.equal(await createModels.getByRole('radio', { name: 'Gemini 3.1 Flash', exact: true }).evaluate(input => document.activeElement === input), true);
  assert.equal(await createModels.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
  await capture({ path: path.join(output, 'desktop-empty-light.png'), fullPage: true });
  checks.push('Six sections; merged image tools; Video/Library pages removed; local Manrope loaded; desktop rail >=400px');

  await page.getByRole('button', { name: /Сохранённые/ }).click();
  await page.getByRole('dialog', { name: 'Выберите композицию' }).waitFor();
  assert.equal(await page.locator('.studio-reference-choice').count(), 7);
  await capture({ path: path.join(output, 'reference-picker-light.png'), fullPage: true });
  await page.getByLabel('Поиск сохранённых референсов').fill('симметричная');
  assert.equal(await page.locator('.studio-reference-choice').count(), 1);
  await page.getByRole('button', { name: 'Выбрать Симметричная композиция' }).click();
  await page.getByRole('button', { name: 'Открыть выбранный референс' }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Выберите композицию' }).isVisible(), false);
  await page.getByRole('button', { name: 'Убрать референс', exact: true }).click();
  await page.getByRole('radio', { name: 'Сцена', exact: true }).click();
  await capture({ path: path.join(output, 'scene-wide-light.png'), fullPage: true });
  await page.getByRole('radio', { name: 'Обложка', exact: true }).click();
  checks.push('Reference picker search reaches seventh entry; selection/clear; wider three-role scene');

  await page.getByRole('tab', { name: 'Создать', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').textContent(), 'Обложка');
  await page.keyboard.press('Enter');
  await page.getByLabel('Точный заголовок обложки').fill('Сохранённый текст');
  assert.equal(await page.getByRole('heading', { name: 'Обложка', exact: true }).count(), 1);
  const coverModels = page.locator('.studio-thumbnail__model-section .model-picker');
  assert.equal(await coverModels.getByRole('radio').count(), 4);
  await coverModels.getByRole('radio', { name: 'Gemini 3.1 Flash Lite', exact: true }).check();
  assert.equal(await page.getByRole('combobox', { name: /^Разрешение/ }).inputValue(), '1K');
  assert.equal(await page.getByRole('combobox', { name: /^Разрешение/ }).isDisabled(), true);
  await coverModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).check();
  assert.equal(await page.getByRole('combobox', { name: /^Разрешение/ }).isEnabled(), true);
  await page.getByRole('combobox', { name: /^Разрешение/ }).selectOption('4K');
  await capture({ path: path.join(output, 'cover-models-light.png'), fullPage: true });
  await page.getByLabel('Загрузить свои игровые арты', { exact: true }).setInputFiles({
    name: 'cover-art.svg', mimeType: 'image/svg+xml', buffer: fixture('Cover art', '#495a57'),
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.studio-thumbnail canvas');
    return canvas?.width === 1280 && canvas?.height === 720 && canvas.getContext('2d').getImageData(640, 360, 1, 1).data[3] > 0;
  });
  const coverDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 1920×1080', exact: true }).click();
  const exportedCover = await coverDownload;
  assert.ok(exportedCover.suggestedFilename().endsWith('.png'));
  const exportedPng = await readFile(await exportedCover.path());
  assert.equal(exportedPng.subarray(1, 4).toString(), 'PNG');
  assert.equal(exportedPng.readUInt32BE(16), 1920);
  assert.equal(exportedPng.readUInt32BE(20), 1080);
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await capture({ path: path.join(output, 'cover-models-dark.png'), fullPage: true });
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Cover overflow at ${width}`);
    assert.equal(await coverModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).isChecked(), true);
  }
  await capture({ path: path.join(output, 'cover-models-mobile-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  checks.push('Cover: both themes; 7 responsive widths; uploaded art renders in canvas; real PNG export is 1920×1080');
  for (const name of ['Размер и качество', 'История', 'Избранное', 'Референсы']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.locator('.studio-main h1').first().waitFor();
    await page.locator('[aria-label="Загрузка"]').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.studio-main h1').first().textContent(), name);
  }
  await page.getByLabel('Поиск референсов', { exact: true }).fill('Дуэль');
  assert.equal(await page.locator('.studio-references-item').count(), 1);
  await page.getByLabel('Поиск референсов', { exact: true }).fill('');
  await capture({ path: path.join(output, 'references-page-light.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Обложка', exact: true }).click();
  assert.equal(await page.getByLabel('Точный заголовок обложки').inputValue(), 'Сохранённый текст');
  assert.equal(await coverModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('combobox', { name: /^Разрешение/ }).inputValue(), '4K');
  checks.push('Keyboard tab navigation; all lazy tabs render; HS editor text survives navigation');

  await page.getByRole('tab', { name: 'Создать', exact: true }).click();
  await page.getByLabel('Промпт', { exact: true }).fill('Собрать два исходника в одну композицию');
  await page.locator('.studio-create input[type=file]').first().setInputFiles([
    { name: 'source-a.svg', mimeType: 'image/svg+xml', buffer: fixture('Source A', '#495a57') },
    { name: 'source-b.svg', mimeType: 'image/svg+xml', buffer: fixture('Source B', '#5b5048') },
  ]);
  await page.getByRole('button', { name: 'Открыть исходник 2', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Создать \d/ }).isEnabled(), true);
  await page.getByLabel('Варианты:', { exact: false }).focus();
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: /Дополнительно/ }).click();
  await page.getByRole('checkbox', { name: /Максимальная точность/ }).uncheck();
  await page.getByRole('button', { name: 'Системный промпт', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '⚙️ Настройки', exact: true }).click();
  const modalModels = page.getByRole('dialog').locator('.model-picker');
  assert.equal(await modalModels.getByRole('radio', { name: 'Gemini 3.1 Flash', exact: true }).isChecked(), true);
  await modalModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).check();
  assert.equal(await createModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).isChecked(), true);
  await capture({ path: path.join(output, 'settings-models-light.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator(':focus').textContent(), 'Системный промпт');
  await page.getByRole('button', { name: /Дополнительно/ }).click();
  await page.getByRole('button', { name: 'Создать 1 вариант', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть вариант 1', exact: true }).waitFor();
  await page.getByText(/Не удалось сохранить/).first().waitFor();
  assert.equal(generated, 1);
  assert.equal(saveAttempts, 1);
  assert.equal(await page.getByRole('button', { name: 'Скачать', exact: true }).isEnabled(), true);
  checks.push('Two-source generation with fixture SDK response; persistence failure keeps result downloadable; dialog Escape returns focus');
  await capture({ path: path.join(output, 'desktop-result-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Включить тёмную тему' }).click();
  assert.equal(await page.getByLabel('Промпт', { exact: true }).inputValue(), 'Собрать два исходника в одну композицию');
  await capture({ path: path.join(output, 'desktop-result-dark.png'), fullPage: true });
  checks.push('Theme switch preserves sources, prompt and result');

  for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Overflow at ${width}`);
    assert.equal(await page.getByRole('button', { name: /^Создать \d/ }).isEnabled(), true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('tab').count(), 6);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Открыть меню');
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('tab', { name: 'Создать', exact: true }).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('.studio-create')?.parentElement;
    return panel && getComputedStyle(panel).opacity === '1';
  });
  await capture({ path: path.join(output, 'mobile-result-dark.png'), fullPage: true });
  await page.getByRole('button', { name: /Сохранённые/ }).click();
  await page.getByRole('dialog', { name: 'Выберите композицию' }).waitFor();
  await capture({ path: path.join(output, 'reference-picker-mobile-dark.png'), fullPage: true });
  const modal = await page.getByRole('dialog', { name: 'Выберите композицию' }).boundingBox();
  assert.ok(modal.x >= 0 && modal.x + modal.width <= 390);
  await page.keyboard.press('Escape');
  assert.ok((await page.locator(':focus').textContent()).includes('Сохранённые'));
  checks.push('No horizontal overflow at 7 widths (320–1920); native mobile modal closes and restores focus');


  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: 'Размер и качество', exact: true }).click();
  await page.getByRole('radio', { name: 'Формат', exact: true }).waitFor();
  const toolModels = page.locator('.image-tools .model-picker');
  await toolModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).check();
  await capture({ path: path.join(output, 'image-tools-empty-dark.png'), fullPage: true });
  const fileInput = page.getByLabel('Файл для обработки', { exact: true });
  await fileInput.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await page.getByRole('alert').filter({ hasText: 'до 10 МБ' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Изменить формат ·/ }).isDisabled(), true);
  await fileInput.setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: 'Открыть исходное изображение', exact: true }).waitFor();
  await page.getByLabel('Соотношение сторон', { exact: true }).selectOption('9:16');
  await page.locator('.image-tools__prompt summary').click();
  await page.getByLabel('Что добавить по краям', { exact: false }).fill('Продолжить фон');
  await page.getByRole('radio', { name: 'Качество', exact: true }).check();
  await page.getByLabel('Желаемое разрешение').selectOption('2K');
  await page.getByRole('radio', { name: 'Формат', exact: true }).check();
  assert.equal(await page.getByLabel('Соотношение сторон', { exact: true }).inputValue(), '9:16');
  assert.equal(await page.getByLabel('Что добавить по краям', { exact: false }).inputValue(), 'Продолжить фон');
  await page.getByRole('button', { name: 'Изменить формат · 9:16', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше: улучшить качество', exact: true }).waitFor();
  await page.getByText('Не удалось сохранить результат на сервере.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Исходник', exact: true }).click();
  assert.equal(await page.locator('.image-tools__preview img').getAttribute('alt'), 'Исходное изображение');
  await page.getByRole('button', { name: 'Результат', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Скачать', exact: true }).click();
  assert.ok((await download).suggestedFilename().endsWith('.svg'));
  await page.getByRole('button', { name: 'Дальше: улучшить качество', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: 'Качество', exact: true }).isChecked(), true);
  assert.equal(await toolModels.getByRole('radio', { name: 'Gemini 3 Pro', exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('Желаемое разрешение').inputValue(), '2K');
  await page.getByRole('button', { name: 'Улучшить качество · 2K', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше: изменить формат', exact: true }).waitFor();
  assert.equal(await page.locator('.image-tools__versions > button').count(), 2);
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await page.getByRole('tab', { name: 'Размер и качество', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше: изменить формат', exact: true }).waitFor();
  assert.equal(await page.locator('.image-tools__versions > button').count(), 2);
  assert.equal(await page.getByRole('radio', { name: 'Качество', exact: true }).isChecked(), true);
  await capture({ path: path.join(output, 'image-tools-result-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Включить светлую тему', exact: true }).click();
  await capture({ path: path.join(output, 'image-tools-result-light.png'), fullPage: true });
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Image tools overflow at ' + width);
  }
  await capture({ path: path.join(output, 'image-tools-mobile-light.png'), fullPage: true });
  checks.push('Unified tools: validates uploads; shared source/settings survive mode and tab changes; expand → upscale chaining; original/result comparison; real download event; save failure keeps result; 7 responsive widths');
  assert.equal(modelRequests.slice(-2).every(url => url.includes('gemini-3-pro-image-preview')), true);
  checks.push('Model logo picker in all four active locations; native arrow navigation; shared modal/Create state; Pro 512px→1K and Thumbnail Lite1K safeguards; loaded local logos; model ID reaches fixture requests');

  collectionFixtures = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.getByLabel('Промпт', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть обложку 1', exact: true }).waitFor();
  assert.equal(await page.locator('.studio-collection img').count(), 24);
  assert.equal(await page.locator('.studio-collection video').count(), 0);
  assert.equal(await page.getByRole('tab', { name: 'Видео', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  assert.equal(await page.locator('.studio-collection img').count(), 6);
  await page.getByRole('button', { name: 'Открыть обложку 25', exact: true }).click();
  await page.getByRole('dialog', { name: 'Просмотр изображения', exact: true }).waitFor();
  await page.getByText('25 / 30', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Следующее', exact: true }).click();
  await page.getByText('26 / 30', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog', { name: 'Просмотр изображения', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await page.getByRole('tab', { name: 'Избранное', exact: true }).click();
  await page.getByRole('button', { name: 'Почему этот кадр', exact: true }).click();
  await page.getByRole('dialog', { name: 'Почему этот кадр', exact: true }).waitFor();
  await page.getByText('Сильная композиция', { exact: false }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  assert.equal((await page.locator(':focus').textContent()).trim(), 'Почему этот кадр');
  const collectionDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать обложку', exact: true }).first().click();
  assert.equal((await collectionDownload).suggestedFilename(), 'cover.png');
  await capture({ path: path.join(output, 'favorites-gallery-light.png') });
  await page.getByRole('button', { name: 'Включить тёмную тему', exact: true }).click();
  await capture({ path: path.join(output, 'favorites-gallery-dark.png') });
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Collection overflow at ' + width);
  }
  await capture({ path: path.join(output, 'favorites-gallery-mobile-dark.png') });
  assert.equal(await page.locator('.studio-panel-enter').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(videoRequests, []);
  checks.push('Image-only History/Favorites: bounded pages reach last image; full lightbox navigation; native note dialog Escape/focus; download; both themes/7 widths; reduced motion; zero video API reads/writes');

  available = false;
  await page.reload();
  await page.getByText(/Генерация.*недоступна/i).first().waitFor();
  assert.equal(await page.getByRole('button', { name: /^Создать \d/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('tab', { name: 'История', exact: true }).click();
  assert.equal(await page.locator('.studio-main h1').first().textContent(), 'История');
  checks.push('Unavailable provider does not block history/navigation');
  assert.deepEqual(errors, []);
  assert.deepEqual(missing, []);
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, missing, generated, saveAttempts, network: 'All requests fulfilled from local dist and fixtures; no live flow tested' }, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  console.error(JSON.stringify({ errors, missing, text: (await page.locator('body').innerText()).slice(0, 4000) }));
  throw error;
} finally {
  await browser.close();
}
