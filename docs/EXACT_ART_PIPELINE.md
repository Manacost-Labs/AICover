# Exact Art pipeline

`preserveExactArt` separates environment generation from protected character
pixels. It is enabled by default for new Cover scenes and is deliberately not
used for full-frame refinement (`baseImage`).

## Data flow

1. Hydrate each original source and optional composition reference through a
   cancellable 32 MiB streaming limit, normalize it to inline image data, then
   preflight its encoded size, raster dimensions, and full browser decodability
   before any provider call. The editor and storage copies are not modified.
2. Normalize and validate the optional composition reference against the
   selected provider, including any required contact-sheet conversion.
3. Create a request-only copy at or below 10 MiB for BRIA. The original RGB
   remains the compositor source. No paid mask starts until step 2 succeeds.
4. Resolve one `CompositionPlan` with normalized boxes and deterministic
   `zIndex` values.
5. Request a background plate with no figures, bodies, faces, limbs, armor,
   statues, silhouettes, or humanoid shadows. Character art is not sent to the
   background generator.
6. Read the BRIA PNG alpha bounds at a bounded probe resolution.
7. Draw original RGB with uniform scale and translation, apply BRIA with
   Canvas `destination-in`, and place layers back-to-front on the background.
8. Publish only the final PNG. Every completed background is composed and
   persisted before the next paid variant starts. For OpenRouter, this also
   happens before the provider job is acknowledged.

## Provider behavior

- Gemini, ChatGPT, and OpenRouter receive the same background-only contract.
- A user composition reference may be sent as spatial guidance; source
  character images are not sent to the background generator.
- Recraft V4 Styles Pro requires a composition reference in protected mode
  because its reviewed endpoint contract requires at least one image. Known
  provider incompatibilities are rejected before any paid mask request.
- Single-reference OpenRouter providers receive a request-only composition
  sheet bounded by their own model contract (3 MiB for Riverflow).
- If protected mode is disabled, the existing full-frame generation pipeline
  remains available.
- Full-frame refinement intentionally uses the generative edit route; the
  editor hides the exact-art guarantee and says that source pixels may change.
- The editor reads `runtime-capabilities.briaRmbg`; when the server kill switch
  is off, protected generation is blocked with an actionable message while the
  existing full-frame path remains usable.

## Current guarantees

- Visible subject RGB is drawn only from the original source image.
- BRIA contributes alpha only; its RGB is never copied into a subject layer.
- Subjects use uniform scaling, keep their complete alpha bounds, are grounded
  at the bottom of their planned box, and follow planned `zIndex` order.
- Oversized sources are optimized only for mask extraction. The protected RGB
  source is not replaced by that optimized copy.
- Encoded dimensions and full browser decodability are checked for sources and
  the optional composition reference before BRIA, Vision, or background
  generation. Decoded input, output, and Canvas dimensions are bounded before
  surface allocation. Preflight rasters and each original/mask pair are
  released immediately after use.
- Vision receives the same normalized, validated source snapshot as BRIA and
  the compositor; URL-backed art is never hydrated a second time during one
  protected run.
- Browser decoding prefers releasable `ImageBitmap` objects. The fallback
  clears image handlers and sources, while temporary probe, subject, and output
  canvases are shrunk in `finally` blocks to release their backing stores.
- Same-origin and remote stored images are downloaded with cancellation and a
  streaming byte ceiling; a false or missing `Content-Length` cannot bypass the
  limit.
- Cancellation is checked before every background variant and is forwarded to
  Gemini so no later variant is submitted after the user stops the run.
- Parallel mask workers share a terminal-failure signal: an error aborts work
  already in flight and prevents any remaining paid mask request from starting.
- BRIA readiness includes a writable-cache preflight, and only complete,
  decodable PNG cutouts with meaningful alpha occupancy may be cached.

## Remaining gates before production activation

- Benchmark BRIA masks on the agreed Hearthstone-art fixture set.
- Add background-plate vision rejection for unexpected figures or limbs.
- Add face-safe, occupancy, center-gap, occlusion, and provenance QA fixtures.
- Keep the existing strict-QA control out of protected mode until those checks
  exist; the editor must not promise a validation step that the route bypasses.
- Run a manual authenticated canary for each enabled provider and record
  latency/cost before enabling `BRIA_RMBG_ENABLED` in production.
