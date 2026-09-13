# Composition Planner release

## Outcome

Cover now prepares one explicit spatial plan before creating a new multi-source image. The plan is shared by Gemini, ChatGPT Image, and all cover-compatible OpenRouter models, so provider changes do not change the meaning of source roles.

The planner asks Gemini Vision to inspect each supplied source and return exactly three candidate layouts. Every candidate describes:

- normalized target box per source;
- foreground, midground, or background depth;
- front-to-back layer order;
- focal priority;
- camera and horizon;
- identity-critical details that must remain visible;
- safe zones for partial occlusion.

User-selected `left`, `center`, and `right` roles remain hard constraints. Invalid JSON, missing sources, duplicate layers, unsafe boxes, or swapped roles are rejected. If Vision is unavailable, generation continues with one of three deterministic layouts instead of blocking the selected image provider.

Existing base-image refinement is intentionally conservative and does not run the new layout planner. A base image already contains an authored composition; silently moving its subjects would change the existing edit UX.

Gemini strict mode also compares the result against the selected plan. It now checks source side, scale, overlap, focal hierarchy, and depth order in addition to identity, environment, and lighting. A failed result receives the same plan during its single surgical refinement pass.

## Why this is the first production slice

The production host has no NVIDIA compute device. Installing SAM 2, Depth Anything 3, Omost, VisionReward, or PaddleOCR on this host would add large CPU/RAM latency and operational risk to an interactive request. This release therefore uses the already configured Gemini Vision path and a bounded local fallback. Dedicated segmentation, depth estimation, OCR, and learned output ranking remain separate GPU-worker candidates.

The implementation follows the structured image-understanding patterns documented by Gemini and sends JSON-only analysis with normalized coordinates. OpenRouter and ChatGPT still receive their image references through their existing adapters; the planner changes only the bounded prompt context and does not alter authentication, sessions, storage, database, or provider billing code.

References:

- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [OpenRouter image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)

## Verification

Focused checks:

```bash
npm exec vitest run src/services/compositionPlanner.test.ts src/services/geminiService.test.ts src/services/chatgptImages.test.ts
node --test scripts/release-composition-planner.test.mjs
npm run lint
```

Final project gate:

```bash
npm test
npm run build
```

## Release and rollback

The release script accepts only a clean worktree whose `HEAD` equals `COVER_RELEASE_COMMIT`. It builds that exact revision, captures the current production `dist`, archives the candidate and evidence, rehearses publish plus rollback in a temporary directory, and activates immutable assets before `index.html`.

This is a frontend-only release. It does not restart `cover-image.service`; live verification requires the service PID, restart counter, protected backend files, and encrypted ChatGPT session-store hash to remain unchanged.

```bash
sudo env COVER_RELEASE_COMMIT=<reviewed-40-char-sha> node scripts/release-composition-planner.mjs capture
sudo env COVER_RELEASE_COMMIT=<reviewed-40-char-sha> node scripts/release-composition-planner.mjs rehearse
sudo env COVER_RELEASE_COMMIT=<reviewed-40-char-sha> node scripts/release-composition-planner.mjs deploy
sudo env COVER_RELEASE_COMMIT=<reviewed-40-char-sha> node scripts/release-composition-planner.mjs verify
```

Rollback uses the same validated archive and refuses unknown file drift:

```bash
sudo env COVER_RELEASE_COMMIT=<reviewed-40-char-sha> node scripts/release-composition-planner.mjs rollback
```
