# Personal ChatGPT image provider — candidate, not deployed

Date: 2026-09-12. Tracking: ZUL-8 (ManacostAIStudio).

User decision: **each person connects their own ChatGPT account**. This is not a
shared subscription/API proxy. The existing Gemini provider, MySQL data,
media storage, history, favorites, and site SSO are unchanged.

## Implementation and boundaries

- `@openai-oauth/core` is pinned to **2.0.0**, with no runtime dependencies or
  install scripts. Inspected upstream revision:
  `ec7dab2fcd8dab9da970a7a2b5dc34046c94905e`.
- Only GPT Image 2 is enabled in the new image transport. Create/Scene and
  the thumbnail-background editor can use it. Size/quality tools stay Gemini:
  this integration does not promise exact upscale dimensions or masked edits.
- Models use the existing logo radio picker. A personal connection is required
  before GPT is selectable; Gemini is unaffected by ChatGPT status.
- Server-only PKCE verifier, access/refresh tokens; opaque Secure/HttpOnly,
  SameSite=Lax cookie scoped to `/api/chatgpt`. No token in frontend JS,
  localStorage, IndexedDB, URLs, logs, or ordinary responses. No access to
  `~/.codex`, installed CLI auth, environment credentials or existing sessions.
- OAuth state is single-use, pending login expires after 10 minutes, cookie
  rotates after login. Mutation requests require the exact configured Origin
  and JSON. No custom upstream URL/model accepted from clients.
- Tokens are held **only in process memory**; an account connection expires
  absolutely after eight hours, and restarts require reconnecting. Expiry is
  checked on each request. No database migration or new secret store.
- Provider identity is scoped to the independent ChatGPT connection cookie,
  **not a Cover SSO principal** (the current Express app has no such principal).
  On shared devices users must disconnect ChatGPT before changing users. This
  does not add per-Cover-user isolation to existing shared galleries/storage.
- Login opens a popup to preserve the editor. Hosted OAuth uses the upstream
  extension relay protocol `oo2_` and `http://localhost:1455/auth/callback`.
  Chrome/Firefox require the user-installed **Sign in with ChatGPT** extension.
  Safari is not supported by upstream. Cover callback is `/chatgpt/callback`.
- Callback code/state are immediately removed from browser history and exchanged
  once via server POST. The callback HTML response uses `Referrer-Policy:
  no-referrer`. Production reverse-proxy access logs must omit/redact callback
  query strings; extension OAuth puts a short-lived code in that initial URL.
- Upstream requests forbid redirects. Refresh pins the account ID; disconnect
  aborts active requests and invalidates pending refresh/exchange completion.
- Limits: 1–4 sequential variants; one active provider request per connection;
  12 image/catalog requests per 10 minutes per connection; bounded login/IP
  buckets and 1,000 connections; 180-second image request timeout. No automatic
  retry on generation, timeout, or rate limit. Cancel stops subsequent variants
  and aborts the local request; an already accepted remote job may continue.
- Images: PNG/JPEG/WEBP with validated magic bytes, up to five inputs,
  10 MiB each and 24 MiB total; 34 MiB JSON parser; bounded upstream response.
  Backend never fetches caller-supplied image URLs. No masks, streaming, or
  arbitrary output URLs. Optional liked examples use remaining reference slots.
- Provider size/quality are `auto`. Desired aspect ratio is a prompt instruction,
  not an exact geometry guarantee. Gemini vision QA is not invoked for GPT.

## Honest model discovery

The upstream compatibility `/models` implementation **inserts `gpt-image-2` even
when absent upstream**. Consequently, connection and model verification are
separate states. The explicit catalog check calls the raw Codex endpoint with a
pinned client version, filters `gpt-image-*` names, and reports unsupported
candidates diagnostically. It neither unlocks them nor creates selectable tiles.
Only successful image generation marks Image 2 verified for this connection.
No real authenticated model discovery or generation has been performed yet.

Sources:

- https://github.com/EvanZhouDev/openai-oauth/blob/ec7dab2fcd8dab9da970a7a2b5dc34046c94905e/packages/core/src/runtime.ts
- https://github.com/EvanZhouDev/openai-oauth/blob/ec7dab2fcd8dab9da970a7a2b5dc34046c94905e/packages/core/src/images.ts
- https://github.com/EvanZhouDev/openai-oauth/blob/ec7dab2fcd8dab9da970a7a2b5dc34046c94905e/packages/web/src/index.ts

## API contract

All routes use `Cache-Control: no-store`; errors are `{error:{code,message}}`
with application-owned safe text, never provider payloads.

| Method/path | Result |
| --- | --- |
| GET `/api/chatgpt/session` | `{enabled,connected,imageVerified}` only |
| POST `/api/chatgpt/login` `{}` | `{authorizationUrl}` + pending opaque cookie |
| POST `/api/chatgpt/callback` `{code,state}` | `{connected:true}` + rotated cookie |
| POST `/api/chatgpt/disconnect` `{}` | Erase this connection, clear cookie |
| POST `/api/chatgpt/models` `{}` | `{models:[{id,supported,verified}]}` |
| POST `/api/chatgpt/images` | Input `{model:'gpt-image-2',prompt,references:[{data,mimeType}]}`; output `{imageUrl}` |

## Activation — requires separate release approval

Nothing in this task activated production. Candidate:
`/srv/projects/web/AI-cover-worktrees/chatgpt-images-integration`, branch
`feature/chatgpt-images-integration`. Based on the previously deployed dirty
`performance-20260911` snapshot, not just git HEAD `350720e`.
The initial working copy `chatgpt-images-20260912` is retained; no user work was
discarded. Final ownership scope was created on a clean worktree **before**
copying the known snapshot because scope guards protect all initial dirty files.

For a separately approved release:

1. Capture exact source/build hashes and backup frontend, server source,
   package manifests and service settings; preserve DB/uploads/old assets.
2. Install the pinned server dependency without executing package scripts.
3. Configure server-only nonsecret settings:
   `COVER_CHATGPT_ENABLED=true`,
   `COVER_CHATGPT_ORIGIN=https://cover.hs-manacost.ru`.
4. Verify existing SSO permits the authenticated `/chatgpt/callback` route,
   redact its query string in proxy logs, preserve the existing SSO gate and
   choose appropriate proxy timeouts for bounded image requests.
5. Publish the coordinated frontend/backend snapshot and restart only the
   Cover service under the existing release lock. **This is not a dist-only
   deployment.** Disabling the flag hides the GPT UI; full rollback restores
   the captured server/dependency/frontend snapshot.
6. Have the user install/confirm the extension and sign in. Verify two real
   accounts cannot affect each other's connection; query the raw model catalog;
   perform an explicitly approved small generate/edit canary and validate
   actual output, history/download and quota errors. No account credentials
   should be supplied in chat.

## Verification

- Canonical `npm test`: 69 Vitest tests + 16 native Node backend tests pass.
  Includes account isolation, replay/wrong-state/expiry/CSRF rejection, refresh
  rotation/account pinning, disconnect races, malformed input/output, no URL
  fetch, sanitized errors, no retries and stopping sequential batches.
- `npm run lint`, `npm run build`, Node syntax checks and `git diff --check` pass.
  One parallel lint/build attempt raced Vite deleting `dist` (baseline TS
  configuration includes it); sequential lint after build passes. No checks
  were weakened. Focused Vitest uses `npx vitest run ...` (do not append test
  filenames to the combined `npm test` shell command).
- Existing 11 browser regression groups passed against the feature-off build.
  Artifacts: `/tmp/cover-chatgpt-regression-final`.
- New offline Chromium popup/login/generation/catalog/429/disconnect scenarios
  passed for both editors with Gemini disabled. Both themes and six viewport
  widths (320–1920) have no horizontal overflow. Artifacts:
  `/tmp/cover-chatgpt-browser-final`. Cancellation stops later thumbnail variants;
  Gemini outage copy does not imply that ChatGPT is unavailable. These use
  fixtures, not live ChatGPT.
- Runtime dependency audit: no high/critical; existing low esbuild and moderate
  qs remain. Full/dev audit also reports existing critical happy-dom and
  moderate Vitest/mock tooling; these versions are unchanged and not shipped
  as runtime dependencies. Never expose test/dev servers to untrusted input;
  major test-tool updates require a separate scoped update.
- Mandatory HIGH-risk fresh-context Sol review: **PASS** after correcting the
  provider-specific outage banner and adding thumbnail cancellation/batch
  validation. Review covered server/session security, transport, frontend and
  regression tests. No blocking findings remain; real account access is unproven.
- Final performance guard: **PASS**, three local runs with 240 fixture images.
  Initial JS is 464,515 bytes / 150,482 gzip (budgets 500,000 / 160,000), no
  initial GenAI SDK load. History/favorites render 24 images, 651/653 DOM nodes,
  zero video requests. Median tab switches: 337/358 ms, diagnostic only.
  Seven initial API reads include the new connection-status request.
  Artifacts: `/tmp/cover-chatgpt-performance-final`. No production/RUM claims.

## Handoff and protected scope

Profile: `server`; methods: API/interface design, security/hardening and
test-driven development. Luna scoped the integration, Terra handled the bounded
frontend slice, and a fresh Sol review passed the completed source revision.

Comparison against the prior `performance-20260911` snapshot: 26 scoped paths
added/modified, 75 source/support paths identical, no removed paths. Existing
release documents, storage implementation and prior unrelated edits are intact.
This comparison deliberately uses the dirty release snapshot, not just HEAD.
Production service, database, uploads and credentials were not changed or used.

Candidate build fingerprints (not production):

- `dist/index.html` SHA-256:
  `f33a4568fa057e67d2a74d1d5e6c93f277803e085f3aa0b075d528bc80400e9e`
- `server/index.js` SHA-256:
  `ea2a3149ef8b81963466841063bedb4a836b5409ef9dc1dd7810475972149490`

Git: no commit, no push. Deployment: no. Real model access: not verified.
