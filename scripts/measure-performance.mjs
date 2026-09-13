import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// Synthetic, isolated, local fixtures only. No user sessions, live APIs or RUM claims.
const { chromium } = await import(process.env.COVER_PLAYWRIGHT_MODULE || 'playwright');
const dist = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
const runs = [];
try {
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const js = new Map(); const apis = []; const errors = []; const media = new Set();
    page.on('pageerror', error => errors.push(error.message));
    const images = Array.from({ length: 240 }, (_, i) => `https://cover-fixture.invalid/fixtures/cover-${i}.svg`);
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.hostname !== 'cover-fixture.invalid') return route.fulfill({ body: '', contentType: 'text/css' });
      const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname.startsWith('/api/')) {
        apis.push({ path: url.pathname, method: request.method() });
        if (url.pathname === '/api/runtime-capabilities') return json({ gemini: true });
        if (url.pathname === '/api/history' || url.pathname === '/api/favorites') return json(images);
        return json(url.pathname.endsWith('choice-notes') ? {} : []);
      }
      if (url.pathname.startsWith('/fixtures/')) {
        media.add(url.pathname);
        return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#526860"/><circle cx="310" cy="270" r="150" fill="#c2b5a0"/></svg>` });
      }
      const file = path.resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      assert.ok(file.startsWith(dist + path.sep));
      const body = await readFile(file);
      if (file.endsWith('.js')) js.set(url.pathname, { bytes: body.length, gzip: gzipSync(body).length });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' }[path.extname(file)];
      return route.fulfill({ body, contentType: type || 'application/octet-stream' });
    });
    const started = performance.now();
    await page.goto('https://cover-fixture.invalid/');
    await page.getByLabel('Промпт', { exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    const initial = { scriptCount: js.size, bytes: [...js.values()].reduce((n, v) => n + v.bytes, 0), gzip: [...js.values()].reduce((n, v) => n + v.gzip, 0), hasGenai: [...js.keys()].some(s => s.includes('vendor-genai')), apis: [...apis], readyWithNetworkIdleMs: Math.round(performance.now() - started) };
    const galleries = {};
    for (const name of ['История', 'Избранное']) {
      const before = performance.now();
      await page.getByRole('tab', { name, exact: true }).click();
      await page.waitForFunction(name => {
        const collection = document.querySelector(`[data-collection="${name === 'История' ? 'history' : 'favorites'}"]`) || [...document.querySelectorAll('.cover-tab-page h2')].find(el => el.textContent === name)?.closest('.cover-tab-page');
        return collection?.querySelector('img[src*="/fixtures/cover-"]') && [...document.querySelectorAll('.studio-main > div')].every(el => getComputedStyle(el).opacity === '1');
      }, name);
      galleries[name] = { switchMs: Math.round(performance.now() - before), ...await page.evaluate(() => ({ nodes: document.querySelector('.studio-main').querySelectorAll('*').length, images: document.querySelectorAll('.studio-main img').length, videos: document.querySelectorAll('.studio-main video').length })) };
      if (run === 0) await page.screenshot({ path: path.join(output, name === 'История' ? 'history.png' : 'favorites.png') });
    }
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(x => ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize'].includes(x.name)).map(x => [x.name, x.value]));
    if (process.argv.includes('--verify')) {
      assert.ok(initial.bytes < 500000, 'Initial JavaScript exceeds the 500KB raw budget');
      assert.ok(initial.gzip < 160000, 'Initial JavaScript exceeds the 160KB gzip budget');
      assert.equal(initial.hasGenai, false, 'Generation SDK must stay deferred until an AI action');
      assert.equal(apis.some(api => api.path.startsWith('/api/video-')), false);
      for (const collection of Object.values(galleries)) { assert.equal(collection.images, 24); assert.ok(collection.nodes < 1000); }
    }
    assert.deepEqual(errors, []);
    runs.push({ initial, galleries, metrics, mediaRequests: media.size, errors });
    await context.close();
  }
} finally { await browser.close(); }
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
const report = { fixtureImages: 240, runs, median: { initialBytes: median(runs.map(r => r.initial.bytes)), initialGzip: median(runs.map(r => r.initial.gzip)), historySwitchMs: median(runs.map(r => r.galleries['История'].switchMs)), favoritesSwitchMs: median(runs.map(r => r.galleries['Избранное'].switchMs)), taskDurationSeconds: median(runs.map(r => r.metrics.TaskDuration)) }, limits: 'Synthetic local assets and 240 fixture images; no network throttling, RUM, real user data, authenticated production or provider calls. Timing is diagnostic, not a CI assertion.' };
await writeFile(path.join(output, 'performance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
