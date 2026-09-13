import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.COVER_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(process.argv[2] || 'dist');
const output = path.resolve(process.argv[3] || '/tmp/cover-chatgpt-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
const origin = 'https://cover-fixture.invalid';
const errors = [], checks = [], requests = [];
let connected = false, imageVerified = false, imageStatus = 200, png = '', holdImage = false, releaseImage;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.origin === 'https://auth.openai.com') return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(origin + '/chatgpt/callback?code=fixture&state=fixture-state')})</script>` });
  if (url.origin !== origin) throw new Error(`Unexpected external request ${url.origin}`);
  if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, method: req.method(), body: req.postData() });
  if (url.pathname === '/api/chatgpt/session') return json({ enabled: true, connected, imageVerified });
  if (url.pathname === '/api/chatgpt/login') return json({ authorizationUrl: 'https://auth.openai.com/oauth/authorize?state=fixture-state' });
  if (url.pathname === '/api/chatgpt/callback') { connected = true; return json({ connected }); }
  if (url.pathname === '/api/chatgpt/disconnect') { connected = false; imageVerified = false; return json({ connected }); }
  if (url.pathname === '/api/chatgpt/models') return json({ models: [{ id: 'gpt-image-2', supported: true, verified: imageVerified }, { id: 'gpt-image-next', supported: false, verified: false }] });
  if (url.pathname === '/api/chatgpt/images') {
    const body = req.postDataJSON();
    assert.equal(body.model, 'gpt-image-2');
    assert.ok(body.references.length > 0 && body.references.length <= 5);
    assert.ok(body.references.every(item => item.mimeType === 'image/png' && !item.data.startsWith('http')));
    if (imageStatus !== 200) return json({ error: { code: 'CHATGPT_LIMIT', message: 'fixture-private-detail' } }, imageStatus);
    if (holdImage) await new Promise(resolve => { releaseImage = resolve; });
    imageVerified = true; return json({ imageUrl: `data:image/png;base64,${png}` });
  }
  if (url.pathname === '/api/runtime-capabilities') return json({ gemini: false });
  if (url.pathname.startsWith('/api/gemini')) throw new Error('GPT path called Gemini');
  if (url.pathname === '/api/history' && req.method() === 'POST') return json({ error: 'fixture-storage-failure' }, 503);
  if (url.pathname.startsWith('/api/')) return json(url.pathname.endsWith('choice-notes') ? {} : []);
  const relative = url.pathname === '/' || url.pathname === '/chatgpt/callback' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(dist, '.' + relative);
  assert.ok(file.startsWith(dist + path.sep));
  await route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: await readFile(file) });
});
try {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  const gpt = page.getByRole('radio', { name: 'ChatGPT GPT Image 2', exact: true });
  await gpt.waitFor();
  assert.equal(await gpt.isDisabled(), true);
  await page.getByLabel('Промпт', { exact: true }).fill('Сохранить мой незаконченный промпт');
  png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#aec7a7'; ctx.fillRect(0, 0, 320, 180); return canvas.toDataURL('image/png').split(',')[1]; });
  await page.locator('.studio-create input[type=file]').first().setInputFiles([0, 1].map(i => ({ name: `source-${i}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await page.getByRole('button', { name: 'Открыть исходник 2', exact: true }).waitFor();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForEvent('close');
  await page.getByRole('button', { name: 'Отключить', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Промпт', { exact: true }).inputValue(), 'Сохранить мой незаконченный промпт');
  assert.equal(requests.filter(req => req.path === '/api/chatgpt/callback').length, 1);
  assert.equal(await gpt.isEnabled(), true);
  await gpt.check();
  assert.equal(await page.getByRole('combobox', { name: /^Размер/ }).inputValue(), 'auto');
  assert.equal(await page.getByRole('combobox', { name: /^Размер/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Создать 1 вариант', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть вариант 1', exact: true }).waitFor();
  await page.getByText('Генерация GPT Image 2 проверена в этой сессии.').waitFor();
  assert.equal(requests.filter(req => req.path === '/api/chatgpt/images').length, 1);
  checks.push('Popup fixture sign-in preserves editor; one callback; GPT generates without Gemini; valid result remains downloadable after save failure');
  await page.getByText('Другие модели изображений', { exact: true }).click();
  await page.getByRole('button', { name: 'Проверить каталог', exact: true }).click();
  await page.getByText(/Каталог вернул: gpt-image-2, gpt-image-next/).waitFor();
  assert.equal(await page.getByRole('radio', { name: /gpt-image-next/ }).count(), 0);
  await page.screenshot({ path: path.join(output, 'gpt-create-light.png'), fullPage: true });
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: theme === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему', exact: true }).click();
    for (const width of [1920, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} overflow ${width}`);
    }
    await page.screenshot({ path: path.join(output, `gpt-create-mobile-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  checks.push('Discovery lists unverified candidates without fake model options; light/dark and 6 widths have no overflow');
  imageStatus = 429;
  await page.getByRole('button', { name: 'Создать 1 вариант', exact: true }).click();
  await page.getByText('Достигнут лимит ChatGPT. Попробуйте позже.', { exact: true }).waitFor();
  assert.equal(await page.getByText('fixture-private-detail').count(), 0);
  assert.equal(requests.filter(req => req.path === '/api/chatgpt/images').length, 2);
  imageStatus = 200;
  await page.getByRole('tab', { name: 'Обложка', exact: true }).click();
  await page.getByText('Gemini временно недоступен', { exact: true }).waitFor();
  assert.equal(await page.getByText('Генерация временно недоступна', { exact: true }).count(), 0);
  await page.getByRole('radio', { name: 'ChatGPT GPT Image 2', exact: true }).check();
  await page.getByLabel('Загрузить свои игровые арты', { exact: true }).setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByRole('combobox', { name: /^Варианты/ }).selectOption('1');
  await page.getByRole('button', { name: 'Создать фон', exact: true }).click();
  await page.getByRole('button', { name: 'Создать фон', exact: true }).waitFor();
  assert.equal(requests.filter(req => req.path === '/api/chatgpt/images').length, 3);
  holdImage = true;
  await page.getByRole('combobox', { name: /^Варианты/ }).selectOption('4');
  const requestStarted = page.waitForRequest(request => request.url().endsWith('/api/chatgpt/images'));
  await page.getByRole('button', { name: 'Создать фон', exact: true }).click();
  await requestStarted;
  await page.getByRole('button', { name: 'Остановить GPT', exact: true }).click();
  await page.getByText(/Ожидание остановлено. Следующие варианты не отправлены/).waitFor();
  releaseImage();
  assert.equal(requests.filter(req => req.path === '/api/chatgpt/images').length, 4);
  await page.getByRole('button', { name: 'Отключить', exact: true }).click();
  await page.getByRole('button', { name: 'Подключить', exact: true }).waitFor();
  assert.equal(await page.getByRole('radio', { name: 'ChatGPT GPT Image 2', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Создать фон', exact: true }).isDisabled(), true);
  checks.push('429 has safe copy/no retries; thumbnail GPT generation works; cancel stops subsequent variants; provider-specific banner; disconnect disables generation');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, imageRequests: requests.filter(req => req.path === '/api/chatgpt/images').length }, null, 2));
  console.log(JSON.stringify({ checks, output }, null, 2));
} finally { await browser.close(); }
