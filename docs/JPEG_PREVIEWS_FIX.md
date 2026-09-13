# JPEG generation and full-art source previews

Date: 2026-09-12. Status: deployed and HTTP-verified.

## Scope and provenance

- Candidate: `/srv/projects/web/AI-cover-worktrees/chatgpt-jpeg-previews-20260912`, branch `fix/chatgpt-jpeg-previews`, HEAD `350720e5a28a8a121741345ad52117d8a3836922` plus the imported previous integration source snapshot and this task's uncommitted delta.
- Baseline snapshot: `/srv/projects/web/AI-cover-worktrees/chatgpt-images-integration`. Compare against that snapshot, not HEAD alone: older redesign and ChatGPT integration changes are already uncommitted in the baseline.
- Tracking: [ZUL-8](https://linear.app/zulut/issue/ZUL-8/manacostaistudio-dobavit-scenarii-chatgpt-image-i-grok-imagine-image). Broader integration outcome remains open.
- Task-owned delta: `src/services/chatgptImages.ts`, its test, `src/components/tabs/CreateTab.tsx`, `src/styles/create.css`, `scripts/test-jpeg-previews.mjs` and this document. Backend, dependency manifests, OAuth, sessions, database, production and the previous worktree are unchanged by this slice.
- Profile: `server`. Methods: `test-driven-development`, `frontend-ui-engineering`, canonical `engineering/diagnosing-bugs`. Risk: HIGH; fresh-context Sol review passed, including final CSS alignment follow-up.

## Root cause and correction

The shared browser adapter treated a leading slash as a URL. Valid JPEG base64 commonly starts `/9j/`, so normalized uploaded JPEGs failed before any provider request, producing “Для генерации нужны изображения в формате base64.” in both Create/Scene and Thumbnail.

The adapter now checks the raw base64 alphabet and trailing padding instead of rejecting a leading slash. Existing size limits remain. Server decoding, canonical byte checks, MIME signatures and request limits remain authoritative and unchanged. This is not a change to provider access or OAuth connection behavior.

Two regression tests first reproduced the exact user-visible error in both editors, then passed after the fix. Additional tests retain PNG/WebP support and reject URLs, data URLs, empty input and malformed alphabet/padding.

## Preview changes

- Source images use `object-fit: contain`, with 240px desktop and 220px mobile frames, preserving the whole uploaded image instead of cropping it.
- Cover retains two preview columns rather than squeezing three/four sources into tiny columns.
- Scene role, reorder and remove controls sit outside the artwork. Desktop three-role headers consistently separate labels and action rows; mobile controls retain their 44px targets.
- Source click still opens the original image in the lightbox. Escape, focus return, keyboard move buttons and drag/drop remain functional.
- Generated result dimensions and provider generation settings are unchanged.

## Verification

- `npm test`: PASS, 81 Vitest tests plus 16 native Node backend tests (97 total).
- `npm run build`: PASS. `npm run lint`: PASS (`tsc --noEmit`). `git diff --check`: PASS.
- Existing browser redesign suite: 11 groups PASS, artifacts `/tmp/cover-jpeg-regression`.
- Existing ChatGPT browser suite: 3 groups PASS, artifacts `/tmp/cover-jpeg-chatgpt-regression`.
- New `scripts/test-jpeg-previews.mjs`: 3 groups PASS, final artifacts `/tmp/cover-jpeg-previews-final`. Both themes at 1920, 1440, 1024, 768, 390 and 320px: image loading, contain rendering, >=180px visible image frame, no page overflow or art/control overlap; desktop scene action-row alignment; original lightbox and role manipulation.
- The new browser test creates real JPEG, PNG and WebP files with canvas, uploads them through the editors, validates exact request bytes with the real backend `buildImageRequest` multipart builder, and returns a synthetic result. It does not call a model or use real credentials/user artwork. The screenshot save-warning deliberately exercises a fixture storage failure, not a production storage incident.
- Independent Sol reviewer: PASS with no blocking findings; independently ran 19 client adapter and 6 server image tests and a build. Reviewer browser execution was unavailable without its Playwright module path; the lead executed all browser suites with the installed module. Final scoped desktop-header polish also reviewed PASS.

Browser reproduction command (using the installed Playwright module):

```sh
COVER_PLAYWRIGHT_MODULE=/opt/open-design/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs node scripts/test-jpeg-previews.mjs dist /tmp/cover-jpeg-previews-final
```

## Production activation

The user approved deployment. The frontend-only release was activated at 2026-09-12 08:40:25 UTC under `/run/lock/cover-foundation-release.lock` by atomically replacing only `dist/index.html` after adding immutable assets. No source, backend, configuration, environment, database or storage files were changed; no service restart was performed.

- Previous index SHA256: `f33a4568fa057e67d2a74d1d5e6c93f277803e085f3aa0b075d528bc80400e9e`.
- Active index SHA256: `aea55c85169012e4e2136383c47bcd49f75b342f71190daa322a7ad3b5b13aee`.
- Protected backup: `/var/backups/cover-image/20260912-jpeg-previews-aea55c8`.
- Reviewed retry/rollback script SHA256: `5b663b7f8ebb3b25ee012965a9957e341d59ab43df889bae983594b265aecfb5`.
- `cover-image.service`: active, PID `1422`, `NRestarts=0`, unchanged across deployment.

The first activation attempt exercised the rollback path: all application checks succeeded, but the release script's public-redirect shell `read` received correct values without a trailing newline and returned status 1. The armed handler restored the previous index immediately. The script was corrected to include a newline, add an archive-backed retry path, and re-reviewed. A failure-injection rehearsal then passed failure → automatic rollback → retry → verify → manual rollback before the successful production retry. Both failed and final release scripts remain in the protected backup; no files were deleted.

Post-release verification: archived manifests and every candidate/prior asset match; origin root and all changed JS/CSS files return `200` with the candidate bytes; `/api/health` returns `200` and `{ok:true}`; public root remains `302` to the existing HearthPulse SSO; the service had zero error-priority journal lines in the five-minute release window. Rollback restores only the previous index and intentionally retains immutable assets.

## Remaining boundary

No commit or push was requested or performed. Real end-to-end ChatGPT generation with the user's connected account remains unverified; the reproduced browser validation failure is fixed, production serves the exact browser-tested frontend, and fixture/backend request construction is verified. The user's personal ChatGPT session and actual provider response are outside this credential-free canary.
