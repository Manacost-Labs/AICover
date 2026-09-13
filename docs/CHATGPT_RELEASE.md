# Personal ChatGPT images — server release

User approved this deployment on 2026-09-12, after reviewing the candidate's
personal-account model and its live-verification limits. No commit/push, database
migration, shared credentials, existing ChatGPT sessions, paid image canary or
authentication bypass is authorized or required.

## Exact candidate and baseline

- Source: `/srv/projects/web/AI-cover-worktrees/chatgpt-images-integration`, branch
  `feature/chatgpt-images-integration`, HEAD `350720e` plus archived uncommitted
  source, based on the previous performance release snapshot.
- Production: `/var/www/koloda/data/www/cover.hs-manacost.ru/repo`;
  `cover-image.service`, localhost3127. Existing nginx/SSO remains authoritative.
- Old index SHA256: `14c3daf74ca1746bfcb3ab05ef65fc53ed015078090cf53bbbb2e3c7ff26ebc2`.
- Candidate index SHA256: `f33a4568fa057e67d2a74d1d5e6c93f277803e085f3aa0b075d528bc80400e9e`.
- Old server SHA256: `cf91242d9b3cb52db122be7d4c5aedbf2573a9d5ccefc42ccca62a73aa0efb7a`.
- Candidate server SHA256: `ea2a3149ef8b81963466841063bedb4a836b5409ef9dc1dd7810475972149490`.
- Protected backup: `/var/backups/cover-image/20260912-chatgpt-350720e`.

## Release design

The existing production package manifests are older than the frontend snapshot.
Only `@openai-oauth/core@2.0.0` is added to the existing manifest/lock; all prior
versions, scripts and packages remain unchanged. The reviewed installed package
is copied as regular files, verified by hashes. It has no runtime dependencies
or install hooks. No npm resolver, lifecycle scripts, or broad dependency update
runs on production. Candidate source and candidate build are archived together;
the stale production frontend source tree is not overwritten.

The original server, package manifests, unit, nginx configuration and complete
previous dist are captured first, with exact baseline checks. Existing env and
database/uploads are not read/copied or changed. New nonsecret settings live in
`/etc/cover-image/chatgpt.env`, referenced by the dedicated
`/etc/systemd/system/cover-image.service.d/30-chatgpt.conf` drop-in.

Only callback locations receive log suppression and no-referrer/no-store headers.
The HTTPS callback retains SSO through a private clone of the existing internal
authorization location; the existing SSO routes/header remain byte-for-byte.
The callback's auth subrequest and denied-login redirect also suppress query
logging. HTTP callbacks redirect to HTTPS without forwarding the query; normal
OAuth always uses the exact HTTPS callback. No anonymous access is added.

Activation: add immutable modules/assets, replace nginx and validate/reload it,
atomically update manifests/settings/server, reload systemd and restart only
Cover. Require healthy database health and unchanged Gemini capability plus
enabled/disconnected ChatGPT, then atomically publish the new index. Failed
activation triggers guarded rollback. The nginx reload affects its workers but
does not change unrelated virtual-host configuration.

Rollback validates every mutable target before restoring the previous index,
server, manifests and nginx. New settings are moved into backup, not deleted.
Extra module files and all old/new hashed assets remain for open tabs/recovery.
No database rollback is necessary. Refuse rollback after another release drifts
the managed paths. The unchanged original unit and env remain in force.

## Commands

All live operations run under the existing shared lock:

```sh
sudo -n flock -n /run/lock/cover-foundation-release.lock node scripts/release-chatgpt.mjs deploy
sudo -n node scripts/release-chatgpt.mjs verify
node scripts/verify-chatgpt-release.mjs
# Only to restore this release, while its managed paths still match:
sudo -n flock -n /run/lock/cover-foundation-release.lock node /var/backups/cover-image/20260912-chatgpt-350720e/release-reviewed.mjs rollback
```

## Verification and honest boundaries

- Profile `server`; route risk CRITICAL. Shipping-and-launch method selected;
  its optional reference files are absent. API implementation had prior Sol
  review; release requires a separate fresh Astra review before activation.
- Luna read-only scout confirmed nginx topology and sensitive callback logging.
- Eleven release tests pass, including failure injection, repeated publish/rollback,
  archive corruption, concurrent release drift, symlinks and asset collisions.
- Production-snapshot rehearsal passed in
  `/tmp/cover-chatgpt-release-rehearsal-sMx4AI`: exact publish+rollback, dependency
  import and candidate nginx syntax. It did not activate/restart production.
- App source/build match the previously checked candidate: 69 Vitest +16 Node
  tests, 11 existing/3 new browser groups, build/types and performance budgets.
- Existing dependency audit findings are documented in `CHATGPT_IMAGES.md`;
  this release does not fix or conceal them.
- Live verifier uses a new temporary local PKCE pending session and disconnects
  it; no upstream OAuth URL is visited, code exchanged or image requested.
  Public/origin anonymous requests must still redirect to SSO, including callback.
- Real personal ChatGPT login, model availability, generation/editing and
  authenticated public UI remain unverified until a user connects their account.

## Actual activation

Deployed 2026-09-12 at 01:05 UTC using the reviewed frozen script under the shared
release lock. `cover-image.service` active/running, PID2211220, NRestarts0,
ExecMainStartTimestamp01:05:23UTC. Database-backed health returns `{ok:true}`;
Gemini capability remains true. ChatGPT session reports enabled, disconnected,
unverified, as expected for a fresh visitor.

CRITICAL Astra review **PASS** for release-script SHA256
`cb8b77c36c720a35815b5770218562be2661c01cbb7f59bdb1af1e641845068f`.
Reviewer found and we fixed a repeated-rollback retirement collision before
activation; unique recovery directories plus an explicit three-cycle retry
regression now cover it. Independent final snapshot rehearsal:
`/tmp/cover-chatgpt-release-rehearsal-E9bHqo`. Eleven release tests and final
85 application tests/type checks pass. Application code/build remained unchanged.

Post-release verifier confirms all 27 candidate dist files and 107 old assets,
all managed source/config files and pinned dependency contents match the archive.
Local HTTP index matches the candidate hash. `nginx -t` passes. Live local PKCE
URL construction and temporary-session disconnect pass; wrong Origin, missing
connection and wrong callback state are rejected. No token exchange or upstream
generation was attempted. Public and origin HTTPS root/session/callback each
remain 302 to the existing SSO login, without forwarding the fixture query;
callback redirect has no-referrer/no-store headers.

The protected backup includes `release-reviewed.mjs` (used for activation and
rollback), `verify-live.mjs` and final source/support files in `source-final`.
The initial `source` directory remains the pre-review snapshot, not overwritten.
`CHATGPT_IMAGES.md` records the earlier preparation phase; this document is the
authoritative later deployment record. Existing main env, MySQL/upload contents,
SSO key/header value and unrelated virtual hosts are unchanged. New settings
files are recoverable through the tested rollback; nothing was deleted.

Status: deployed and HTTP/security verified; actual authenticated OAuth and
image-generation/editing access await the user's personal ChatGPT login. Other
image-model availability is still unconfirmed. This is not proof of a real
successful image-generation flow.
Git: Commit:no; Push:no, neither was requested. Linear: ZUL-8 remains In Progress.
