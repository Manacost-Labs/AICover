# OpenRouter production release

Date: 2026-09-12. Target: `cover.hs-manacost.ru` on the existing server and
`cover-image.service`; no Vercel deployment is involved.

## Scope

- Publish the reviewed OpenRouter image integration and its generated frontend.
- Keep `OPENROUTER_API_KEY` in the existing server-only environment file; its
  value is never copied into the release archive, source tree, logs or UI.
- Activate with a separate recoverable `/etc/cover-image/openrouter.env` and
  systemd drop-in. MySQL, uploads, the main environment file, nginx, packages,
  ChatGPT settings and unrelated services are unchanged.
- Do not submit a paid image generation during release verification.

## Order and rollback

The release runs under `/run/lock/cover-foundation-release.lock`. It archives
the exact live dist/backend, reviewed candidate, support files and manifest.
Immutable assets are added first. The feature flag and backend are installed
and only `cover-image.service` is restarted. The SPA index is published last,
after health and capability checks. Any failure restores the prior index,
backend and configuration and restarts Cover on the old release. New immutable
assets remain for open tabs and recovery.

Rollback refuses unknown target hashes so it cannot overwrite a later release.
New configuration files are moved into unique backup directories rather than
deleted. No database rollback is required.

## Verification

- full application tests, typecheck, build and dependency audit;
- release unit tests with every activation stage failure-injected;
- archive publish/rollback rehearsal outside production;
- independent CRITICAL Astra review of the frozen release script and archive;
- live health, Gemini and OpenRouter capabilities;
- strict rejection of an unknown model and prototype-chain model names without
  any provider request;
- active systemd service with no automatic restarts;
- local index hash and public HearthPulse SSO redirect.

Commands:

```sh
sudo -n node scripts/release-openrouter.mjs capture
sudo -n node scripts/release-openrouter.mjs rehearse
sudo -n node scripts/release-openrouter.mjs deploy
sudo -n node scripts/release-openrouter.mjs verify
sudo -n node /var/backups/cover-image/20260912-openrouter-1ebb3e6-r3/support/scripts/release-openrouter.mjs rollback
```

The script acquires the shared release lock itself. A successful capability
check proves that the provider is enabled and protected by the local boundary;
it does not prove paid model output quality, reference fidelity or transparent
background behavior.
