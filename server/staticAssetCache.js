import path from "node:path";

const FINGERPRINTED_ASSET = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function cacheControlForAsset(filePath) {
  return FINGERPRINTED_ASSET.test(path.basename(filePath))
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300, must-revalidate";
}

export const staticAssetCacheOptions = Object.freeze({
  cacheControl: false,
  etag: true,
  setHeaders(res, filePath) {
    res.setHeader("Cache-Control", cacheControlForAsset(filePath));
    res.setHeader("X-Content-Type-Options", "nosniff");
  },
});
