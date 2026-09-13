# OpenRouter image provider foundation

Status: implementation candidate only. It is not activated in the Cover UI and
has not been deployed. No paid OpenRouter request was made during validation.

## Provider contract

- Server-owned credential: `OPENROUTER_API_KEY`; it is never returned by an API
  response or included in the browser bundle.
- Strict server allowlist: the browser may select only a verified model ID; it
  cannot send an arbitrary provider slug or provider-specific options.
- Fail-closed activation: both `OPENROUTER_API_KEY` and
  `OPENROUTER_ENABLED=true` are required. Key presence alone does not activate
  the UI or the paid endpoint.
- Upstream endpoint: `POST https://openrouter.ai/api/v1/images`.
- Browser contract:
  - `POST /api/thumbnail/openrouter-generate` starts one job and is never retried
    automatically;
  - `GET /api/thumbnail/openrouter-jobs/:jobId` polls the same job;
  - `DELETE /api/thumbnail/openrouter-jobs/:jobId` acknowledges a received
    result and releases it;
  - `/api/runtime-capabilities` exposes only `openrouter: boolean`.
- Official attribution headers are `HTTP-Referer` and `X-OpenRouter-Title`.

OpenRouter references:

- <https://openrouter.ai/docs/guides/overview/multimodal/image-generation>
- <https://openrouter.ai/api/v1/images/models>

## Verified model catalog

Snapshot checked against the official Image Models API on 2026-09-12. Every
request is reduced to parameters declared for that specific model.

| Model ID | References | Resolution | Cover composer |
| --- | ---: | --- | --- |
| `openai/gpt-image-2` | 0–16 | provider default | ready |
| `meta/muse-image` | not declared | provider default | visible, disabled |
| `recraft/recraft-v4-styles-pro` | 1–10 | provider default | ready |
| `bytedance-seed/seedream-5-0-lite` | 0–14 | 2K, 4K | ready |
| `bytedance-seed/seedream-5-0-pro` | 0–14 | 1K, 2K | ready |
| `x-ai/grok-imagine-image-2.0` | 0–3 | 1K, 2K | ready |
| `qwen/qwen-image-3-pro` | 0–4 | 1K, 2K | ready |
| `krea/krea-2-large` | 0–1 | 1K | visible, disabled |
| `sourceful/riverflow-v2.5-pro` | 0–10 | 1K, 2K, 4K | ready |
| `sourceful/riverflow-v2.5-fast` | 0–4 | 1K, 2K | ready |

Muse is disabled because the catalog does not declare `input_references`.
Krea is disabled because the current Cover composer requires at least two
source images while that endpoint declares one reference at most. This is a UX
compatibility boundary, not a claim that either model is unavailable upstream.

## Implemented security boundaries

- inline PNG/JPEG/WebP references with model-specific ceilings from the
  official catalog (up to 16), while
  the existing 10 MiB-per-image and 24 MiB-total limits remain global;
- strict canonical base64 and MIME magic-byte validation;
- 10 MiB per decoded image and 24 MiB decoded total;
- a route-specific 34 MiB JSON ceiling applied before the legacy parser;
- at most two request bodies admitted through parsing and response completion
  at once, after the rate-limit check;
- 16 MiB decoded output ceiling and a 23 MiB streamed upstream-response ceiling;
- at most four in-memory jobs; paid results remain pollable until client
  acknowledgement or the 15-minute TTL;
- job polling is bound to the request IP in addition to an unguessable UUID;
- provider errors and response bodies are not exposed to the browser;
- the billable start request is not automatically retried.

## Activation hold

The existing edge SSO protects the application, but the Node service does not
yet receive a stable authenticated user identifier. IP binding is a secondary
boundary, not a billing identity: users behind one NAT can share an IP and
addresses can change.

Before enabling the OpenRouter model in the UI, choose and implement one of:

1. a trusted HearthPulse user identity forwarded to the service, with per-user
   quotas and audit records; or
2. user-owned OpenRouter credentials (BYOK), encrypted at rest with an explicit
   revoke flow.

The current server-owned-key path must not be presented as “each user connects
their own ChatGPT”. ChatGPT OAuth and OpenRouter are separate providers and
separate billing boundaries.

## Verification

- `node --test server/openrouter-image.test.js`
- `npx vitest run src/services/openRouterImages.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`

Production activation additionally requires a fresh CRITICAL security review,
a cost-bounded canary, and a tested rollback. A model appearing in the catalog
does not by itself prove reference editing or transparent-background quality.
