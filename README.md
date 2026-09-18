# Crewroom creative network — v0.3 beta preparation

Crewroom brings cosplay work, creative people, and private collaboration into one app. Browse photo projects, share your own making process, follow creators, save inspiration, leave comments, and request a collaboration. An accepted request starts a new private crew and project using the existing lineup, checklist, and day plan tools. It uses an Expo React Native client for iOS, Android, and web, with a Node.js API, SQLite database, and uploaded photo storage.

This is a working development pilot with deployment and native release configuration prepared. No public hosting, Docker image build, native installation, or App Store/Google Play release has been verified. Actual iPhone and Android testing is still required before either platform can be called verified. Use the [creative-network walkthrough](NETWORK.md) and [five-task planning pilot](PILOT.md) with a real upcoming shoot and one friend.

Version 0.3 adds System/Light/Dark appearance, public policy and support pages, account-deletion controls, and password-reset flows. Actual reset email delivery requires a configured sender; local UI and backend support do not send mail by themselves. See [appearance settings](APPEARANCE.md), [hosted deployment](DEPLOY.md), and [native release preparation](RELEASE.md).

## Start on the computer

Requirements: Node.js **24 or newer**, npm, and installed project dependencies. The API uses Node's built-in `node:sqlite`.

```sh
cd /Users/jikjii/Documents/Codex/2026-09-17/i-x20/outputs/crewroom
npm install
npm run dev
```

The launcher starts the API at `http://localhost:4311` and Expo's web preview at `http://localhost:8081`. It disables Expo telemetry and sets `EXPO_NO_CACHE=1` by default to avoid Expo's user-level native-module metadata cache writes. It stops both processes when you press **Ctrl+C**. Keep that terminal running while using the app. The local API health check is `http://localhost:4311/api/health`.

The home screen opens without an account. Its initial gallery is clearly labeled fictional, AI-illustrated example work; there are no fabricated followers, comments, or requests. Create an account to post and connect with real creators. Profiles start private, and publishing requires an explicit public choice. Choose **My crews** to explore the isolated planning demo. Converting a demo account keeps its work but resets its social profile and posts to private so you can decide what to publish.

On this computer, the shell's default Node may be older than required. The bundled Node was checked as **v24.19.0**. To run the already-installed project with it directly:

```sh
/Users/jikjii/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/dev.mjs
```

Add `--phone` to that command for phone mode. The launcher uses its own Node executable for both child processes and puts that executable's directory first on their `PATH`.

### If file watching fails

Some restricted environments report `EMFILE` from Metro's file watcher even with a high open-file limit. Use the supported no-watch mode:

```sh
CREWROOM_NO_WATCH=1 BROWSER=none npm run dev
```

Or, with this computer's bundled Node:

```sh
CREWROOM_NO_WATCH=1 BROWSER=none /Users/jikjii/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/dev.mjs
```

This sets `CI=1` for the child processes and disables automatic reload. Open the printed app URL yourself and restart the command after source edits. Interactive Expo prompts may be unavailable in this mode. A restricted devtools cache can also produce a fallback warning; that warning alone does not mean the app failed to start.

## Open it on a phone

Connect the phone and computer to the same Wi-Fi, install an Expo Go version compatible with this project's Expo SDK, then run:

```sh
npm run dev:phone
```

The launcher selects the computer's LAN IPv4 address and prints the web/invite and API URLs. It starts the API on all local interfaces (`HOST=0.0.0.0`), sets the web origin and mobile API address to that LAN IP, and starts Expo in LAN mode. Open the QR code with the iPhone camera or Expo Go's Android scanner. Expo also starts a browser preview for invitation links.

If the selected interface is wrong, stop the launcher and specify the computer's Wi-Fi address:

```sh
CREWROOM_LAN_IP=192.168.1.20 npm run dev:phone
```

Replace the example IP with the computer's actual address. A phone cannot reach the computer through `localhost`. Guest Wi-Fi isolation, a VPN, or a firewall can also prevent access. Allow the development processes on your trusted LAN if your computer asks. An Expo tunnel alone does not expose the API.

Keep both processes running. This mode makes the development app reachable on the local network; it does not create an internet URL. It uses local HTTP, so use pilot accounts and a trusted network. Expo Go is a development preview. Signed preview builds and store packages use the prepared [release configuration](RELEASE.md); they still require the real Expo/store project details and a hosted HTTPS backend. See [DEPLOY.md](DEPLOY.md) for running independently of this computer.

## What the pilot supports

- Anonymous Discover and public creator/project links, plus search and stage filters.
- Public creator profiles with roles, fandoms, a broad city, optional links, and collaboration availability.
- Up to four uploaded photos per work, making notes, collaborator credits, drafts, and public publishing.
- Following, private bookmarks, comments, and persisted in-app activity notifications.
- Structured collaboration requests with accept, decline, and cancel. Acceptance creates a separate private crew and project for the two participants.
- Personal blocking and reports, with a local operator moderation tool. See [NETWORK.md](NETWORK.md).
- Accounts and isolated demo data; password hashing, session logout, account-deletion preview/confirmation, and password-reset flows with conditional email delivery.
- System, Light, and Dark appearance saved on each device, available before signing in.
- Public privacy, terms, community, support, and deletion pages. Production requires real operator details and explicit approval of these pages.
- Crews and projects with dates, meeting details, and a project-specific character/readiness lineup.
- Planned members clearly distinguished from joined people.
- Assigned preparation tasks and a day-of-event timeline.
- One-use invitations that expire after seven days. A planned member's invite preserves that member's assignments when claimed.
- Captain-controlled invitation revocation and removal of non-owner members; other members can leave a crew.

Copy an invitation and share it yourself; invitations do not send email. Password-reset email is a separate feature and works only after the operator configures the mail provider and verified sender. Open invitation links in a browser on the same network in local phone mode, or at the real public URL after deployment. A friend needs a real account to accept an invitation. Use a separate invitation per person. A copied web link is not a guarantee of a native deep-link handoff into Expo Go.

Web sessions use HttpOnly cookies and CSRF protection; production adds Secure cookies behind HTTPS. Native sessions use bearer tokens stored with Expo SecureStore. The API enforces crew membership, invite consumption, and assignment boundaries. Production configuration also checks the public origin, persistent paths, operator details, policy approval, and exported web URLs. These controls support the beta; the actual hosted configuration still needs verification.

## Saved data and backups

By default, the API stores local accounts, sessions, crews, projects, and social records in:

```text
outputs/crewroom/.data/crewroom.sqlite
```

The path is relative to the containing workspace; inside this project it is `.data/crewroom.sqlite`. Uploaded images live in `.data/media/`. SQLite may also create `crewroom.sqlite-wal` and `crewroom.sqlite-shm` alongside the database. The directory is excluded from version control. Do not commit or publicly share it: it contains account and crew data. Existing databases receive additive social tables; existing crew records are preserved.

Use `scripts/backup.mjs` to create a consistent SQLite snapshot with its referenced uploaded photos and checksum manifest. Use `scripts/restore.mjs` only after stopping the API, with explicit confirmation and a new or empty target directory. It verifies the backup and refuses to overwrite existing data. Do not copy only the live database file or replace the current data directory as a shortcut.

The exact commands, offsite backup responsibilities, published retention commitments, and deletion handling after a restore are in [DEPLOY.md](DEPLOY.md). The scripts do not automatically send backups offsite or expire them. For another storage location, configure `DATA_DIR`, or explicit `DB_PATH` and `MEDIA_DIR`; production requires actual persistent storage.

## Current limits and verification

Push notifications, offline edits, background sync, and payment processing are not included. Activity notifications appear in the app and refresh when you reopen/refresh the inbox. Keep existing crew communication available for urgent changes.

Hosted-service files and native build profiles are prepared, but no service has been deployed or store package installed. Password-reset email support is implemented; it remains unavailable until `RESEND_API_KEY`, a verified `MAIL_FROM`, and the public origin are configured. An actual delivery and reset must be tested after setup. Email verification and invitation emails are not included.

Native device results are recorded in [PILOT.md](PILOT.md). Check the iPhone and Android rows before describing either as tested. The checklist also covers persistence, claiming planned members, invitation replay/revocation, member removal, independent project lineups, and account isolation.

The previous v0.2 browser/platform checks are recorded separately below. Version 0.3 also passed fresh bundle, TypeScript, backend/configuration and browser checks. Actual iPhone/Android behavior remains unverified until a device pilot is completed. For the local phone preview and QR code, open [PHONE.md](PHONE.md).

The longer-term product and business thinking is in the sibling [Crewroom company strategy](../crewroom-company-strategy.md). Those expansion ideas are distinct from the features in this pilot.

## Version 0.3 verification

All **43 backend/configuration tests** passed, including the existing creative-network and planning checks plus account lifecycle, production configuration, native configuration, proxy handling, and verified backup/restore behavior. The backup tests use real temporary SQLite databases, including live WAL data, missing-photo failure, and checksum rejection.

Fresh v0.3 web, iOS and Android bundle exports and TypeScript passed. Browser checks used the packaged web build served by the API on one origin and a separate QA database: System/Light/Dark choices, saved Dark after reload, discovery and planner palettes at 390×844, creator Settings → account controls, deletion preview and disabled confirmation, recovery-unavailable messaging, public privacy and signed-out deletion/sign-in routes. No browser warning/error logs were recorded in those checks. Native exports are JavaScript/assets bundles, not signed installable apps.

A complete local database/photo backup was made before restarting the upgraded app. Comparing every preexisting column and row across all 21 original tables confirmed they were preserved. Production preflight correctly refuses the still-unconfigured hosting environment.

The Docker daemon was unavailable during preparation, so the Docker image build and managed persistent-volume permissions have not been verified. Public hosting, real email delivery, signed native installation, and both physical-device checks remain pending.

## Previous foundation verification — version 0.2

TypeScript passed; all **24 API integration tests** passed; web, iOS, and Android bundles exported. The tests cover the existing planner plus public/private boundaries, image validation and metadata removal, ownership, follows/saves/comments, blocks/reports, notifications, pagination, persistence, demo conversion, and atomic collaboration acceptance including rollback after a forced database failure.

Browser checks at 390 × 844, 820 × 844, and desktop sizes used a separate temporary database. They covered anonymous browsing, an actual photo-library upload, saving a draft, explicit public publishing, a signed-out public link, two-account following/saving/commenting, request acceptance, notification navigation, assigned tasks in the resulting shared private plan, private-profile unfollow, blocking/unblocking, report persistence in the moderator queue, and accessible publishing consent. No browser rendering errors remained after the final UI corrections. Full native device testing remains pending.

The v0.2 dependency audit recorded 10 moderate entries tracing to one upstream UUID advisory in Expo Xcode tooling, with zero high/critical findings. The observed tooling called `uuid.v4()` without the affected external-buffer behavior; the app API uses Node crypto. No affected app runtime path was identified in that check. This is a historical result, not a fresh v0.3 audit. Do not use `npm audit fix --force` to downgrade the Expo SDK. See [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
