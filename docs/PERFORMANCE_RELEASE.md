# Cover — image-only collections, performance and motion

## Scope and direction

2026-09-11. Candidate: /srv/projects/web/AI-cover-worktrees/performance-20260911,
branch redesign-performance-20260911, HEAD350720e. Starting source is the exact
deployed model-picker-20260911 frontend; the initial src comparison was identical.
Earlier worktrees, their uncommitted changes and backups remain untouched.
User authorized removing video from History/Favorites UI, optimization/design,
and explicitly approved this slice's production deployment. No commit/push request.

Audit: History/Favorites duplicated the screen title, showed obsolete video
selectors, rendered all images, animated every card and hid actions behind hover.
App loaded three unused video collections; startup eagerly fetched the AI SDK.
Tab exit-before-enter added latency. Lightbox navigation temporarily mounted two
dialogs and recreated the body scroll lock on every image.

Keep the product's warm-neutral/soft-green palette and Manrope typography:
page #f3f4f1, surface #fcfdfb, raised #ffffff, text #303b34, accent #456b56;
dark equivalents come from existing cover-tokens.css. Screen title stays 26/34,
collection text 14/22, utility counts 13px tabular. Spacing4/8/12/16/20/24;
radii5/8/10, dialogs12. Signature: images form the main gallery, with a quiet
always-visible action strip and true position numbers. No new gradients/glow,
hover zoom, card shadows or decorative headings. Photos are contained, not cropped.

## Changes

- Remove video UI, video root state/callbacks and 3 startup reads. No server,
  video storage methods, records, files or fusion_video_* keys are deleted/changed.
- Shared ImageCollection mounts24 images per page. All items remain reachable;
  page clamps when removing the final item. Full lightbox navigation still spans
  the complete collection. API payload pagination is not changed in this slice.
- Actions below the image work on touch and keyboard. Stable preview dimensions,
  native lazy loading and async decoding avoid relayout of the gallery.
- Image history clear makes one request (previously two), reports failures and
  only clears visible items after success. Existing storage implementation remains.
- Favorite explanations use a native dialog: focus containment/Escape/return focus.
- AI SDK loads on the first AI action, with one shared import promise and retry
  after import failure. Call sites await it; model IDs/config/proxy remain unchanged.
- Immediate section replacement with a short140ms opacity entrance, no exit wait;
  CSS entrance disabled for reduced-motion, MotionConfig respects user preference.
- Stable ImageLightbox instance during next/previous navigation, preserving scroll
  lock and clearing annotations/drawing state on the new image.

## Measurement

Same built-app Chromium harness, three fresh isolated contexts per version,
1440×1000 and240 fixture images. Every request is answered locally. No credentials,
production data, paid provider, RUM, CrUX or real-user Web Vitals were accessed.
Timing includes browser automation/animation overhead; it is diagnostic, not an SLA.
Gzip values are computed from requested scripts, not measured production transfer.

| Metric | Before | After |
| --- | ---: | ---: |
| Initial requested JavaScript, bytes |737396|449192|
| Same scripts, gzip bytes |201295|144828|
| Startup API reads |9|6|
| Mounted history images |240|24|
| History DOM elements |6268|651|
| Favorites DOM elements |6506|653|
| Unique fixture image requests |240|24|
| Median history switch, ms |463|332|
| Median favorites switch, ms |899|358|
| Median main-thread task time, seconds |0.873|0.152|

Evidence: /tmp/cover-performance-before and /tmp/cover-performance-after.
The first exploratory timing run was discarded because it observed outgoing
tab DOM; the final harness waits for the requested collection and settled entrance.
`scripts/measure-performance.mjs dist OUTPUT --verify` guards raw JS<500KB,
gzip<160KB, deferred SDK, zero video API calls,24 mounted images and<1000 gallery
DOM nodes. No timing gate or new production telemetry is introduced.

## Checks and boundaries

Profile server, HIGH risk. Skills: performance-optimization, frontend-design,
browser-testing-with-devtools, shipping-and-launch. Luna scout completed;
fresh Sol review required before activation. Selected skill reference checklist
directories are not present; their main SKILL guidance is used without claiming
those optional checklists were read. Runtime frontend changes remain in owned scope;
server/**, package/lock, MySQL, uploads, environment and SSO are protected.

Canonical npm run lint/test/build PASS;55tests/14files. Added pagination, correct
image callbacks, page clamp, single clear/error handling, untouched video keys,
async thumbnail SDK/config tests. Offline browser11groups PASS: all prior flows,
collection paging/lightbox, notes Escape/focus, download, both themes,7widths,
reduced motion and no video API reads/writes. Screenshots reviewed after transitions.
Performance budget PASS. git diff --check PASS. Production dependency audit has
0high/critical, unchanged1low+1moderate; not a clean audit. No dependency updates.
Actual authenticated public flow and paid generation remain untested.

## Static-only deployment

Release: /tmp/cover-performance-release.mjs; verify: /tmp/cover-performance-verify.mjs.
Backup: /var/backups/cover-image/20260911-performance-350720e.
Exact baseline index: a8238e23f4b3641abbdc117d539d5e30d910c33d0bcd4a3a36e0b5be024c033a.
Server guard: cf91242d9b3cb52db122be7d4c5aedbf2573a9d5ccefc42ccca62a73aa0efb7a.
Assets added exclusively, no old assets overwritten; index activates atomically
under shared flock. Source, old/newdist, tests and before/after metrics archived.
No restart/source sync to the stale production Git checkout. Rollback accepts
only this exact active candidate, restores old index and retains session assets.

```sh
sudo -n flock -n /run/lock/cover-foundation-release.lock node /tmp/cover-performance-release.mjs deploy
# Only if reverting this currently active release:
sudo -n flock -n /run/lock/cover-foundation-release.lock node /var/backups/cover-image/20260911-performance-350720e/release.mjs rollback
```

Final publish+rollback rehearsal PASS: /tmp/cover-release-rehearsal-fggNI1.
Candidate index:14c3daf74ca1746bfcb3ab05ef65fc53ed015078090cf53bbbb2e3c7ff26ebc2.
Release script:6dfd08767c3ebf289fea0ca89abcad8a75e8e794ef688ca907ccf213507ac435.
Verify script:366432dbacff50558aeb5bc4f4a720efbc1b0f59b9f589b3ffd339ea40faba8d.

## Actual release status

Prepared; mandatory fresh-context Sol review PASS for the exact candidate and
scripts above. Reviewer independently ran20focused tests, lint, diff check and
publish+rollback rehearsal (/tmp/cover-release-rehearsal-jG0ak2), with no actionable
findings. Image cancellation still suppresses stale UI via run IDs; already-sent
provider work may continue, unchanged from baseline. Final status will be appended
after activation and exact-candidate verification. No commit or push. Public unauthenticated
requests redirect to SSO; local-origin hashes do not prove logged-in browser flows.

Activated2026-09-11; post-check23:42:50UTC. Added15hashed assets. All27candidate
files match manifest;92old files preserved; index owner/mode correct; server hash
unchanged. Service active/running, PID287033,NRestarts0, start20:11:00UTC unchanged.
Local HTTP index matches candidate; entry /assets/index-BvXKgXve.js SHA256
c531c9db1f85053c32a1c62ea26485cb4924d0adc01769fd75ba2bbf14de66b4 matches build.
Local health {ok:true}, capabilities {gemini:true}. Public root without a session
HTTP302 to hearthpulse.net/api/auth/cover/start; no auth bypass/query disclosure.
Authenticated public generation and real-user performance remain unverified.
Backup holds exact previous/candidate dist, frontend source, browser checks,
before/after metrics and release script; verifier and final release note added
as separate no-clobber artifacts. Scope guard PASS; protected source/backend and
storage paths not changed. Commit:no;Push:no, neither requested.
