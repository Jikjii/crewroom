# Crewroom iPhone video beta

Updated September 22, 2026. The interface refresh and video-capable backend are deployed. Signed iPhone candidate **0.4.0 (3)** is ready for the owner's registered iPhone: [open the Expo installation page in iPhone Safari](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/f7f2b4d4-a3e3-4558-b8da-6f1ba712e0b1), then choose **Install**. Physical-device acceptance is still pending. The current private TestFlight release remains 0.3.0 (2); this candidate has not been distributed to that group. The previous photo-only iPhone tests in `NATIVE-TESTING.md` do not validate this release.

## Scope

- Record a short clip through the phone's camera interface, or choose a video from the photo library. Preview it before uploading; add the existing title, making notes, credits, and collaboration details.
- Use one video per post, up to 60 seconds and 50 MiB (shown as 50 MB in the app). SDR MP4 and MOV inputs are processed into an MP4 and a still preview. HDR clips are rejected with guidance to choose/export SDR or turn off HDR Video in camera settings; the beta does not attempt HDR tone mapping. The original upload is temporary, not the published copy.
- Browse videos in the native app. Existing saving, creator profiles, comments, reports, blocking, and collaboration workflows still apply.
- Keep the web experience focused on photos, project details, and the existing creative network. The beta does not introduce a web camera or web video feed.
- Keep public submissions behind human review. A private draft can be viewed by its owner immediately; submitting for public sharing does not publish automatically.

This first version does not add music licensing, effects, a timeline editor, live streaming, or an algorithmic recommendation system. Record only material and audio you have permission to share.

## Service and access requirements

Deploy the video-capable backend **before** distributing the new native client. The service needs FFmpeg and ffprobe in its runtime image, the additive media schema, authenticated media streaming, the extended review commands, and the video-aware backup helper. Old photo posts and older app clients must continue to work after this deployment.

The existing Render persistent disk stores videos and their posters alongside photos. Cloudflare R2 remains a private recovery destination; it is not a public video host. Do not enable public access on the backup bucket.

The upload pipeline bounds input size and duration, transcodes accepted files, removes container metadata, and creates a poster. Input is limited to 4K and 120 fps; output uses H.264/AAC up to 1280×720 or 720×1280 at 30 fps, with a 24 MiB clip limit. It accepts one processing job at a time on this small service; an overlapping upload may ask the creator to retry. Receiving the upload has a two-minute time limit; processing has a **45-second total deadline**, including input validation, encoding, and poster creation, to stay below the native transport's idle timeout. A complex but otherwise valid clip may require a shorter or lower-resolution export. A disk-space guard refuses video processing with less than 256 MiB free. Retrying should leave the text and selected local clip available. This is an initial small-beta capacity decision, not a large-scale video delivery system.

Private or unapproved video and poster requests require owner authorization. Native playback must pass the signed-in session through request headers and leave persistent video caching disabled. A token must never be added to the media URL. Authorization must be checked on ordinary requests and byte-range requests used for seeking. Already-delivered media cannot be recalled from another person's device.

The backup manifest must contain **both** each referenced MP4 and its poster. The helper supports older databases that have no `posterFilename` column. Local/cloud backup and restore reject missing referenced files rather than silently omit them. The existing `BACKUP_MAX_BYTES=1073741824` guard is a **1 GiB snapshot limit**, so videos can reach it much faster than photos. Monitor Render disk usage, backup status, and R2 usage; seven daily full snapshots multiply active media storage. Raising the cap requires checking available staging/disk space and the hosting budget first.

Video admission now counts stored media plus the database and its journal files. Its ceiling is the smaller of **768 MiB** or **75% of `BACKUP_MAX_BYTES`**, with room reserved for a processed clip and poster. `CREWROOM_VIDEO_STORAGE_MAX_BYTES` can lower that ceiling; it cannot raise it above those limits. A full-budget error directs the creator to support. Photo uploads retain their existing behavior, so this video check is not a substitute for overall storage/backup monitoring. Soft-deleting a post does not reclaim its media files, and abandoned uploads also consume capacity; account deletion queues both video and poster cleanup.

At startup, the backend removes interrupted uploads from its strictly named `.video-upload-*` temporary directories, excluding symlinks and active uploads. This prevents raw originals from a crashed process being retained indefinitely after restart. Ordinary success/failure paths also remove their temporary upload directory. This cleanup does not delete completed published media or restore production data.

## Operator review: watch the whole video

The prepared hybrid-moderation follow-up adds a browser review desk and optional automated screening; see [HYBRID-MODERATION.md](HYBRID-MODERATION.md). It is not included in signed candidate 0.4.0 (3) and has not been activated. The instructions below continue to apply to human video reviews, including videos held by the automatic checks.

Continue the daily pending-submission and report checks described in `MODERATION.md`. For video, reading the caption or checking the poster is insufficient. Watch the **entire processed clip with sound**, inspect the poster, and read its title, notes, alternative description, credits, and collaboration fields before approval. Review the actual processed file referenced by the inspection, not a creator's separate social-media copy.

On Render, list pending submissions and inspect the exact post ID returned by the queue:

```sh
cd /app
node server/moderate.mjs --db /var/data/crewroom.sqlite queue
node server/moderate.mjs --db /var/data/crewroom.sqlite inspect post ACTUAL_POST_ID
```

`ACTUAL_POST_ID` above is a placeholder. Replace it with the complete `post_...` value from the queue. The inspection returns the current version fingerprint and media paths. An approved public author profile is also necessary for a public post to appear.

To create a private review packet:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite inspect post ACTUAL_POST_ID --html /tmp/crewroom-video-review.html
```

Download that packet through an authenticated operator connection, open it locally, and complete the full review. Keep it outside public web/media folders; delete private review copies after use. A generated packet is not a completed review. If the audio/video cannot be played, keep the submission pending while resolving playback.

Only after reviewing the exact content, use its complete fingerprint:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite approve post ACTUAL_POST_ID --version EXACT_VERSION_FROM_INSPECT --videos-reviewed
```

`--videos-reviewed` asserts full human video review. For a post that also contains images, the CLI additionally requires `--images-reviewed`. Neither flag starts an automated classifier. A changed clip, poster, text, or sharing setting invalidates the inspected fingerprint; inspect and review the new version again. An edited public post remains hidden pending approval.

## Release order

1. Finish server and native implementation, run integration tests, type checking, and web/native exports. Inspect the resolved iOS camera, microphone, and library permission descriptions. Bundle export alone is not a signed-build or device test.
2. Deploy the backend and confirm startup, health, video processor availability, photo compatibility, and persistent storage. Verify a recent successful backup before any migration. No automatic production test should publish test posts to real users.
3. Use disposable accounts to test an uploaded clip, its poster, moderation, authorized seeking, re-review, unpublishing, blocking, and deletion against the deployed service. A second account and a signed-out session must not retrieve pending/private media. Remove disposable test data afterward.
4. After at least one video is represented in a completed backup, run `node scripts/backup-worker.mjs --verify-latest` from `/app`. It restores into isolated temporary storage and must verify the database, video, and poster without replacing production data. Record the result; a pre-video restore drill is not this check.
5. Build a signed iPhone candidate against `https://joincrewroom.com`. Test on the owner's physical iPhone first using the acceptance steps below. Use the existing `com.joincrewroom.app` identity and `geraldogs-team/crewroom` project. New native dependencies and permission declarations require a new binary; a web deployment cannot update the installed app.
6. Update App Store Connect review information and privacy answers to accurately describe chosen videos and recorded audio. Give Apple's reviewer a working dedicated review account and explain the review-gated public feed. Check the public privacy page describes camera/microphone use and processed media.
7. Submit the tested candidate to private TestFlight, wait for Apple's processing/review as applicable, and make it available to the existing private group. Record the build number and actual status. Do not describe submission as acceptance or a public App Store launch.

## Physical iPhone acceptance

Use a disposable creator account and a separate viewer account. Record iPhone model, iOS version, app version/build, backend revision, date, and pass/fail for each group. Existing accounts should not be deleted for testing.

| Check | Expected result |
|---|---|
| Fresh launch and upgrade | Existing sign-in, light/dark preference, profiles, photos, and private crews remain usable. No permission prompt appears merely from browsing. |
| Record with sound | Create a 10–15 second clip, approve the requested camera/microphone access, speak a few words, preview the whole clip, and confirm orientation and sound. Front and rear camera work. |
| Permissions and cancel | Denying camera or microphone, limited/denied library access, and canceling the camera/picker leave a usable composer with a clear path to retry or Settings. There is no crash or lost written caption. |
| Library selection | Import portrait and landscape SDR MP4/MOV, an ordinary iPhone camera clip, an SDR HEVC clip, a silent clip, and an iCloud-only selection. A failed cloud download offers a usable retry. Confirm a real iPhone HDR clip is rejected clearly, then select/export SDR and retry successfully. |
| Upload boundaries | Accept a valid clip at or below the limit. Reject a clip over 60 seconds, over 50 MiB, an unsupported/corrupt file, and an invalid extension masquerading as a video. Explain the error without saving an incomplete post. |
| Network interruption | Start an upload, lose the connection, and retry. The app shows progress/errors truthfully, does not duplicate the post, and allows the selected clip/text to be recovered. Repeat on cellular with the development Mac asleep. |
| Private draft | Save a video privately, close/reopen the app, and play/seek with the owner account. The other account and signed-out requests cannot retrieve the clip or poster. |
| Public review | Submit, fully review, approve, and find the post as the viewer. Edit/unpublish it and confirm it disappears for that viewer. A stale approval fingerprint must fail. |
| Feed playback | Swipe through several clips; only the visible one plays. Pause, mute/unmute, seek, open details, and navigate away. Backgrounding/locking the phone or closing the feed stops playback. Return without doubled audio or wrong-clip playback. |
| Slow playback | Test a slow/mobile connection and a temporarily unavailable clip. Show a loading/error state and allow navigation/retry; never freeze the feed. |
| Existing social features | Save a video, open the creator, follow, comment through review, send/accept a collaboration request, and open its resulting private crew. Report and block remain reachable. |
| Removal and recovery | Delete the disposable video/account and confirm both clip and poster become inaccessible; verify queued storage cleanup. Confirm the video-inclusive isolated backup restore drill. |
| Web boundary | Photo upload/discovery still work on the web. No video recording/upload/feed controls are offered there. Video-related posts must have a clear, usable web presentation without an image attempting to render MP4 bytes. |

Use a physical iPhone: the simulator cannot validate its camera hardware. Expo documents native permission declarations and system video capture in [ImagePicker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/), and source headers/player lifecycle in [Video](https://docs.expo.dev/versions/v57.0.0/sdk/video/). Both references are for the project's SDK 57.

## Evidence and remaining checks

- September 22: local FFmpeg and ffprobe were found at `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe`. After deployment, the live Render processor also converted an isolated synthetic video with audio and generated a JPEG poster (320×480, 1.022 seconds, 17,405 poster bytes). The temporary source/output directory was deleted; no production post was created or approved.
- September 22: 18 targeted backup/runtime tests passed, including a video-plus-poster cloud round trip, poster corruption detection, missing/unsafe-poster rejection, and compatibility with photo-only backup schemas. Cloud tests use a fake object store and do not establish the state of the live R2 bucket.
- September 22: final source validation passed 95/95 integration tests, TypeScript, Expo Doctor 21/21, dependency compatibility checks, and web/iOS/Android exports. The native source archive contained no environment files, signing credentials, database, backups, or server/work files.
- September 22: the existing live backup restore drill verified 10 media files (about 1 MB) before deployment. This establishes the existing recovery path, not a video-inclusive live restore.
- September 22: [Render deployment `dep-dapgvi8473hc73dsf28g`](https://dashboard.render.com/web/srv-damc8mp42hec738hb7mg/deploys/dep-dapgvi8473hc73dsf28g) deployed revision `c1be38bb11ad8cc78794f9043ea8e51c92fe5abf`, starting at 7:31:21 PM EDT and completing in 1 minute 36 seconds. Render showed **Live**. Health and video-configuration endpoints returned HTTP 200; the refreshed web interface displayed existing photos and retained photo-only creation.
- September 22: EAS build `f7f2b4d4-a3e3-4558-b8da-6f1ba712e0b1` finished for revision `c1be38b`. The downloaded IPA identifies `com.joincrewroom.app`, version 0.4.0, build 3, minimum iOS 16.4, and includes camera/microphone permission descriptions. ZIP integrity and the embedded provisioning profile's CMS signature were checked; the certificate chain was not evaluated by that check. The ad hoc profile contains the owner's existing registered device. IPA SHA-256: `cd62cfb62376b2dd9e30069b707f4d9a193e3046e1319844435cc186dcf6d0cc`.
- Still pending: physical iPhone acceptance, deployed end-to-end video/account checks, a video-inclusive live restore drill, App Store Connect privacy/review updates, and a new private TestFlight release. Do not infer these from successful exports or the completed signed build.

| Release evidence | Result |
|---|---|
| Source revision and automated checks | `c1be38b`, September 22: 95/95 tests, TypeScript, Expo Doctor 21/21, and web/iOS/Android exports passed. |
| Deployed backend revision and date | `c1be38b`, September 22: Render deployment Live, health/configuration HTTP 200, isolated video/poster processing passed. |
| Live video/poster restore drill | Pending |
| Signed iPhone build and installation | Ad hoc 0.4.0 (3) finished and package checked; physical installation pending. |
| Physical iPhone checklist | Pending |
| App Store Connect privacy/review update | Pending |
| Private TestFlight build/status | New video release pending; existing 0.3.0 (2) unchanged. |
