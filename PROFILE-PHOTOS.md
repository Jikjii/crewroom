# Profile photos

Prepared September 23, 2026. This update adds profile-photo selection, replacement and removal to the web and native app. Deployment and signed-build status will be recorded below when observed.

## Creator flow

Open **Profile → Edit profile**. Choose **Add photo** or **Change photo**; the native app also offers **Take photo**. Native selection uses the system square crop editor; web images use a centered square crop. The editor previews the change locally before upload. **Remove photo** switches back to initials, and **Undo photo change** restores the existing selection. Changes apply only after **Save profile**. Canceling closes the editor without changing the saved photo.

Images are prepared as JPEGs up to 768×768 on the client, then decoded, sanitized and stripped of metadata on the server. A failed profile save retains its staged upload for retry. Unattached staged uploads are discarded on cancellation where possible. The same authorized profile image appears on profiles, creator/post cards, comments, collaboration identities, notification actors, video-feed authors, and the signed-in account header/card. Plain-text crew-member, activity and collaborator-credit records retain initials; they are not authenticated creator profiles.

## Storage and moderation

- Profile responses add `avatar: MediaAsset | null`. `PATCH /api/social/me` accepts `avatarMediaId` as an owned image ID or `null`; omission preserves the existing photo for older clients.
- Private photos remain owner-only. Public profile edits use existing hybrid moderation; the submitted photo and profile text must pass before the profile and its public content reappear. Held photos are available in the existing moderator desk with image-review acknowledgement required.
- Approval fingerprints include the actual image bytes. Replacing or removing a photo invalidates stale decisions. Null-avatar profile fingerprints preserve compatibility with queued/checking jobs created before this migration.
- Replaced/removed images are revoked and reclaimed when no post references remain. Removing an avatar does not delete an independently attached post image. File cleanup uses a durable retry queue. Owner-only `DELETE /api/social/media/:id` refuses still-attached media.
- Existing exports, backups and account deletion cover profile images. Media responses retain authorization and `private, no-store` caching. No new provider, permissions scope, or public release audience is added.

## Validation

- TypeScript passed; web, iOS and Android exports passed.
- Existing native configuration/video-selection tests: 12/12 passed.
- Initial backend regression run: eight new photo tests and 56 existing social/content-review/hybrid/moderation-admin/account tests passed.
- After the compatibility fix: profile-photo, content-review and hybrid-moderation suites passed 38/38, including queued and interrupted legacy-job upgrade scenarios. Tests cover ownership, invalid/video input, CSRF, private/pending/blocked/reported/suspended access, stale approval, replacement/removal, staged cleanup, moderator access, backup and account deletion.
- Browser QA used isolated localhost data, bundled fictional demo images and a synthetic local screening provider. Verified add/preview/save, replacement, reload persistence, undo removal, saved removal and initials fallback in the profile and account header. This did not send fixtures to Sightengine or change production users.
- Source review covered client cancellation/retry/account-switch handling and server moderation/media authorization. Physical iPhone camera/library/crop and this update's signed installation remain unverified.

## Release status

The previous sound-fix release 0.4.0 (6) remains Testing. This profile-photo update is not yet recorded as deployed or distributed.

### What to Test

Add a profile photo in Profile → Edit profile, or take one with the camera. Crop and save it, then close/reopen Crewroom and confirm it remains. Replace it and verify the new photo appears on your profile and beside your work. Try Remove photo, Undo photo change, and finally save removal to return to initials. Canceling photo selection or the editor should preserve your saved photo. Public profile changes go through the existing safety checks. Continue checking video-feed sound across swipes. Send feedback through TestFlight or support@joincrewroom.com.
