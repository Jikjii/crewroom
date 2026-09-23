# Crewroom moderation setup and operating guide

**Deployment in progress September 22, 2026.** The moderation desk/backend at `e813943` is deployed on Render in manual mode. Automatic screening is not activated. Signed iPhone preview 0.4.0 (4) includes the new moderation UI and is ready for physical testing; it has not replaced the private TestFlight release. The owner selected Sightengine Starter ($29/month) for photo/text checks with human video review, and selected their personal Jikjii account for operator access. Keep `MODERATION_MODE=manual` until credentials, operator access, current-model coverage and live acceptance checks are complete.

## What changes for creators

Private drafts remain private and do not enter external screening. Choosing public sharing queues an exact revision of the profile, post or comment. In hybrid mode, an ordinary submission publishes automatically when its checks pass; a post also needs a public, approved creator profile. This removes routine human approval, but it is not zero-delay publication: provider latency and queue length affect the wait.

Flagged content, incomplete coverage, timeouts and malformed provider responses stay hidden for operator review. Public edits receive new checks. Existing pending submissions are not silently published or sent to the provider when hybrid mode is enabled. Review them in the dashboard or deliberately retry eligible submissions.

Reporting creates a durable concern and hides the reported post, comment or profile from its reporter. Repeat taps create one report per account and target. Raw report counts do not remove content globally or ban an account; an operator evaluates the concern. A revised submission with an unresolved report remains held even if an automated check passes. Blocking continues to restrict visibility and contact in both directions.

## Set up your operator access first

1. Choose your own Crewroom account for moderation. **Never use `support@joincrewroom.com`, the shared Apple review login.** Do not share operator credentials with testers.
2. After this update is deployed in manual mode, sign in to Crewroom in a browser and visit [the moderation desk](https://joincrewroom.com/moderation). The access page shows the signed-in account’s immutable `user_…` ID. Your iPhone session does not sign in this browser.
3. Put that exact ID in Render’s `MODERATION_OPERATOR_IDS` environment variable. Separate additional approved operator IDs with commas. Email addresses and client-side roles do not grant access. Restart/deploy the service, return to the desk, and refresh.
4. Verify that your account can open the queue and an ordinary tester cannot open its content or media. A public profile is not required for operator access.

The dashboard works in manual mode, so daily approvals no longer need terminal commands. Existing CLI tools remain available for recovery; they are not the normal workflow.

## Choose and configure screening

Current published Sightengine prices, checked September 22, 2026:

| Plan | Base price | Included operations | Relevant scope |
| --- | --- | --- | --- |
| Starter | $29/month | 10,000/month | Visual and text moderation; keep Crewroom videos under human review |
| Pro | $99/month | 40,000/month | Includes audio moderation needed by Crewroom’s prepared automatic video path |

Both listed tiers charge $0.002 per additional operation. Operations are **not posts**: multiple models, photos, video frames, audio checks and retries can consume multiple operations. These costs are additional to Render and other services. The adapter spaces requests, but does not enforce a monthly spending cap. Review usage and the provider’s billing controls before activation. [Official pricing](https://sightengine.com/pricing)

Create an image workflow and, if enabling video automation, a separate video workflow in Sightengine. Cover explicit sexual content, graphic injury, hate symbols, violence, self-harm and harmful text embedded in media. The prepared adapter lists its expected models in `server/sightengine.mjs`. The image workflow uses five visual models (`nudity-2.1`, `gore-2.0`, `offensive-2.0`, `violence`, `self-harm`); disable legacy workflow Text Analysis. Crewroom separately calls `text-content-2.0` with explicit harmful-text categories and English/Spanish settings for every accepted image and poster. Missing visual model scores or incomplete OCR results stay held. Every required model must run before an ACCEPT decision; do not add an early ACCEPT branch that skips later checks. Crewroom treats a workflow rejection as a human-review hold, not an automatic permanent deletion. [Image workflow instructions](https://sightengine.com/docs/image-moderation-workflows), [video workflow instructions](https://sightengine.com/docs/video-moderation-workflows)

Calibrate with permitted, consented examples of cosplay across body types and skin tones, prop weapons, armor, revealing costumes and stage blood. A prop or costume alone is not a rule violation. Route ambiguous context to human review; do not configure a blanket cosplay-weapon ban. Include known harmless fixtures and authorized provider safety fixtures, and record expected versus actual outcomes.

Automatic video processing uses sampled visuals, the poster and an audio check. The synchronous workflow supports videos **strictly shorter than 60 seconds**; a 60-second clip, unknown duration, or unavailable video/audio setup needs human review. The prepared audio model covers English profanity and related offensive language; it neither proves which language was spoken nor comprehensively classifies all harmful speech. Do not advertise multilingual audio protection. Leave video automation disabled if that coverage is insufficient for the beta. [Video duration limit](https://sightengine.com/docs/video-moderation-workflows), [audio model scope](https://sightengine.com/docs/audio-profanity-model)

Enter values in Render’s server environment, never in `EXPO_PUBLIC_` variables, source control, screenshots or chat:

| Variable | Meaning |
| --- | --- |
| `MODERATION_OPERATOR_IDS` | Exact immutable IDs of approved operators |
| `MODERATION_MODE` | `manual` initially; `hybrid` only at activation |
| `MODERATION_PROVIDER_APPROVED` | `true` only after owner approval of cost, external processing and updated policies |
| `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` | Server-only credentials from the provider dashboard |
| `SIGHTENGINE_IMAGE_WORKFLOW` | Tested image workflow ID |
| `SIGHTENGINE_VIDEO_WORKFLOW` | Tested video workflow ID; leave empty for human video review |
| `SIGHTENGINE_WORKFLOWS_VERIFIED` | `true` only after actual workflow coverage and live fixture results are verified |
| `SIGHTENGINE_AUDIO_MODERATION_ENABLED` | `true` only with an audio-capable plan, tested audio checks and acceptance of their English-only limitation |

Configuration readiness is not proof that a vendor account, quota or workflow works. Production refuses hybrid startup without an operator, explicit provider approval, credentials and a verified image workflow. Never turn on a verification flag merely to get past startup validation. The public `/api/social/moderation-config` endpoint reports capabilities without exposing secrets; photo/text automation and video automation are separate capabilities.

## Use the moderation desk each day

Open **Review queue** for held submissions and **Reports** for published-content concerns. Prioritize urgent child-safety and threat reports. The displayed 24-hour response target is **Crewroom’s internal operating goal**, requiring an assigned person and backup coverage; it is not an Apple deadline, a guaranteed response time, or an automated escalation service.

Choose **Inspect submission** or **Review reported content**. Read every public field and credit, inspect all photos, and watch the complete video with sound. Review the creator’s profile when it is also pending. Record a useful reason and confirm the text/image/video review checkboxes before the appropriate action: approve, reject, take down or restore. Suspension and account restoration have their own reason and confirmation. Never approve unseen media merely to clear the queue.

Resolve or dismiss each report separately with investigation notes. Resolving a report does not approve or restore its target. Use **Retry automatic screening** only after a transient problem is corrected and the pending submission remains eligible. **History** records operator actions, reasons and times. Reload whenever the desk says content, reports or account status changed; decisions are tied to the exact inspected version.

Use the monitored support address for appeals. Inspect the context and document any reversal. Do not ask users to email illegal imagery. The operator must maintain a trained child-safety escalation contact and an appropriate reporting/preservation procedure before broader release.

## Acceptance and release

- Run the full existing suite plus `tests/hybrid-moderation.test.mjs`, moderation-admin tests and Sightengine adapter tests, then TypeScript and native/web exports. Injected providers and mocked HTTP responses validate our behavior; they do **not** establish production classifier accuracy, credentials, billing or workflow coverage.
- After explicit owner approval for live provider testing, run the agreed, consented fixtures against the actual workflows. Verify pass, hold, provider outage, multi-photo coverage, video/poster/audio coverage and the strict duration boundary. Preserve results without logging credentials or copying unrelated private content.
- Verify a private draft never reaches Sightengine. Unpublish or delete during a running check and confirm further provider work is cancelled; bytes already transmitted cannot be recalled. Verify an old pass cannot publish a later edit, suspended account or removed post.
- Verify report and block flows with two ordinary accounts; denied operator access with a tester; photo/video access after takedown; restoration after an appeal; and account deletion. Deletion purges related live screening jobs, screening events and moderation audit records, alongside the existing account cleanup. Backup copies follow the existing recovery-retention policy.
- Review the in-app privacy, terms, community and support pages. Confirm the enabled mode discloses Sightengine processing of chosen public content and any enabled audio processing. Check age-rating answers and App Store privacy disclosures against the final behavior.
- Take and verify a backup, deploy the tested backend/web update, configure the approved settings, and verify the public capability response and desk access. Exercise the live beta using dedicated test accounts before widening access.
- Build a **new iPhone candidate** containing the updated labels, statuses and report categories. Physically test publishing, held-content feedback, reports, blocks, video and sound. Submit updated TestFlight review notes explaining the moderation flow and provide Apple the ordinary review account, never operator access. The existing installed build does not include these UI changes.

Apple Guideline 1.2 requires filtering, reporting with timely responses, blocking and reachable contact information. It does not mandate manual preapproval of every post or prescribe a universal 24-hour deadline. This design supports those controls; code, a classifier and this checklist do not guarantee App Review approval. [Apple’s current UGC guideline](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)

## Recorded local validation

September 22: the full regression suite passed 141/141 tests before the final dashboard refinement; all 9 tests in the subsequent dashboard run passed, including the added check that old screening results are not attributed to edited content and that in-flight scans cannot be retried. TypeScript, the production web export and the iOS bundle export passed. Browser QA used an isolated local database, fictional example imagery and a mock screening provider: sign-in/access gating, queue inspection, image review/approval, report dismissal, history, and desktop/390px dark/light layouts were checked. This did not send media to Sightengine, alter production content or install a new iPhone binary.

## Operations and rollback

This beta runs one durable SQLite-backed screening worker, with one submission in flight per server process. It recovers interrupted jobs on restart and revalidates content and enforcement state under a write lock before publication. Do not scale to multiple API instances against this design. Growing traffic needs a shared database such as PostgreSQL, atomic job leases, dedicated workers, usage accounting, queue-age monitoring and staffed moderation coverage.

If the provider or workflows misbehave, set `MODERATION_MODE=manual` and restart the service. New public submissions remain held, and the desk remains usable. Previously approved posts stay public unless separately removed; rollback is not a blanket takedown. Investigate the failure, test corrected workflows, and deliberately retry held submissions before re-enabling automation.

**Owner decisions recorded:** Starter photo/text screening at $29/month, videos and audio held for human review, and the personal Jikjii account selected for operator access (resolved from the owner-provided email to an immutable production account ID). Subscription activation, access grant and final provider verification are tracked separately; selecting the plan does not establish that automatic screening is active.

## Production rollout evidence

- Render deployment `dep-dapjktrtqb8s73dcccmg` serves commit `5af210e` in manual mode; `/moderation` loads and denies its private workspace to signed-out visitors.
- Before deployment, offsite backup `run-1790130389805-5fd7402a-868e-4e73-a83c-988e8ee2ea6f` verified successfully: 12 media files, 6,696,132 encrypted bytes.
- Created the inactive-in-Crewroom Sightengine image workflow `wfl_lsEyOtDqOdR3u4rZB7xCv` (Crewroom public images v1). Its visual rules cover nudity, graphic injury, violence, self-harm and hate imagery. Flags mean Crewroom human review, never automatic permanent deletion. Costume skin exposure, swimwear, minor cuts/stage blood and prop objects are not blanket bans. Contextually serious matches remain held.
- Sightengine workflow browser test accepted the existing AI-generated `assets/demo/forest-maker.png`. This is one harmless fixture, not proof of safety-classifier accuracy or complete integration coverage.
- The workflow builder and browser playground expose legacy text rules. The adapter now calls the current `text-content-2.0` model separately with explicit categories/languages and validates all five visual model outputs. A live clean OCR response remains to be verified; unknown/absent language currently stays held rather than guessing.
- The subsequent combined regression run passed 55/55 tests for the adapter, live-fixture harness, hybrid worker and moderation desk. Production health returned 200; the public moderation capability response remained manual/false/false; signed-out queue access returned 401.

### Bounded live provider acceptance command

Once credentials and the image workflow are set on Render, keep `MODERATION_MODE=manual` and run:

```sh
node scripts/check-moderation-live.mjs --public-demo-fixtures
```

This opt-in check sends only the three hash-pinned fictional demo assets already shipped with Crewroom and synthetic text/OCR fixtures. It never reads user uploads or the production database and changes no production flags. It caps itself at ten HTTP requests, requires exact pass/hold outcomes, checks that Starter videos make no provider calls, and prints only fixed sanitized result codes. A provider error cannot masquerade as successful harmful-content detection. Model operations can exceed HTTP request count. All seven cases must pass before considering activation, followed by the broader acceptance checks above. This small fixture set does not establish classifier accuracy across cosplay, languages or all safety categories.

- Follow-up Render deployment `dep-dapjue7lk1mc73bsgcag` succeeded at `e813943`, adding explicit OCR 2.0 checks, five-model output validation and the opt-in live test command. Screening remains manual.
- Signed iPhone preview **0.4.0 (4)** succeeded: [installation page](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/3239cd1b-a202-4506-8453-23adb4b1099b). It contains native client revision `5af210e`; the subsequent changes are server-only/tests/docs. Camera, video, report/block and moderation-status physical acceptance remain pending.
- At handoff, the personal operator ID and manual mode were staged in Render but not saved, pending the browser-required permission grant confirmation. Credential transfer permission and Starter checkout also remained pending. No Sightengine secret has been copied to Render, and no production content has been sent for automatic screening.
