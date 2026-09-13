# OpenRouter image provider contract

Status: active server-side integration. Capability snapshot rechecked against
the official per-model endpoint API on 2026-09-13.

## Request path and ownership

- The credential is server-owned (`OPENROUTER_API_KEY`) and never enters the
  browser bundle or a public API response.
- `OPENROUTER_ENABLED=true` and a non-empty key are both required.
- The server sends `POST https://openrouter.ai/api/v1/images` and forwards only
  allowlisted fields supported by the selected model.
- The browser starts a same-origin job, polls that exact job, persists the paid
  result before acknowledgement, then deletes the completed job.
- There is no hidden model substitution. An unavailable selected model fails
  explicitly so the user knows which provider needs attention.

Official sources:

- <https://openrouter.ai/docs/guides/overview/multimodal/image-generation>
- <https://openrouter.ai/docs/guides/routing/provider-selection>
- `GET https://openrouter.ai/api/v1/images/models/:author/:slug/endpoints`

## Model matrix

The server profile is deliberately a subset of each live endpoint contract.
The UI may show a smaller common ratio list, while the server remains the final
trust boundary.

| Model ID | References | Resolution | Reference delivery | State |
| --- | ---: | --- | --- | --- |
| `openai/gpt-image-2` | 0–16 | automatic | individual | ready |
| `meta/muse-image` | — | — | contact sheet when available | disabled: no endpoint |
| `recraft/recraft-v4-styles-pro` | 1–10 | automatic | individual | ready |
| `bytedance-seed/seedream-5-0-lite` | 0–14 | 2K, 4K | individual | ready |
| `bytedance-seed/seedream-5-0-pro` | 0–14 | 1K, 2K | individual | ready |
| `x-ai/grok-imagine-image-2.0` | 0–3 | 1K, 2K | individual | ready |
| `qwen/qwen-image-3-pro` | 0–4 | 1K, 2K | individual | ready |
| `krea/krea-2-large` | 0–1 | 1K | labeled contact sheet | ready |
| `sourceful/riverflow-v2.5-pro` | 0–10 | 1K, 2K, 4K | labeled contact sheet | ready |
| `sourceful/riverflow-v2.5-fast` | 0–4 | 1K, 2K | labeled contact sheet | ready |

Krea and Riverflow receive a bounded labeled contact sheet. It preserves every
required source as a separate uncropped panel while staying inside an endpoint
that accepts fewer individual references. Muse remains visible but disabled;
its public endpoint list is empty and Cover must not pretend it is runnable.

## Reliability and safety

- Input PNG/JPEG/WebP is canonical-base64 and magic-byte validated.
- Limits: 10 MiB per source, 24 MiB combined by default, 3 MiB composed input
  for Riverflow, 16 MiB decoded output, 23 MiB streamed upstream envelope.
- Catalog and generation responses are read incrementally with hard byte caps.
- Up to two request bodies and four in-memory jobs are admitted concurrently.
- Completed jobs remain recoverable until acknowledgement or the 15-minute TTL.
- Job ownership is bound to the request identity available to this service.
- Browser messages contain stable public error codes, never provider bodies,
  credentials, prompts, or reference data.

One paid request gets at most two upstream attempts. A retry happens only after
an explicit `429`, `502`, `503`, `524`, or `529`; `Retry-After` is honored and
the delay is capped at five seconds. Timeouts, aborted requests, `400`, `401`,
`402`, `403`, `404`, `413`, `422`, `500`, `504`, invalid successful payloads,
and decoded-result failures are not retried. This avoids duplicate paid work
when completion is ambiguous.

OpenRouter may still have a provider incident after a successful preflight.
Retry reduces short transient failures; it cannot guarantee third-party uptime.

## Drift verification

Run the credential-free contract check while the local Cover service is active:

```bash
node scripts/verify-provider-contracts.mjs
```

The command fails if a selectable OpenRouter model loses its endpoint or an
allowlisted capability, a stable Gemini model stops advertising
`generateContent`, or the installed ChatGPT OAuth adapter changes unexpectedly.
It deliberately fails for a newly appeared Muse endpoint so that enabling it
requires a reviewed contract change.

Focused checks:

```bash
node --test server/openrouter-image.test.js server/openrouter-models.test.js scripts/verify-provider-contracts.test.mjs
npx vitest run src/services/openRouterImages.test.ts src/services/geminiService.test.ts
```
