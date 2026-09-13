import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImageRequest, readImageResponse, readBoundedJson, discoverImageModels } from './chatgpt-images.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVioAAAAASUVORK5CYII=';

test('generation and editing use a fixed image model, not caller-controlled endpoints or options', () => {
  const plain = buildImageRequest({ model: 'gpt-image-2', prompt: 'A quiet forest', size: '8K' });
  assert.equal(plain.path, '/images/generations');
  assert.deepEqual(JSON.parse(plain.body), { model: 'gpt-image-2', prompt: 'A quiet forest', n: 1, size: 'auto', quality: 'auto', background: 'opaque' });
  const edit = buildImageRequest({ model: 'gpt-image-2', prompt: 'Edit', references: [{ data: png, mimeType: 'image/png' }] });
  assert.equal(edit.path, '/images/edits');
  assert.equal(edit.body.get('image[]').type, 'image/png');
  assert.throws(() => buildImageRequest({ model: 'gpt-5.6-sol', prompt: 'x' }), /модель/);
});

test('rejects URL references, SVG, invalid base64, spoofed MIME, too many references and blank prompt', () => {
  for (const reference of [
    { data: 'https://localhost/private', mimeType: 'image/png' },
    { data: png, mimeType: 'image/svg+xml' },
    { data: 'not+base64!', mimeType: 'image/png' },
    { data: png, mimeType: 'image/jpeg' },
  ]) assert.throws(() => buildImageRequest({ prompt: 'x', references: [reference] }));
  assert.throws(() => buildImageRequest({ prompt: 'x', references: Array(6).fill({ data: png, mimeType: 'image/png' }) }));
  assert.throws(() => buildImageRequest({ prompt: ' ' }));
});

test('rejects oversized reference input before constructing a provider request', () => {
  const oversizedPng = Buffer.concat([Buffer.from(png, 'base64'), Buffer.alloc(10 * 1024 * 1024)]).toString('base64');
  assert.throws(
    () => buildImageRequest({ prompt: 'x', references: [{ data: oversizedPng, mimeType: 'image/png' }] }),
    /слишком большое|больше 10/i,
  );
});

test('accepts a canonical JPEG exactly at the ten MiB reference boundary', async () => {
  const exactJpeg = Buffer.alloc(10 * 1024 * 1024);
  exactJpeg.set([0xff, 0xd8, 0xff]);
  const encoded = exactJpeg.toString('base64');
  assert.equal(encoded.length % 4, 0);
  assert.match(encoded, /==$/);

  const request = buildImageRequest({
    prompt: 'x',
    references: [{ data: encoded, mimeType: 'image/jpeg' }],
  });
  assert.equal(request.path, '/images/edits');
  assert.equal((await request.body.get('image[]').arrayBuffer()).byteLength, 10 * 1024 * 1024);
});

test('only returns validated inline images, never arbitrary provider URLs/errors', async () => {
  assert.equal(await readImageResponse(Response.json({ data: [{ b64_json: png }] })), `data:image/png;base64,${png}`);
  await assert.rejects(readImageResponse(Response.json({ data: [{ url: 'http://localhost/private' }] })), /изображение/);
  await assert.rejects(readImageResponse(Response.json({ error: { message: 'secret-upstream-detail' } }, { status: 401 })), error => error.status === 401 && !error.message.includes('secret'));
});

test('catalog separates image candidates from text models and does not imply working access', () => {
  const models = discoverImageModels({ models: [{ slug: 'gpt-5.6-sol' }, { slug: 'gpt-image-2' }, { slug: 'gpt-image-next' }] });
  assert.deepEqual(models, [
    { id: 'gpt-image-2', supported: true, verified: false },
    { id: 'gpt-image-next', supported: false, verified: false },
  ]);
  assert.deepEqual(discoverImageModels({ models: [{ slug: 'gpt-5.6-sol' }] }), []);
});

test('provider JSON must be bounded and valid before any response is trusted', async () => {
  await assert.rejects(
    readBoundedJson(new Response('not-json')),
    error => error.status === 502 && !error.message.includes('not-json'),
  );
  await assert.rejects(
    readBoundedJson(new Response('x'.repeat(1025)), 1024),
    error => error.status === 502,
  );
});
