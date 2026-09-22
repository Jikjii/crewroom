# Beta signup operations

`/beta` requests iPhone beta access and optionally launch updates. The existing web app remains available at `/`. A request does not create a Crewroom account, guarantee an invitation, or automatically add someone to TestFlight.

## What a visitor completes

1. Enter an email address, select iPhone, Android, or both, and confirm they are at least 18. Launch updates have a separate, optional consent checkbox.
2. Open the confirmation email and confirm the request. A request remains pending until email ownership is confirmed. Android interest is recorded without promising an Android release.
3. Optionally tell Crewroom their role and next shoot after signup; pending answers become part of the confirmed request only when the email is confirmed. The confirmation page also allows these answers and launch-update consent to be changed. These are private planning details, not public profile details.

Confirmation and management links are private. Removing a request deletes its stored waitlist details; it does not delete an existing Crewroom account. Confirmation links expire after seven days; an unconfirmed signup is removed seven days after its latest request. Confirmed requests expire 180 days after their latest confirmation. A fresh, unconfirmed email link temporarily preserves the record until that link expires, so a resend near the retention deadline remains usable for its promised seven days. Confirming again starts a new 180-day period; an abandoned resend does not. Cleanup runs at startup, on beta API requests, and hourly; the read-only operator tool does not modify or expire records.

## Hosting and mail

Deploy the updated server to make `/beta` and its API available. Requests use the existing SQLite database on Render's persistent disk and are included in the existing database backups. Do not move the data into the public web or media directories.

Confirmation emails reuse the existing server-only `RESEND_API_KEY`, verified `MAIL_FROM`, and `APP_ORIGIN=https://joincrewroom.com` configuration. Keep credentials out of client code, screenshots, and commits. This feature does not create a Resend marketing contact list or send broadcasts. Development tests use a mock mailer; passing tests is not evidence of production delivery.

Beta confirmation delivery is capped at 50 email attempts per 24-hour window across the service, three per address, and a 60-second cooldown for the same address. These counters survive restarts and include failed delivery attempts. The public endpoint also limits attempts per client IP. A limit response asks the visitor to wait; it does not silently add a confirmed subscriber. Review the daily cap before running an advertising campaign that could exceed it.

After deployment, submit one request using a mailbox you control, verify delivery and confirmation, save optional answers, and test removal. Check that the normal web app and password recovery still work. Never copy confirmation or management links into public logs or analytics.

## See the waitlist in Render Shell

From `/app`, start with aggregate counts. This command contains the actual hosted database path and does not print email addresses:

```sh
node server/beta-list.mjs --db /var/data/crewroom.sqlite
```

To explicitly view the first page of confirmed requests, including private email addresses:

```sh
node server/beta-list.mjs --db /var/data/crewroom.sqlite --list --limit 100
```

For confirmed subscribers who separately chose launch updates:

```sh
node server/beta-list.mjs --db /var/data/crewroom.sqlite --list --updates-only --limit 100
```

Each list response contains `count` for the current page, `total` matching confirmed requests, and `nextOffset`. If `nextOffset` is `100`, request the next page with:

```sh
node server/beta-list.mjs --db /var/data/crewroom.sqlite --list --limit 100 --offset 100
```

Keep `--updates-only` on every page when viewing launch-update subscribers. `--limit` accepts 1–500, and `--offset` must be nonnegative. Dates are Unix timestamps in milliseconds. Device summary counts cover pending and confirmed requests together. Lists include only confirmed requests, with no confirmation or management tokens. The tool opens SQLite read-only and never creates or changes tables. If the schema is missing, deploy and start the updated server first.

Treat `--list` output as private contact information: do not paste it into public issues, screenshots, or shared documents. Do not redirect it into a publicly served directory. Re-read current consent immediately before using an exported list; a stale copy may include someone who has since removed their request.

## Invite people in small waves

Use confirmed iPhone or both-device requests to select the next group for the existing private TestFlight beta. Send invitations through the established App Store Connect workflow after reviewing the requests. This CLI does not send invitations, and requesting access does not mean an invitation was delivered.

Only the confirmed `--updates-only` list is eligible for launch-update newsletters. A beta-access request alone does not grant that additional consent. Configure the marketing sender's unsubscribe handling and consent synchronization before sending any broadcast; neither a Resend contact sync nor broadcast workflow is implemented here. Do not import unconfirmed requests, scraped addresses, or existing app accounts into a newsletter.

Waitlist signup, TestFlight access, account creation, and public-content moderation are separate steps. Continue reviewing profiles and public posts with the existing [moderation procedure](MODERATION.md).
