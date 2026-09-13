import assert from "node:assert/strict";
import test from "node:test";

import { staticAssetCacheOptions } from "./staticAssetCache.js";

test("content-hashed build assets are immutable for one year", () => {
  const headers = new Map();
  staticAssetCacheOptions.setHeaders({
    setHeader(name, value) {
      headers.set(name, value);
    },
  });

  assert.equal(staticAssetCacheOptions.immutable, true);
  assert.equal(staticAssetCacheOptions.maxAge, "365d");
  assert.equal(staticAssetCacheOptions.etag, true);
  assert.equal(headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
});
