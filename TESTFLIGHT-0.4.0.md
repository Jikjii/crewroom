# Crewroom 0.4.0 private iPhone beta

Updated September 23, 2026. **0.4.0 (5) is Testing**, verified in App Store Connect around 1:16 PM EDT, for Crewroom Private Beta (5 testers). It had been Approved with manual notification pending at 11:55 AM EDT; the later browser check found it already distributed without this release task notifying testers. Katherine’s corrected entry shows Invited September 23. The owner confirmed public-video playback and camera cancellation in the existing 0.4 iPhone app (current installed build not reconfirmed), but reported that every new feed video starts muted. Sound-fix store candidate **0.4.0 (6)** finished from source `73d469cf6f52959e709be59367e982cb26ccbe36`; the owner reported the requested preview **0.4.0 (7)** sound checks passing on September 23. As of around 1:30 PM EDT, its EAS submission remains Queued in the Free Tier Queue, and App Store Connect has no build 6 yet. This remains a private TestFlight release.

## Release evidence

| Item | Observed status |
| --- | --- |
| App identity | `com.joincrewroom.app`; Expo `geraldogs-team/crewroom`; App Store Connect app `6813563844`. |
| Hosted service | `https://joincrewroom.com`; backend `7e3d78d` is Live with photo/text screening and human video review. [Render deployment](https://dashboard.render.com/web/srv-damc8mp42hec738hb7mg/deploys/dep-dapkqh49v7es738vdtcg) started September 22 at 11:53:40 PM EDT and completed in 1m05s. |
| Signed preview | [0.4.0 (4)](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/3239cd1b-a202-4506-8453-23adb4b1099b), native client revision `5af210e`, succeeded and exercised by owner. |
| Sound-fix candidate | [0.4.0 (6)](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/78bbc76a-16b3-4ef5-9319-a5937d0fa561), source `73d469cf6f52959e709be59367e982cb26ccbe36`; production build **FINISHED** September 23 at 1:19 PM EDT. EAS submission [ce7a8b9a-11c5-4bc4-97ec-edf2fc42ca28](https://expo.dev/accounts/geraldogs-team/projects/crewroom/submissions/ce7a8b9a-11c5-4bc4-97ec-edf2fc42ca28) **Queued** in the Free Tier Queue as verified around 1:30 PM EDT; logs say “Waiting for submission process to start.” The [Expo workflow](https://expo.dev/accounts/geraldogs-team/projects/crewroom/workflows/01a0cf48-f41c-717b-bd83-12539fc36ebe#job-01a0cf48-f41c-79dc-87d6-63cd2309d473) was enqueued at `2026-09-23T17:21:05Z` and displayed an estimated Free Tier queue wait of ~77.1 minutes at that check. This is an Expo queue estimate, not an Apple processing/review duration. App Store Connect lists build 5 but no build 6 yet. Automatic TestFlight setup was disabled. |
| Sound-fix device preview | [0.4.0 (7)](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/0d7ef017-834a-4c47-adc3-650ed4a7ed12), internal distribution from the same native source `73d469c`; **FINISHED** September 23 at 1:24 PM EDT. Install button verified in Expo. On September 23, the owner replied “everything is working” to the preview-7 checks: unmute and swipe forward/back, mute and swipe again, and leave the feed with audio stopping. These are owner-reported passes, not instrumented results; device/OS were not supplied. |
| Available store build | [0.4.0 (5)](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/dc9b03e3-d48f-400b-8c10-516db9c43b91), source `e7538730a5fb0924a540b410bff30a5b422a716c`; **FINISHED**. Testing; a sound-fix update is being prepared. |
| Store package inspection | IPA identity/version and camera/microphone/library descriptions match the configuration. Embedded profile identifies `A48T68DM6A.com.joincrewroom.app`, has no device allowlist, sets `get-task-allow=false` and `beta-reports-active=true`. Embedded metadata was read; this was not independent certificate-chain validation. |
| EAS submission | [42060c69-ac89-45ce-a06b-bb5702a1a036](https://expo.dev/accounts/geraldogs-team/projects/crewroom/submissions/42060c69-ac89-45ce-a06b-bb5702a1a036) **FINISHED** at `2026-09-23T03:56:20Z`; Apple showed Processing at 11:56 PM EDT. |
| Apple beta review | Build `7e6b3fd3-3a3d-4c44-93ef-11431f991507`: upload Complete; Approved at 11:55 AM EDT, then observed **Testing** around 1:16 PM EDT in Crewroom Private Beta (5 testers). |
| Existing TestFlight | 0.4.0 (5) and 0.3.0 (2) are Testing; Katherine’s corrected tester entry is Invited September 23. |
| Automated video checks | Historical implementation validation: 95/95 tests, TypeScript, Expo Doctor 21/21, web/iOS/Android exports; see [VIDEO-BETA.md](VIDEO-BETA.md). |
| Moderation acceptance | 60/60 targeted regression tests; 8/8 bounded live provider fixtures in 13 HTTP requests; operator browser access verified. See [HYBRID-MODERATION.md](HYBRID-MODERATION.md). |
| Earlier native audit | 12/12 native-configuration and video-selection tests passed before the owner reported the feed sound issue. |
| Feed sound fix | Source keeps the mute preference in the open feed and passes it to each active native player. TypeScript, 12/12 existing configuration/selection tests and iOS/Android exports passed. Both signed candidates finished. The owner reported the preview-7 swipe sound and leave-feed audio-stop checks passing on September 23. No automated component sound test or store-6 installation result is recorded. |
| Live-check regression tests | 5/5 tests passed for the bounded video acceptance and isolated backup helpers. |
| Live private-video API acceptance | 6/6 cases passed in 27 requests plus 4 cleanup requests. Both fixture accounts were deleted; zero public posts were created. |
| App Store Connect metadata/privacy | Beta Description, Review Notes and build-specific What to Test saved; the disabled Save button confirmed persistence. Privacy Policy URL saved as `https://joincrewroom.com/privacy`. Collection categories below remain a draft proposal, not saved/published answers. |
| Isolated R2 video backup/restore | Synthetic MP4 and poster round trip passed: 23 cloud requests, 5 cleanup requests, 4 fixture objects and 2 media files. Fixture objects were cleaned up; production database/media were untouched. |
| Fresh production backup/restore | `run-1790135803651-e0d9350b-b5f3-4519-afe8-2ec929ef5e45`, created `2026-09-23T03:57:01.854Z`, 26,229,702 encrypted bytes and 19 media files; isolated restore verified successfully. Read-only production counts identify 11 images, 4 videos and their 4 posters, establishing real video-inclusive recovery. |

Builds 4 and 5 share native behavior; the intervening server/provider corrections changed server code, tests and documentation. The feed sound fix changes native behavior and is included in store build 6 and preview build 7. The owner reported the requested preview-7 sound checks passing; store-6 installation remains a separate check.

The live API cases exercised synthetic upload/poster generation, private-content denial to signed-out and unrelated users, owner playback and authorized byte ranges/HEAD requests, post deletion revoking access, and account deletion revoking sessions/media access. These were bounded private fixtures, not device public-feed, report/block or human-review tests. The separate R2 exercise establishes a video/poster round trip without restoring over production; the fresh production snapshot and restore were verified independently.

The existing beta group already has a public TestFlight invitation link enabled; this release work observed that setting and did not change it. That link is distinct from a public App Store listing.

## Physical evidence and remaining acceptance

On **preview 0.4.0 (4)**, the owner reported:

- Sign-in works over cellular.
- A 10–15 second recording can be previewed with sound.
- A private video draft survives restarting the app and plays/seeks afterward.
- Audio stops when leaving playback.

On September 23, the owner also confirmed that an approved public video plays in Videos and canceling the camera leaves Create usable. These later checks were on the existing 0.4 iPhone app; its installed build was not reconfirmed.

The same September 23 report identified a feed bug: after unmuting a video, swiping to the next video resets it to muted. The source fix preserves mute/unmute across forward/back swipes and pagination while the feed stays open. Closing and reopening the feed starts muted again. In response to the preview **0.4.0 (7)** installation and test request, the owner replied “everything is working” on September 23: unmute → swipe forward/back, mute → swipe again, and leave the feed → audio stops all passed by owner report. This does not establish a store-build-6 installation test, background/lock behavior, reopening behavior, or the broader checklist.

The iPhone model and iOS version were not provided. Permission denial, library-picker cancellation, both cameras, library/iCloud/SDR format variations, HDR rejection, upload interruption and retry, boundary files, slow playback, two-account moderation/report/block/deletion, and the broader checklist in [VIDEO-BETA.md](VIDEO-BETA.md) remain unverified. Record additional results separately.

## What to Test summary (saved in App Store Connect)

Crewroom 0.4.0 adds a refreshed creative network, short cosplay videos and clearer sharing status. Record or choose an SDR MP4/MOV clip up to 60 seconds and 50 MB. Confirm sound, orientation, playback and seeking; save a private draft, restart the app and reopen it. Try playback over cellular and confirm audio stops when you leave or background the app.

Public photos and text publish after automatic safety checks pass. Flagged submissions and all public videos stay private until an operator reviews them. Test the pending status, creator profiles, saving, following, comments, collaboration requests/private crews, and report/block options. Tell us about permission errors, interrupted uploads, unexpected visibility or playback problems. HDR video is not supported in this beta. Please use only content and audio you have permission to share.

Send beta feedback through TestFlight or `support@joincrewroom.com`. The operator's daily review does not imply round-the-clock support.

## Build 6 What to Test (prepared; not yet saved in Apple)

This update fixes video-feed sound resetting on every swipe. Open Videos, unmute a clip with sound, and swipe forward and back: sound should stay on. Mute once and swipe again: the next clip should stay muted. Your choice lasts while the feed is open; reopening it starts muted. Confirm audio stops when leaving or backgrounding the feed. Continue checking recording, private drafts, public video review, and the existing collaboration features. Send feedback through TestFlight or support@joincrewroom.com.

## Beta App Review content

The Beta Description, Review Notes and build 5 What to Test are saved in App Store Connect. The text below records the review context; the exact saved fields remain the source of truth. The replacement build will need its own What to Test notes covering the sound fix.

Crewroom is an 18+ cosplay creative network and private collaboration planner. Please use the dedicated ordinary review account supplied in App Store Connect's private sign-in fields. It has no moderator permissions. Credentials must remain in those fields, not this repository or public notes.

The installed app connects to the hosted HTTPS service and does not require a development computer. Create supports chosen photos and one short video per post. Camera and microphone access are requested when recording, not merely browsing. Private drafts are visible only to their owner. Photo/text public submissions are screened by Sightengine; passing revisions publish automatically once the creator profile also passes. Flagged, uncertain and failed checks remain held. All videos and their sound receive human review under the current plan. Public edits trigger review again.

In-app reporting and blocking are available from content/creator options. The operator uses a restricted browser moderation desk for held submissions, reports, removal and account suspension, and has agreed to check it daily. Support and published policies are available in the app. Account & privacy includes account deletion. Public demo imagery is labeled fictional/AI-illustrated. This release does not add advertising or purchases. The beta group's existing public TestFlight invitation-link setting was not changed.

## Proposed App Privacy answers

This is a source-based proposal, not confirmation that answers were saved or published in App Store Connect. Apple's [privacy categories and collection guidance](https://developer.apple.com/app-store/app-privacy-details/) apply to retained off-device data, including optional core features. Private messages and generic free-form content have their own categories; exact location need not come from GPS. Account association makes the listed records linked to the user. Safety processing does not by itself constitute advertising tracking.

For the following types, propose **linked to user: Yes**, **used for tracking: No**. The purposes reflect current behavior, not planned monetization.

| Apple data type | Current Crewroom data | Proposed purpose |
| --- | --- | --- |
| Name | Account/display names and crew-member names | App Functionality |
| Email Address | Sign-in, password recovery and support | App Functionality |
| Other User Contact Info | Explicit Instagram and website/shop fields | App Functionality |
| User ID | Account UUID, handle and relationship identifiers | App Functionality; Product Personalization |
| Contacts | Follow relationships and crew membership/social graph | App Functionality; Product Personalization |
| Photos or Videos | Chosen uploads, converted clips and posters | App Functionality |
| Audio Data | Recorded sound in video clips | App Functionality |
| Emails or Text Messages | Private collaboration messages and participants | App Functionality |
| Other User Content | Bios, captions, comments, credits, roles, interests, tasks and plans | App Functionality |
| Customer Support | Reports, appeals and support submissions | App Functionality |
| Coarse Location | Explicit profile/opportunity city or broad area | App Functionality |
| Product Interaction | Saves, follows, notification-read state and activity records | App Functionality; Product Personalization |
| Other Data Types | Age/terms confirmation, security rate limits and moderation records | App Functionality |

Product Personalization here refers to the Following/Saved views driven by user choices. It does not imply a recommendation model. The explicit private meeting/agenda location fields can hold exact venues; including **Precise Location / linked / App Functionality / not tracking** is the conservative interpretation. There is no GPS permission or coordinate collection. A generic caption containing a place is not the basis for that recommendation.

Source anchors: `server/app.mjs` account/crew schema and rate limiter; `server/social.mjs` social schema; `server/accounts.mjs` consent/recovery records; `src/social/Profile.tsx` contact/city fields; `App.tsx` explicit meeting/agenda fields; `src/account/PublicPages.tsx` published disclosures.

### Questions to resolve before final attestation

- IP addresses persist in the abuse-rate-limit map beyond individual requests; the immediate-discard exception does not apply. Source does not geolocate IPs, collect hardware/advertising identifiers or retain search history in a dedicated store.
- Source error logs contain fixed error codes/names without request URLs, IPs, emails or user IDs. No mobile analytics/crash SDK is installed. [Render HTTP request logs](https://render.com/docs/logging) depend on workspace plan; inspect actual logging settings before deciding whether retained URLs/query strings or connection data require additional search/diagnostic categories.
- [Resend open/click tracking](https://resend.com/blog/open-and-click-tracking) is configurable per domain, outside source. Verify its current settings before making a definitive analytics statement. Delivery and requested recovery emails currently serve app functionality.
- The separate website waitlist has optional launch-update consent. Do not assume native account emails are used for marketing merely because that separate list exists. Reassess if native data is reused for campaigns or matching ad audiences.
- Sightengine receives chosen public text/photos for safety checks; private drafts and private crew plans are excluded. Videos/audio are currently reviewed by humans. R2 backups are restricted recovery copies. Provider retention and configured logging must remain consistent with the published privacy policy.
- Phone Number, device ID, purchases, health/sensitive data and advertising data have no intentional collection path in the audited native source. The operator's private Apple review phone number is not a user data-collection feature.

## Remaining distribution steps

The owner authorized an automatic follow-up on September 23. Codex heartbeat `finish-crewroom-testflight-update` is active every 15 minutes to finish this existing submission/release, report completion or required action, and disable itself after distribution. No replacement submission or paid queue upgrade is authorized by that follow-up.

1. Store build 6 finished; as of around 1:30 PM EDT its EAS submission remains Queued in the Free Tier Queue, waiting to start. App Store Connect has no build 6 yet. Wait for upload, then verify Apple processing/review status. Preview build 7 from the same native source passed the owner-reported swipe sound and leave-feed checks on September 23. TypeScript, existing native tests and native exports also passed. Build 5 remains available.
2. Submit the replacement to the existing beta group and wait for any required Apple processing/review. Once approved, choose **Notify Testers** if automatic notification is disabled, following [Apple’s instructions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers). Verify the replacement reaches **Testing**.
3. Katherine’s corrected entry (`rijokatherine511@gmail.com`) now shows Invited September 23; verify the replacement is available to her after release. Preserve the existing audience and invitation-link setting.
4. Install the replacement through TestFlight and confirm launch/sign-in as a final store-signed installation check. Record device/OS if provided.

Read-only live checks after operator approvals returned HTTP 200 with two public videos and HTTP 206 video/mp4 for an anonymous byte-range request. The moderation history records the operator’s approvals. These API results are separate from the owner's later public-playback and camera-cancel confirmations above. App Privacy collection categories remain a proposal for final store preparation; no collection answers were published. Never record review credentials.
