# Seedream diagnostics, real icons and generation motion release

Date: 2026-09-13. Target: the existing `cover.hs-manacost.ru` server and
`cover-image.service`. This release does not use Vercel.

## Product scope

- Replace placeholder OpenRouter glyphs with exact provider marks from the
  MIT-licensed Lobe Icons collection and Sourceful's official site icon.
- Keep model variants recognizable by sharing their provider mark while each
  model retains its own name, provider and selected/disabled state.
- Replace the generic OpenRouter failure with safe, actionable error classes
  for endpoint availability, balance, authentication, provider limits, invalid
  parameters, rate limits, outages and timeouts.
- Add a credential-free availability check. A model with no active endpoint is
  disabled; a catalog outage leaves models usable instead of producing a false
  negative.
- Add a calm three-stage generation state and a restrained result reveal with
  a reduced-motion alternative.
- Keep uploaded art uncropped in the editor and in composed reference sheets.
  Riverflow sheets are compressed to its smaller request budget.

Both Seedream 5.0 Lite and Pro passed a direct, billable request-contract canary
before release. This proves the active endpoints and request shape, not the
visual quality of every user prompt or source image.

## Activation and rollback

The release archives the exact live frontend, backend, reviewed candidate and
support files under a root-owned backup. It does not change MySQL, uploads,
environment files, systemd configuration, packages or the encrypted ChatGPT
session store.

New immutable assets and the model-catalog module are installed first. The
OpenRouter boundary and server entrypoint activate before one service restart;
the SPA index activates last. A failed stage restores the exact previous
backend and index and restarts the previous application. New immutable assets
remain so already-open tabs and rollback stay safe.

## Verification

- full unit tests, typecheck, production build and dependency audit;
- offline responsive browser checks for both themes and reduced motion;
- failure-injection tests plus an archive publish/rollback rehearsal;
- independent CRITICAL review of the exact commit and release path;
- live health, capabilities, Seedream endpoint availability, allowlist
  rejection, active file hashes, session-store preservation and SSO gate;
- one post-deployment Seedream Lite application-path canary.

Commands, after the candidate is committed and clean:

```sh
sudo -n node scripts/release-seedream-icons-motion.mjs capture
sudo -n node /var/backups/cover-image/20260913-seedream-icons-motion/support/scripts/release-seedream-icons-motion.mjs rehearse
sudo -n node /var/backups/cover-image/20260913-seedream-icons-motion/support/scripts/release-seedream-icons-motion.mjs deploy
sudo -n node /var/backups/cover-image/20260913-seedream-icons-motion/support/scripts/release-seedream-icons-motion.mjs verify
sudo -n node /var/backups/cover-image/20260913-seedream-icons-motion/support/scripts/release-seedream-icons-motion.mjs rollback
```
