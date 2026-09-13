# Image provider reliability baseline

Checked: 2026-09-13. This document fixes the request contract used by Cover; it
does not promise permanent availability of third-party infrastructure.

## Gemini

Primary source: <https://ai.google.dev/gemini-api/docs/image-generation>.
Troubleshooting source: <https://ai.google.dev/gemini-api/docs/troubleshooting>.

| Model | Size exposed by Cover | Ratios exposed by Cover | Reference policy |
| --- | --- | --- | --- |
| `gemini-2.5-flash-image` | 1K | standard ratios | required images kept; optional quality examples capped so the request stays near the documented three-image best practice |
| `gemini-3.1-flash-image` | 512px, 1K, 2K, 4K | standard + 1:4, 1:8, 4:1, 8:1 | up to 14 total inputs in the documented workflow |
| `gemini-3-pro-image` | 1K, 2K, 4K | standard ratios | up to 14 total inputs in the documented workflow |
| `gemini-3.1-flash-lite-image` | 1K | fixed 16:9 in the HS thumbnail workflow | game assets supplied inline |

Cover uses the stable image model IDs rather than preview aliases. Capability
normalization runs both when a user changes a model and immediately before a
Gemini generation. The latter prevents stale UI state or a direct call from
sending an unsupported size or aspect ratio.

All generation prompts keep user instructions as `USER`/guidance text and send
source art as inline image parts. Composition references are analyzed as
spatial guidance; source art remains the identity authority. Upscale and
outpaint normalize URL-backed stored images to inline base64 before generation.

## ChatGPT GPT Image 2

Integration source: <https://github.com/EvanZhouDev/openai-oauth/blob/main/README.md>.
This is a third-party OAuth adapter, not an official OpenAI SDK or OpenAI product
guarantee. Cover pins `@openai-oauth/core` to `2.0.0`, uses the documented image
generation/edit routes, sends references as edit inputs, and does not request
unsupported streaming, masks, variations, or custom output formats.

Every user connects their own ChatGPT session. Sessions are encrypted at rest,
bound to Cover's authenticated browser cookie, restored after service restart,
and never returned as raw tokens. Server-side automated tests can verify the
adapter and persistence contracts, but a live ChatGPT generation requires a
real user-connected browser session and must remain a manual canary.

## OpenRouter

See [OPENROUTER_IMAGES.md](./OPENROUTER_IMAGES.md) for the per-model matrix,
reference packaging, bounded retry policy, and drift verifier.

## Release gate

Before production:

1. `npm test`, `npm run lint`, and `npm run build` pass.
2. `node scripts/verify-provider-contracts.mjs` passes against current public
   endpoint metadata and the local same-origin Gemini proxy.
3. The exact candidate revision passes an independent CRITICAL review.
4. Release capture and isolated rehearsal prove backup and rollback behavior.
5. Production activation is atomic and preserves database, uploads, keys, and
   encrypted ChatGPT sessions.
6. Health, runtime capabilities, service stability, and minimal paid canaries
   are recorded separately from source/build success.

Release commands require `COVER_RELEASE_COMMIT=<40-character reviewed SHA>`.
Capture rebuilds `dist` from that exact clean revision under the source owner,
records Node/npm/lockfile provenance and rechecks HEAD after the build. The same
SHA pin is required again for rehearsal, deployment, verification, and rollback.
Provider metadata is captured before activation; rollback health checks remain
independent of third-party metadata availability.
