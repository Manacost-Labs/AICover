# BRIA RMBG subject layers

Cover uses BRIA's hosted background-removal endpoint to prepare transparent
subject layers. The browser calls the same-origin
`POST /api/image/remove-background` route; the BRIA credential never leaves the
server.

## Provider contract

- Endpoint: `POST https://engine.prod.bria-api.com/v2/image/edit/remove_background`
- Authentication: the server sends `BRIA_API_TOKEN` in the `api_token` header.
- Request: one JPEG, PNG, or WebP image as raw canonical Base64 (without a
  data-URI prefix), `preserve_alpha: true`, `sync: true`.
- Response: BRIA metadata containing an HTTPS result URL on the verified
  `temp.bria.ai` host, followed by one bounded PNG download. Redirects are
  rejected on both requests.
- Official documentation:
  <https://docs.bria.ai/image-editing/v2-endpoints/background-remove>

The adapter deliberately makes no automatic retry. A timed-out billable
request can have completed upstream, so retrying it could duplicate cost.
Identical concurrent inputs are coalesced instead.

## Server configuration

The default private environment file is `/etc/cover-image/bria.env` and must be
readable only by root. In production, systemd reads it with an `EnvironmentFile`
drop-in and passes the variables to the unprivileged service process. Never add
the token to Vite variables, client code, logs, Git, or Linear.

```dotenv
BRIA_API_TOKEN=replace-on-server
BRIA_RMBG_ENABLED=true
BRIA_RMBG_CACHE_DIR=/var/lib/cover-image/bria-rmbg-cache
BRIA_RMBG_TIMEOUT_MS=120000
BRIA_RMBG_CONCURRENCY=2
BRIA_RMBG_RATE_LIMIT=20
BRIA_RMBG_CACHE_MAX_BYTES=536870912
BRIA_RMBG_CACHE_MAX_ENTRIES=128
BRIA_RMBG_GLOBAL_RATE_LIMIT=30
BRIA_RMBG_GLOBAL_RATE_WINDOW_MS=600000
```

`BRIA_RMBG_ENABLED=true` is an explicit kill switch. Without both the switch
and token, the runtime capability stays disabled and the route returns a stable
503 response.

## Boundaries and cache

- Inputs are decoded and signature-checked before the provider call.
- Maximum decoded input size is 10 MiB; route JSON is capped at 15 MiB.
- Provider metadata and result downloads are read with hard byte limits.
- Result PNGs must have a complete CRC-valid chunk structure, a bounded,
  decodable non-interlaced raster, and both visible and transparent pixels.
  Truncated, fully opaque, and fully transparent provider results are rejected
  before they can enter the cache or compositor.
- Cache keys are versioned SHA-256 hashes of the decoded source bytes.
- Derived layers are stored as mode `0600` JSON files under a mode `0700`
  directory. A cache hit does not call BRIA again.
- Startup verifies cache writability before advertising the runtime capability
  or allowing a paid request. If persistence fails after a paid result arrives,
  that validated result is returned once as `bypass`, then the service fails
  closed before another paid request.
- Cache mutations are serialized and the oldest entries are evicted before the
  512 MiB or 128-entry quota can be exceeded.
- Two request bodies may be admitted concurrently by default; each client IP
  is limited to 20 starts per ten minutes unless configured otherwise.
- A separate provider semaphore is held until paid work settles, even when the
  browser disconnects.
- Only 30 paid cache-miss operations may start globally per ten-minute window
  by default, regardless of client IP. Cache hits do not consume that budget.
- Malformed or oversized JSON is replaced with a body-free error before it can
  reach the shared server logger.

## Product limitation

Background removal is only the subject-isolation stage. Passing a cutout back
to a generative model does not guarantee pixel-identical characters. Exact-art
output still requires deterministic compositing of the original subject pixels
over a separately generated background, plus overlap, anatomy, crop, and empty
space checks.
