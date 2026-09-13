import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import express from "express";

import { cacheControlForAsset, staticAssetCacheOptions } from "./staticAssetCache.js";

test("only fingerprinted build assets are immutable", () => {
  assert.equal(cacheControlForAsset("/dist/assets/index-AbCd1234.js"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlForAsset("/dist/assets/manrope-variable-FzEoaBTQ.ttf"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlForAsset("/dist/assets/frames/main-page-rail-border.png"), "public, max-age=300, must-revalidate");
});

test("Express serves fingerprinted and mutable assets with different policies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cover-static-cache-test-"));
  await fs.mkdir(path.join(root, "frames"));
  await fs.writeFile(path.join(root, "index-AbCd1234.js"), "export default true;");
  await fs.writeFile(path.join(root, "frames/main-page-rail-border.png"), "fixture");
  const app = express();
  app.use("/assets", express.static(root, staticAssetCacheOptions));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const fingerprinted = await fetch(`${origin}/assets/index-AbCd1234.js`);
    const mutable = await fetch(`${origin}/assets/frames/main-page-rail-border.png`);
    assert.equal(fingerprinted.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(mutable.headers.get("cache-control"), "public, max-age=300, must-revalidate");
    assert.equal(fingerprinted.headers.get("x-content-type-options"), "nosniff");
    assert.equal(mutable.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
