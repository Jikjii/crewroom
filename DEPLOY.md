# Put the Crewroom beta online

Crewroom is live at https://joincrewroom.com on one Render Node 24 service serving the web app, API, and uploaded photos behind HTTPS. SQLite and photos stay on a 10 GB persistent disk. The operator confirmed phone access with the development computer asleep, and the account and uploaded photo survived a Render service restart. Native installation and store release are separate steps in [NATIVE-TESTING.md](NATIVE-TESTING.md).

The supplied `render.yaml` is an optional concrete starting point: one paid Docker service (`1c-2g`) and a 10 GB disk at `/var/data`. Review the provider's current price and region before creating it. This design supports one instance; a database/storage migration comes before adding instances. Render documents its [Docker builds](https://render.com/docs/docker), [Blueprint fields](https://render.com/docs/blueprint-spec), and [persistent disk limits](https://render.com/docs/disks).

## Confirmed beta settings

Confirmed with the operator on September 18, 2026:

- Host: Render, one `1c-2g` service and a 10 GB persistent disk, with an approved base budget of approximately $27.50/month before taxes and usage overages.
- Domain: `joincrewroom.com`, purchased through Porkbun. The web/API origin is `https://joincrewroom.com`; DNS and TLS are active, with `www` redirecting to the primary domain.
- Public operator: **Geraldo Grell**.
- Support: **support@joincrewroom.com**. Porkbun forwarding works. Resend is configured with a verified domain and restricted sending key; the operator completed a delivered password reset and signed in successfully.
- Minimum age: **18+**.

These public values are saved in `render.yaml` and the commented `.env.example`. The operator approved the beta policy pages before deployment. Cloudflare R2 was selected for daily offsite backups; see [BACKUPS.md](BACKUPS.md) for configuration and verification. Backup code is deployed on Render in commit `9b32b89`, but R2 activation, runtime credentials, and a successful live backup and restore drill are still required before treating offsite protection as active.

## Hosting configuration

Use the selected HTTPS origin for web and API. Production intentionally refuses reserved, local, and placeholder domains.

| Variable | Value / purpose |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | The real public HTTPS origin, without a path. Used for invites and account recovery. |
| `EXPO_PUBLIC_API_URL` | The same origin, with no `/api` suffix. Compiled into web/native bundles. |
| `EXPO_PUBLIC_WEB_URL` | The same origin. Compiled into native sharing links. |
| `DATA_DIR` | `/var/data`, with the provider's persistent disk mounted there. |
| `OPERATOR_NAME` | The real person or organization responsible for this beta. |
| `SUPPORT_EMAIL` | A real monitored address. |
| `POLICIES_APPROVED` | Set to `true` only after reviewing the actual `/privacy`, `/terms`, `/community`, `/support`, and `/delete-account` pages with the operator details. |
| `POLICY_VERSION` | `beta-1` initially; change deliberately when acceptance must be renewed. |
| `MINIMUM_AGE` | `18` for this initial adult beta. Do not represent this as identity verification. |
| `TRUST_PROXY_HOPS` | `0` until the proxy topology is verified; see below. |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional pair for password-reset email. Use a verified sending domain/address. Keep the API key in runtime secrets. |

`PRIVACY_POLICY_URL` and `TERMS_URL` can override the default `${APP_ORIGIN}/privacy` and `${APP_ORIGIN}/terms`. `CORS_ORIGINS` is an optional comma-separated list of other trusted HTTPS browser origins; leave it empty for the single-origin setup. `DB_PATH` and `MEDIA_DIR` can override the default `/var/data/crewroom.sqlite` and `/var/data/media`; both must still point to persistent storage. Do not use in-memory or ephemeral storage for real testers.

Every `EXPO_PUBLIC_*` value is public. Never put mail credentials, service tokens, passwords, or signing secrets in these variables or Docker build arguments. Render passes configured Docker variables as build arguments; this Dockerfile references only the two public URL arguments. [Render's guidance](https://render.com/docs/docker-secrets) explains the distinction.

The API intentionally refuses production startup without the public origin, real operator/contact, reviewed policy flag, persistent paths, and a matching production web export. Missing email delivery emits a prominent warning; it does not prevent a small beta, but self-service password recovery will be unavailable. A generic reset confirmation is not proof that an email was sent.

## Deployment procedure

The existing private repository is `Jikjii/crewroom` and the Render service is `crewroom-beta` (`srv-damc8mp42hec738hb7mg`). Push reviewed changes, then manually deploy the latest commit in Render. Automatic deploys are disabled. The following also documents how to recreate the service:

1. Put this app directory in the chosen private Git repository. Exclude `.data`, `.env*`, backups, local logs, credentials, and `node_modules`. The Docker context also excludes these. If this directory is nested in a larger repository, adjust `dockerContext` and `dockerfilePath` in `render.yaml` to its actual repository-relative path.
2. For Render, create a Blueprint using `render.yaml`, review the paid service/disk configuration, and enter the real environment values above. Choose the actual hostname before the successful client build. Other Docker hosts can use the same Dockerfile and settings with their own HTTPS proxy and persistent-volume configuration.
3. Ensure `/var/data` is writable by the image's non-root `node` user (UID/GID 1000). For your own bind mount, provision ownership on that dedicated directory. If a managed host presents a differently owned disk, fix that mount's ownership before the first start; do not make the data world-writable or disable production checks.
4. Build and deploy. The Dockerfile installs from the lockfile, exports the web bundle with the configured URLs, records those URLs in `dist/crewroom-build.json`, and starts the API on internal port 10000. The provider terminates HTTPS; only that proxy should expose the service publicly. Use `/api/health` for the provider's health check.
5. On the running host, run `node scripts/preflight.mjs`. Production startup runs these configuration checks too. Review every warning. Changing `EXPO_PUBLIC_*` values at runtime does not rewrite an existing bundle: rebuild/redeploy the web image and rebuild the native app whenever the compiled service URLs change.
6. Complete the remote acceptance checks below before inviting people. The template disables automatic deploys so a future Git push does not immediately change this beta.

The initial Render Docker deployment, HTTPS, password recovery, and persistence across a service restart have been verified. Check the acceptance list below for each release; these checks do not establish native-device or store readiness.

## Trusted HTTPS proxy and rate limits

Production always sets the session cookie's `Secure` flag; it does not infer TLS from untrusted request headers. `HttpOnly` and `SameSite=Lax` remain enabled. The browser app and API should share the same public origin.

`TRUST_PROXY_HOPS=0` uses only the connection's peer address. Behind a reverse proxy this can cause different people to share a rate-limit bucket. Set `1` only when all public requests reach the app through exactly one trusted proxy that overwrites/appends the actual client address, and direct public access to the app port is prevented. Set a larger value only for a verified fixed chain; the supported range is 0–8. Do not guess a host's topology from an example.

The helper bounds and validates the complete `X-Forwarded-For` chain, then selects from the right by the configured number of trusted hops. Extra attacker-supplied values on the left do not choose the rate-limit identity. Malformed, oversized, or too-short chains fall back to the socket address. This does not make an incorrectly configured network topology trustworthy.

## Build/preflight without a provider

Use Node 24+. Set the configuration in a local ignored environment file or the deployment environment, then export a production web bundle:

```sh
npm ci
npm run typecheck
npm test
npm run build:hosted
npm run preflight
```

`build:hosted` clears Metro’s cache, exports with the public URL variables, and immediately records that configuration. Expo and the metadata command load a local ignored `.env` file when present. The metadata cannot change an old bundle; do not stamp a development/LAN bundle and call it production. `npm run preflight` also loads `.env`, whereas bare `node scripts/preflight.mjs` expects values already present in the process environment.

To exercise the Docker build itself, with Docker running and public URLs already exported in your shell:

```sh
docker build \
  --build-arg EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" \
  --build-arg EXPO_PUBLIC_WEB_URL="$EXPO_PUBLIC_WEB_URL" \
  -t crewroom-beta .
```

The initial image was built successfully by Render; a local Docker daemon was unavailable. Runtime helper and backup/restore tests use real temporary SQLite databases. The backup update also deployed successfully on Render; the R2 connection and restore drill remain pending.

## Back up the database and photos together

Do not copy only a live SQLite `.sqlite` file: committed data may still be in its WAL. `scripts/backup.mjs` uses [Node's SQLite online backup API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) to make a consistent database snapshot, then copies every uploaded photo referenced by that snapshot. Demo images are part of the application image, not user-media backups.

Run this on the service instance that can access the disk. Choose a new destination every time; the tool refuses an existing directory. Create the parent directory first if necessary.

```sh
node scripts/backup.mjs --to /var/data/backups/beta-before-next-release
```

The tool reads `DATA_DIR`, or `DB_PATH` plus `MEDIA_DIR`; explicit `--db` and `--media` override them. Uploaded files are immutable. If a concurrent deletion removes a required photo before it is copied, the backup fails and removes only its newly created incomplete backup directory. Retry while writes are paused for a dependable snapshot. Success requires a manifest with SHA-256 checksums for the database and all referenced photos.

A backup on the same disk is only a staging copy. The daily R2 scheduler, upload verification, retention, and isolated restore drill are documented in [BACKUPS.md](BACKUPS.md). Configure its private bucket, scoped credentials, and independent seven-day lifecycle rule before enabling it. Monitor failures and confirm a real backup and restore drill. R2 encrypts stored objects and transfers use HTTPS; this setup does not add a separate client-side encryption key.

The beta privacy page commits to expiring backup snapshots within **30 days**. Apply that limit to every manual, offsite, and provider-managed copy under your control. Render documents snapshots available for at least seven days, which is not a verified maximum; confirm the provider's maximum retention separately. Avoid accumulating manual snapshots on the persistent disk.

Account deletion removes live records/files; an older point-in-time backup can retain them until expiry. After a disaster restore, replay account-deletion requests made since that snapshot before reopening access. Keep the minimum deletion reconciliation record needed for this purpose under restricted access and the published retention policy; never restore old accounts into active service without checking it.

Render's disk is available only to the attached running instance, not to its build/pre-deploy phase or a separate cron service. Use an operating procedure or scheduler that executes where the disk is mounted. Read the provider's database-backup guidance before relying on generic disk snapshots for SQLite recovery. [Persistent disk documentation](https://render.com/docs/disks).

## Restore safely

Stop the API and prevent traffic/writes first. The flag below asserts you have done this; the tool cannot prove every remote process has stopped. It verifies the manifest, file hashes, SQLite integrity, foreign keys, and photo references before copying anything. It only restores to a new or empty real directory and never overwrites the live database.

```sh
node scripts/restore.mjs \
  --from /var/data/backups/beta-before-next-release \
  --to /var/data/restored-beta \
  --confirm-server-stopped
```

Inspect the restored data, apply outstanding deletion requests, and test it before switching the stopped service's `DATA_DIR` to that restored directory. Clear conflicting `DB_PATH` or `MEDIA_DIR` overrides when switching. Keep the prior live directory until recovery is verified; do not overwrite it as part of the restore. If a copy fails due to disk exhaustion, the partial target stays in place for inspection and a new restore must use another empty target.

## Verify the hosted beta

- Open the public HTTPS URL from a phone on cellular with the development computer asleep. The gallery, account signup, and a real photo upload must work.
- Confirm policy/support/deletion pages display the real operator and are reachable while signed out. Complete an actual deletion with a disposable account and verify its media is no longer available.
- With two accounts, publish → discover → comment → request → accept → private crew. Confirm unrelated crews remain private and block/report controls work.
- If email is configured, test a reset end to end, token expiry/reuse rejection, and delivery into a real mailbox. Do not print tokens or email API keys in logs.
- Restart and redeploy the service, then check the same account, draft, uploaded photo, and crew still exist.
- Make a backup, restore it into a separate empty test directory, and inspect both database content and photos. Record the date and result.
- Check secure browser cookies, rate limits for two separate client connections, errors, disk capacity, and the manual report queue. Use `node server/moderate.mjs --db /var/data/crewroom.sqlite list` until the CLI is configured with the correct explicit database path.
- Complete the physical-device checklist with native preview builds configured for the hosted URLs. This hosting package does not establish iPhone/Android verification or App Store/Google Play readiness.
