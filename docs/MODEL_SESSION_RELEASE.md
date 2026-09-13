# Model icons and durable ChatGPT session release

Date: 2026-09-13. Target: the existing `cover.hs-manacost.ru` server and
`cover-image.service`; no Vercel deployment is involved.

## Product scope

- Muse Image and Krea 2 Large become selectable. Because each accepts one
  reference, Cover creates one labeled WEBP contact sheet and uses contain
  geometry so every uploaded source remains fully visible and uncropped.
- Every OpenRouter family has a distinct local provider glyph. Two variants of
  one provider intentionally share that provider's mark.
- ChatGPT OAuth sessions survive Cover restarts for their existing eight-hour
  lifetime. Persisted transport tokens are encrypted with AES-256-GCM, bound to
  the current Cover login cookie digest, and never returned to the browser.
- Muse is not silently replaced: the UI states that generation still depends
  on an active OpenRouter endpoint. As checked on 2026-09-13, the official Muse
  endpoint list was empty.

## Activation and rollback

The release runs under the shared Cover lock. It archives the exact live dist,
backend modules and a frozen candidate. A fresh 32-byte encryption key is held
only in the root-owned `0700` recovery archive and installed as a root-owned
`0600` environment file. The session directory is owned by the service user
with mode `0700`.

Backend modules and configuration activate before the service restart. The SPA
index activates last. Any failed stage restores the exact prior index and
backend and restarts Cover. The encrypted session data file is not deleted on
rollback. The one activation restart cannot migrate an already in-memory-only
OAuth session; connections created after this release persist across restarts.

## Verification boundary

- typecheck, full tests, focused persistence/contact-sheet tests and production build;
- dependency audit and release failure-injection tests;
- offline publish/rollback rehearsal from the frozen archive;
- independent CRITICAL review of the exact candidate;
- live health, capabilities, session boundary, service stability, active hashes
  and public SSO redirect;
- no billable image generation during deployment.

Passing release verification proves the integration and persistence boundary,
not provider output quality or current paid availability of every model.

After capture, rehearsal, deployment, verification and any rollback are run
from the frozen support copy, which includes its imported release library:

```sh
sudo -n node scripts/release-model-session.mjs capture
sudo -n node /var/backups/cover-image/20260913-model-session-139bfe87-r3/support/scripts/release-model-session.mjs rehearse
sudo -n node /var/backups/cover-image/20260913-model-session-139bfe87-r3/support/scripts/release-model-session.mjs deploy
sudo -n node /var/backups/cover-image/20260913-model-session-139bfe87-r3/support/scripts/release-model-session.mjs verify
sudo -n node /var/backups/cover-image/20260913-model-session-139bfe87-r3/support/scripts/release-model-session.mjs rollback
```
