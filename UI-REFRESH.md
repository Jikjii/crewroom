# Crewroom visual refresh

Implemented from the supplied TikTok/Pinterest-inspired screen references. The app keeps the Crewroom name and uses the existing data, account system, and moderation rules.

## What changed

- Home: two photo columns on phones, three on larger screens, natural photo proportions, fandom badges, compact creator attribution, and private saves.
- Home's Discover, Following, and Saved tabs preserve the existing feed modes. The expand button opens an immersive, vertically browsable photo view of the loaded posts. It supports saves and links to creator profiles, comments, and the complete project. Close it to change filters or load more results.
- Explore: work and creator search, stage and collaboration filters, and creator-role filters.
- Profiles: cover derived from available approved public work, initials avatar, actual project/follower counts, biography, roles, fandoms, public work, private drafts, editing, sharing, and settings/export.
- Post detail: large images, photo strip, creator actions, comments, making notes, collaborator credits, and collaboration opportunities.
- Create: large selected-photo preview, selectable thumbnails, image descriptions/removal, stage choices, making notes, credits, collaboration options, and the existing private/public review flow.
- Inbox: Activity, Requests, and Sent. Activity filters use real comment, follow, and collaboration notifications. Accept/decline/cancel and navigation to private plans are retained.
- Shared appearance: near-black dark mode, matching light mode, violet actions, pink accents, rounded controls, and the existing System/Light/Dark preference persistence. The header retains access to private crews and account controls.

These references also depict video recording, effects, likes, challenges, creator levels, uploaded avatars, and trending statistics. Those services are not part of this UI change; the interface does not fabricate them or their counts. Existing example images remain labeled.

## Validation

- Existing server integration suite: 79/79 passed.
- TypeScript and Git whitespace checks passed.
- Production web export and iOS/Android JavaScript/assets exports succeeded. Native exports are not signed installable builds.
- Browser checks used an isolated local database and no email sender. Checked 320px and 390px mobile widths and a 1280px desktop viewport, dark/light appearance and preference persistence, creator search/following, photo upload and private draft saving, profile controls, notification filtering, collaboration acceptance into a private plan, full-screen navigation/saves, collection persistence, and Saved-to-Following navigation. No browser warning/error logs were recorded during these checks.
- Fixed issues found during review: Saved-to-Following routing, Following search availability, full-screen scroll position on web, visible save errors inside the full-screen modal, selected activity-tab semantics, and narrow-header overflow. Private or unreviewed posts are excluded from the derived profile cover.

## Delivery

The follow-on 0.4.0 native video work is documented in [VIDEO-BETA.md](VIDEO-BETA.md). That update adds server capabilities and phone-only recording/playback; the UI-only validation above remains the historical baseline.

On September 22, revision `c1be38b` deployed the refreshed web interface and video-capable backend to [joincrewroom.com](https://joincrewroom.com/). Existing photo content loaded successfully, and video creation/feed controls remain native-only. The beta signup page is unchanged. Signed iPhone candidate 0.4.0 (3) is ready for the owner's physical-device testing; the existing TestFlight release is unchanged until that acceptance and the remaining release checks are complete.

The temporary preview server, QA database, seeded local-only accounts, and export/test logs are in ignored `work/` paths and are not release artifacts.
