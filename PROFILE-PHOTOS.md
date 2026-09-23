# Profile photos

Released September 23, 2026. This update adds profile-photo selection, replacement and removal to the web and native app. The website is Live and iPhone **0.4.0 (8) is Testing** in the existing private beta group. Physical iPhone checks remain unverified.

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

The profile-photo web/API update is **Live** on `https://joincrewroom.com`. [Render deployment](https://dashboard.render.com/web/srv-damc8mp42hec738hb7mg/deploys/dep-daq4guegekts73bi2fq0) deployed source `ad24ff10dd908aa506ae2dd19d0ccb50af1cba25` on September 23 at 5:45 PM EDT and reported **Deploy succeeded | Live**. The public health endpoint returned `{"ok":true}` and the signed-in live editor showed **Profile photo → Add photo**. This live verification did not modify the owner's profile.

iPhone production **0.4.0 (8)**, [Expo build `16e42e95-7e36-40ef-b402-3102a1cf1cb3`](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/16e42e95-7e36-40ef-b402-3102a1cf1cb3), finished at `2026-09-23T21:47:15.351Z` from the same source. [Submission `8a19936f-ffb2-46f1-a3d4-e7062d3aac88`](https://expo.dev/accounts/geraldogs-team/projects/crewroom/submissions/8a19936f-ffb2-46f1-a3d4-e7062d3aac88) **Succeeded**, verified around 6:42 PM EDT. Expo records submission at 6:13 PM EDT, and Apple records the build upload at 6:13 PM with processing **Complete**. Earlier queue displays were superseded by this successful upload. Automatic internal-TestFlight setup was disabled; the existing external group was configured separately.

Apple build UUID `1d51703b-a378-4fdf-81ff-0c731d642ce0`: the What to Test notes below were saved (Apple showed **Saved**), then build 8 was added to **Crewroom Private Beta** (`858d3c31-fabf-41d3-8b80-50eff303d459`) using **Submit for Review** with **Automatically notify testers** checked. Around 6:45 PM EDT, the [group builds page](https://appstoreconnect.apple.com/teams/a4e81f79-a4b7-4821-9a96-b0ecc9886358/apps/6813563844/testflight/groups/858d3c31-fabf-41d3-8b80-50eff303d459/builds) showed **0.4.0 (8) — Testing**. The group has **5 testers and 4 builds**; 0.4.0 (6), 0.4.0 (5), and 0.3.0 (2) all remain Testing. Existing testers, invitation-link setting and private review credentials were preserved. No separate manual Notify action was required; notification delivery/receipt remains unverified. This completes the existing private beta update, not a public App Store release.

Follow-up `finish-crewroom-testflight-update` was paused after build 8 became available to the group. No duplicate build/submission, account permission change or paid upgrade was made.

Remaining owner check: update Crewroom in TestFlight, then use **Profile → Edit profile → Add/Change/Remove photo → Save**. Test camera/library selection, crop, cancel, undo, persistence after reopening, and initials after saved removal. This signed installation and physical camera/library/crop behavior have not yet been verified.

### What to Test

Add a profile photo in Profile → Edit profile, or take one with the camera. Crop and save it, then close/reopen Crewroom and confirm it remains. Replace it and verify the new photo appears on your profile and beside your work. Try Remove photo, Undo photo change, and finally save removal to return to initials. Canceling photo selection or the editor should preserve your saved photo. Public profile changes go through the existing safety checks. Continue checking video-feed sound across swipes. Send feedback through TestFlight or support@joincrewroom.com.
