# Cover performance release — ZUL-17

## Measured bottlenecks

The production build at `664d24179b628c5ade57e7fb12f882c2a08c7802` loaded 507,768 raw bytes / 165,939 gzip bytes of JavaScript before the Create screen became ready. This exceeded the existing 500 KB raw / 160 KB gzip synthetic budget.

The production Express origin also returned `Cache-Control: no-cache, no-store, must-revalidate` for Vite's content-hashed `/assets/*` files. That forced browsers to re-download stable React, Motion, UI and font chunks instead of reusing them.

## Changes

- Move the generation implementation behind a cached dynamic import. Types, prompts and scene-role contracts live in a lightweight module, so the AI pipeline is fetched only on the first AI action.
- Group all React and Motion package subpaths into stable vendor chunks. This prevents application edits from invalidating framework payloads.
- Serve fingerprinted `/assets/*` with `public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`. Unfingerprinted assets keep a five-minute revalidation policy. HTML remains `no-cache/no-store`, so each navigation receives the current asset map.
- Preserve database, authentication, session, media storage and provider contracts.

## Before and after

Synthetic Chromium, 1440×1000, three isolated runs, 240 fixture images, no network throttling:

| Metric | Before | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Initial JavaScript raw | 507,768 B | 464,181 B | -43,587 B (-8.6%) |
| Initial JavaScript gzip | 165,939 B | 149,708 B | -16,231 B (-9.8%) |
| Generation SDK in initial load | no | no | unchanged |

Local timings are diagnostic only; the isolated run has no real network latency or RUM. The durable user-facing improvement is the smaller initial payload plus immutable reuse of unchanged content-hashed chunks.

## Release

All commands require the exact reviewed commit:

```bash
sudo COVER_RELEASE_COMMIT=<sha> node scripts/release-performance.mjs capture
sudo COVER_RELEASE_COMMIT=<sha> node /var/backups/cover-image/20260913-zul17-performance/support/scripts/release-performance.mjs rehearse
sudo COVER_RELEASE_COMMIT=<sha> node /var/backups/cover-image/20260913-zul17-performance/support/scripts/release-performance.mjs deploy
sudo COVER_RELEASE_COMMIT=<sha> node /var/backups/cover-image/20260913-zul17-performance/support/scripts/release-performance.mjs verify
```

Rollback:

```bash
sudo COVER_RELEASE_COMMIT=<sha> node /var/backups/cover-image/20260913-zul17-performance/support/scripts/release-performance.mjs rollback
```

The capture archives the complete release driver and its imported helper. Every post-capture command must run from that verified archive. The release holds the shared Cover release lock, checks production guards, builds only a clean exact SHA, rehearses publish plus rollback away from production, writes backend files before restart, activates the index last, and verifies health, cache headers, authentication redirect and protected session-store permissions after restart. This does not claim session-ciphertext equality or decryptability. Rollback retains candidate-only fingerprinted chunks that were actually published, so tabs opened before rollback can still complete a deferred import; untouched and partially published releases remain recoverable and redeployable.
