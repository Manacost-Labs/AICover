export const staticAssetCacheOptions = Object.freeze({
  immutable: true,
  maxAge: "365d",
  etag: true,
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
});
