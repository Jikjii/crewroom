# Crewroom iPhone video beta

Updated September 23, 2026 EDT. The interface refresh, video backend and hybrid photo/text moderation are deployed. On signed iPhone preview **0.4.0 (4)**, the owner confirmed cellular sign-in, a 10–15 second recording and preview with sound, private-draft persistence and playback/seeking after restarting the app, and audio stopping when leaving playback. On September 23, the owner also confirmed approved public-video playback and camera cancellation leaving Create usable in the existing 0.4 iPhone app; the installed build for those later checks was not reconfirmed. The iPhone model and iOS version were not provided; the wider physical checklist below remains unverified.

**Sound-fix candidates:** store 0.4.0 (6) and installable preview 0.4.0 (7) finished from `73d469c`. Apple upload is queued; the owner’s preview-7 mute/unmute swipe check is pending. See [the current release record](TESTFLIGHT-0.4.0.md) for links and results.

App Store distribution **0.4.0 (5)** finished from source `e753873`, and its EAS submission succeeded at `2026-09-23T03:56:20Z`. Apple processing is Complete; build 5 was **Approved** at September 23, 11:55 AM EDT and observed **Testing** around 1:16 PM EDT in the existing group (5 testers). Katherine’s corrected entry shows Invited September 23. A replacement will address the owner's report that every feed video resets to muted. The fix keeps the sound preference across clips while the feed stays open; closing/reopening starts muted again. TypeScript, 12/12 native-configuration/video-selection tests and iOS/Android exports passed; component/device verification of the sound behavior remains pending. The sound fix is in store build 6 and installable preview build 7, both from `73d469c`. Existing TestFlight 0.3.0 (2) remains available. Follow [TESTFLIGHT-0.4.0.md](TESTFLIGHT-0.4.0.md) for the current release record; [preview build 4](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/3239cd1b-a202-4506-8453-23adb4b1099b) remains the owner-tested binary.

## Scope

- Record a short clip through the phone's camera interface, or choose a video from the photo library. Preview it before uploading; add the existing title, making notes, credits, and collaboration details.
- Use one video per post, up to 60 seconds and 50 MiB (shown as 50 MB in the app). SDR MP4 and MOV inputs are processed into an MP4 and a still preview. HDR clips are rejected with guidance to choose/export SDR or turn off HDR Video in camera settings; the beta does not attempt HDR tone mapping. The original upload is temporary, not the published copy.
- Browse videos in the native app. Existing saving, creator profiles, comments, reports, blocking, and collaboration workflows still apply.
- Keep the web experience focused on photos, project details, and the existing creative network. The beta does not introduce a web camera or web video feed.
- Photo/text submissions now publish after successful automatic screening. [HYBRID-MODERATION.md](HYBRID-MODERATION.md) records the live activation and checks; the Starter configuration keeps all videos under human review. A private draft can be viewed by its owner immediately.

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

The [browser moderation desk](https://joincrewroom.com/moderation) is live for the owner's personal operator account. Automatic photo/text screening is active; Starter videos and their sound remain under human review. Preview 0.4.0 (4) includes the updated moderation labels and report categories. See [HYBRID-MODERATION.md](HYBRID-MODERATION.md) for the active configuration and dashboard workflow.

Continue daily **Review queue** and **Reports** checks in the desk. Choose **Inspect submission**, watch the **entire processed clip with sound**, inspect the poster, and read its title, notes, alternative description, credits, and collaboration fields before recording a decision. Review the creator profile if it is also pending. Reading the caption or checking the poster alone is insufficient. Review the actual processed file referenced by the inspection, not a creator's separate social-media copy.

The following Render CLI procedure is a recovery alternative; normal approvals no longer need terminal commands. List pending submissions and inspect the exact post ID returned by the queue:

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
6. Update App Store Connect review information and privacy answers to accurately describe chosen videos and recorded audio. Give Apple's reviewer a working dedicated ordinary review account and explain automatic photo/text checks, held flagged submissions and human video review. Check the public privacy page describes camera/microphone use and processed media.
7. Submit the tested candidate to private TestFlight, wait for Apple's processing/review as applicable, and make it available to the existing private group. Record the build number and actual status. Do not describe submission as acceptance or a public App Store launch.

## Physical iPhone acceptance

Use a disposable creator account and a separate viewer account. Record iPhone model, iOS version, app version/build, backend revision, date, and pass/fail for each group. Existing accounts should not be deleted for testing.

**Owner-reported results, September 22 EDT, preview 0.4.0 (4):** cellular sign-in; 10–15 second recording and preview with sound; private draft retained after restarting the app and playable/seekable; audio stops when leaving playback. Device model and OS are not recorded. This establishes those specific checks only, not every item in the following matrix.

**September 23 follow-up, existing 0.4 iPhone app (installed build not reconfirmed):** approved public video plays in Videos, and canceling the camera leaves Create usable. Swiping to each new feed video resets mute, which the replacement candidate must fix. Verify unmute → swipe forward/back → mute → swipe again, plus audio stopping on leaving/backgrounding the feed, before external tester notification.

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
| Feed playback | Swipe through several clips; only the visible one plays. Unmute, swipe forward/back, then mute and swipe again: the preference carries across clips while the feed stays open. Pause, seek, open details, and navigate away. Backgrounding/locking the phone or closing the feed stops playback. Return without doubled audio or wrong-clip playback. A newly opened feed starts muted. |
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
- September 22: preview **0.4.0 (4)** succeeded with client revision `5af210e`. The owner subsequently confirmed the specific physical checks recorded above. Build 3 is superseded; its package checks remain historical evidence only.
- September 22: hybrid moderation is active at backend revision `1f3d931`; 60 targeted regression tests and all 8 bounded live provider cases passed. The owner's browser moderation access was verified. See [HYBRID-MODERATION.md](HYBRID-MODERATION.md) for the complete evidence and limitations.
- September 22: a read-only native readiness audit found no confirmed release-blocking issue, and native configuration/video-selection tests passed 12/12. This does not replace physical permission, network or camera checks.
- September 22: App Store distribution **0.4.0 (5)** finished from `e753873`: [EAS build](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/dc9b03e3-d48f-400b-8c10-516db9c43b91). IPA identity and permission descriptions were inspected. Its embedded App Store profile has no device allowlist, `get-task-allow=false` and `beta-reports-active=true`; this was metadata inspection, not independent certificate-chain validation.
- September 22: deployment `dep-dapkqh49v7es738vdtcg` made `7e3d78d` Live, starting at 11:53:40 PM EDT and completing in 1m05s. New live-check helpers passed 5/5 local tests; live private-video API acceptance passed 6/6 cases in 27 requests and 4 cleanup requests. Both synthetic fixture accounts were deleted and no public posts were created.
- September 22: an isolated live R2 round trip verified a synthetic MP4 and poster, using 23 cloud requests plus 5 cleanup requests. Four fixture objects/two media files were cleaned up; production database and media were untouched. Fresh production backup `run-1790135803651-e0d9350b-b5f3-4519-afe8-2ec929ef5e45` (`2026-09-23T03:57:01.854Z`, 26,229,702 encrypted bytes, 19 media files) also passed isolated restore verification. Read-only production counts show 11 images, 4 videos and 4 video posters, confirming that the production restore included real videos and posters.
- September 22: [EAS submission `42060c69-ac89-45ce-a06b-bb5702a1a036`](https://expo.dev/accounts/geraldogs-team/projects/crewroom/submissions/42060c69-ac89-45ce-a06b-bb5702a1a036) finished at `2026-09-23T03:56:20Z`. Apple showed Processing at 11:56 PM EDT. Beta Description and Review Notes were saved, along with the privacy policy URL. App Privacy collection answers remain a draft proposal.
- September 23: owner confirmed public Videos playback and camera cancellation in the existing 0.4 iPhone app, and reported mute resetting on each feed clip. Source now preserves the open feed's sound preference. TypeScript, 12/12 configuration/selection tests and iOS/Android exports passed; no component/device sound test is yet recorded.
- Still pending: signed sound-fix candidate, physical swipe verification, replacement Apple processing/review and TestFlight distribution. Broader permission/media/report/block checks and final App Privacy answers remain separately unverified.

| Release evidence | Result |
|---|---|
| Source revision and automated checks | Video implementation `c1be38b`: 95/95 tests, TypeScript, Expo Doctor 21/21 and web/iOS/Android exports. Moderation follow-up: 60/60 targeted tests and 8/8 live provider cases. Native release audit: 12/12 configuration/selection tests. Current store-build source: `e753873`. |
| Deployed backend revision and date | `7e3d78d`, September 22 at 11:53:40 PM EDT; deployment Live after 1m05s. Hybrid photo/text screening active; video automation disabled. Live private-video API checks 6/6 passed. |
| Live video/poster restore drill | Isolated synthetic R2 MP4/poster round trip passed and cleaned up. Fresh production snapshot with 11 images, 4 videos and their 4 posters also passed isolated restore verification. |
| Signed iPhone build and installation | Ad hoc 0.4.0 (4) installed and exercised by owner. Store 0.4.0 (5) Testing; sound-fix replacement pending; replacement build number not yet recorded. |
| Physical iPhone checklist | Owner-reported cellular sign-in, recording with sound, private-draft persistence/playback/seeking, audio stop, approved public-video playback and camera cancellation passed. Feed sound reset reported; replacement swipe check and device/OS details pending. |
| App Store Connect privacy/review update | Beta Description, Review Notes, What to Test and privacy URL saved. Data-collection categories remain proposed. |
| TestFlight build/status | 0.4.0 (5) Approved at 11:55 AM EDT September 23, then observed Testing around 1:16 PM EDT (5 testers). Katherine Invited September 23. Existing 0.3.0 (2) also Testing; group invitation-link setting unchanged. |

- September 23, 12:06 AM EDT (historical): Apple upload processing Complete; build 5 submitted for Crewroom Private Beta (4 testers), **Waiting for Review**. What to Test saved. Automatic notification was disabled while public-video/camera-cancel confirmation was then pending. The live public feed returned two approved videos and anonymous MP4 range requests returned HTTP 206. Follow the current distribution steps in [TESTFLIGHT-0.4.0.md](TESTFLIGHT-0.4.0.md).
