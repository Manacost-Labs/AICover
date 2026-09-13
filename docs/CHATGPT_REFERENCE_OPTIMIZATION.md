# ChatGPT oversized reference optimization

Date: 2026-09-12. Status: verified local candidate, **not deployed**.

## User symptom and root cause

After the JPEG-prefix correction reached production, a user still received “Каждое изображение должно быть не больше 10 МиБ.” The exact message is emitted by the browser adapter before `/api/chatgpt/images`. The adapter's base64-to-byte formula is correct, including the exact 10 MiB boundary; the remaining path is a genuinely oversized decoded image rather than base64's 4/3 transport expansion.

A minimal test with one syntactically valid reference at `10 MiB + 1 byte` reproduced the exact rejection before any fetch. It failed before the fix and passed after it.

## Behavior

The shared ChatGPT image adapter now prepares references before validation and upload:

- References already within both the 10 MiB per-file and 24 MiB aggregate limits remain byte-for-byte and MIME-for-MIME unchanged.
- A larger reference is decoded locally, proportionally resized and re-encoded with browser canvas. WebP is requested; a browser PNG/JPEG fallback remains accepted.
- Multiple individually valid references are also optimized when their aggregate decoded size exceeds 24 MiB. Small files keep their original bytes; only the larger files share the remaining budget.
- Work is sequential. Inputs eligible for automatic optimization are capped at 32 MiB each, dimensions are read before decode, and `createImageBitmap` receives a proportional 4096px-bounded decode target where supported. Quality and dimensions are reduced further only if needed.
- Input MIME and decoded signatures must agree with the server's PNG/JPEG/WebP contract. The older `Image` fallback refuses unknown headers and images above 32 million pixels before creating an object URL.
- A reference set is prepared once and reused for all 1–4 generated variants.
- Abort state is observed during chunked base64 conversion, image decode and canvas encode; the bitmap or fallback object URL is released. Decode/encode failure returns a user-safe instruction to use PNG, JPG or WebP.
- The server's decoded-byte, canonical base64, MIME-signature, per-file, aggregate and fixed-model checks remain unchanged and authoritative.

No user file is uploaded anywhere for this optimization step. It happens inside the user's browser immediately before the existing same-origin request.

## Scope

- Candidate: `/srv/projects/web/AI-cover-worktrees/chatgpt-auto-optimize-20260912`, branch `fix/chatgpt-auto-optimize-references`, HEAD `350720e5a28a8a121741345ad52117d8a3836922` plus the imported deployed snapshot and this narrow uncommitted delta.
- Functional delta versus `/srv/projects/web/AI-cover-worktrees/chatgpt-jpeg-previews-20260912`: the shared ChatGPT adapter and its two batch callers, focused client/server boundary tests, the existing JPEG browser script and this note.
- No backend runtime, provider, OAuth, session, database, storage, dependency, visual layout or production configuration change.
- Tracking: [ZUL-8](https://linear.app/zulut/issue/ZUL-8/manacostaistudio-dobavit-scenarii-chatgpt-image-i-grok-imagine-image).

## Verification

- TDD red: the focused test rejected `10 MiB + 1 byte` with the user's exact message before the fix.
- `npm test`: PASS, 92 Vitest tests plus 17 native Node backend tests (109 total, none skipped).
- `npm run build`, `npm run lint` and `git diff --check`: PASS.
- Focused adapter suite: 30 PASS. It covers one oversized reference, asymmetric and aggregate budgets, exact 10 MiB preservation, the 32 MiB source cap, bounded decode/fallback pixels, MIME/signature spoofing, both decode cancellation paths, one-time batch preparation, invalid base64/URL input and unchanged small JPEG/PNG/WebP data.
- Final oversized browser suite: PASS. A real, decodable JPEG larger than 10 MiB is uploaded through the editor, re-encoded in 196 ms below the limit, accepted by the real backend multipart builder and reaches the fixture provider boundary without the old error. No external provider or credentials are used.
- Existing ChatGPT browser suite: 3 groups PASS. Existing redesign/browser suite: 11 groups PASS.
- Performance budget: PASS. Initial JS `469770` raw / `152494` gzip, below the existing `500000` / `160000` fixture thresholds; the generation SDK remains deferred.
- Browser artifacts: `/tmp/cover-auto-optimize-final2-large`, `/tmp/cover-auto-optimize-final2-chatgpt`, `/tmp/cover-auto-optimize-final2-redesign`, `/tmp/cover-auto-optimize-final2-performance`.

## Remaining boundary

No commit, push or production activation was requested or performed for this candidate. A real upstream ChatGPT generation still requires the user's connected account; browser verification uses local fixtures but exercises actual image decoding, canvas encoding and server multipart construction.
