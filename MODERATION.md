# Manual content review for the private beta

Crewroom's current source includes human review before real public profiles, posts, and comments become visible to others. This runbook describes that implementation; it does not establish that it is deployed, that a moderator is assigned, or that Apple has approved the beta. Confirm the deployed revision and complete the acceptance checks below before relying on the gate.

The operator must assign someone to inspect submissions and reports regularly, handle urgent concerns promptly, and monitor **support@joincrewroom.com** for appeals. Geraldo Grell confirmed on September 18, 2026 that he will review pending public submissions and user reports daily during the small beta. Do not advertise a response deadline or round-the-clock coverage until the operation supports it. Apply the published [community standards](https://joincrewroom.com/community), including to costume imagery.

## What changes for creators

- New real public profiles, posts, and comments start **pending**. The author can see their own submission and its status; others cannot see it until approved.
- Editing a profile or post queues it again and removes its prior public visibility until the new version is approved. An unapproved profile also hides its work from other viewers. A post needs both its own approval and an approved public author profile.
- A rejected submission remains hidden. Its reason is shown to the author, who can revise a profile/post and submit again. Comments cannot be edited; the author can remove a rejected comment and submit a revised one.
- Private profiles/drafts and private crew plans remain private. Saving a private draft does not require operator approval and does not add it to the public-submission queue.
- On the first server startup with this schema, existing real public profiles, posts, and comments become pending. Review these before expecting the existing public gallery to return. The migration preserves their data and does not recreate accounts or media.
- Fictional example profiles/posts remain approved. Isolated demo accounts are excluded from the operator's public-submission queue; they cannot publish to the real network.

Report/block controls still work independently. Approval is not a guarantee of permanent visibility: creator privacy choices, deletion, personal blocking, operator post hiding, or profile suspension can restrict access.

## Use the correct database

Run the commands from the deployed app directory on the instance with access to its persistent disk. On Crewroom's Render instance this is `/app`, with database `/var/data/crewroom.sqlite` and images `/var/data/media`. For local QA, substitute a separate disposable database and media directory. Never run test decisions against the production database.

Every example below specifies `--db`. The tool defaults to the project's local `.data` directory without a configured path. `MEDIA_DIR` can override the image folder; its default is a `media` folder alongside the selected database. Start the updated API once to apply the additive review schema before invoking the new commands.

The CLI is an operator tool, not a public admin endpoint. Keep database, media, review output, and image-review copies private. Output includes unpublished content; do not paste it into public issues or expose it through the website.

## Inspect and decide a submission

List pending real public submissions:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite queue
```

The queue provides each submission's type and ID. Approve a creator profile before expecting that creator's approved work to become public. Inspect a single item, substituting the exact ID:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite inspect profile PROFILE_USER_ID
node server/moderate.mjs --db /var/data/crewroom.sqlite inspect post POST_ID
node server/moderate.mjs --db /var/data/crewroom.sqlite inspect comment COMMENT_ID
```

For a remote server, export a private self-contained HTML packet, then download it through an authenticated operator connection and open it locally:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite inspect post POST_ID --html /tmp/crewroom-review.html
```

The packet embeds images, escapes submitted text and disables scripts and external requests. It is created with owner-only file permissions and will not overwrite an existing file. Keep it outside web/media folders and delete the private copy after review. This command does not configure SSH access or make the packet publicly downloadable. An operator needs an established private transfer route before remotely reviewing image submissions.

Read every public field. For a post, inspect every listed image as well as the caption, credits, alt text, and any collaboration opportunity. The output contains an exact **`version` fingerprint**, image paths, and image SHA-256 hashes. The fingerprint covers the inspected content and image bytes. File validation/resizing is not an objectionable-content check; a person must actually examine the images.

Approve only the version you inspected. Replace `VERSION_FROM_INSPECT` with its complete 64-character fingerprint:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite approve profile PROFILE_USER_ID --version VERSION_FROM_INSPECT
node server/moderate.mjs --db /var/data/crewroom.sqlite approve post POST_ID --version VERSION_FROM_INSPECT --images-reviewed
node server/moderate.mjs --db /var/data/crewroom.sqlite approve comment COMMENT_ID --version VERSION_FROM_INSPECT
```

`--images-reviewed` is a human assertion that every image was opened and checked; the command requires it when approving a post with images. It is not a request for an automated scan. If content or media changed after inspection, the command refuses the stale fingerprint. Inspect the new version and its images before trying again. Only pending submissions can be decided; rerunning an approval does not silently approve a later edit.

To reject a pending submission, give a concrete explanation and a change the creator can make. Reasons are required, limited to 1,000 characters, and shown to the author:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite reject post POST_ID --version VERSION_FROM_INSPECT --reason 'Remove the visible private address before submitting this photo again.'
```

Use the matching `profile` or `comment` type for those submissions. The tool records the target, fingerprint, decision, reason, image-review assertion, and time in `social_content_reviews`. A decision changes subsequent API reads; it does not send an email or push notification. After deciding, verify the intended public view using another account or a signed-out browser and check that private drafts remain inaccessible.

## Handle reports separately

Publication approval does not close a report. Review the reported content, investigate its context, take any necessary visibility action, and then record the report outcome:

```sh
node server/moderate.mjs --db /var/data/crewroom.sqlite list
node server/moderate.mjs --db /var/data/crewroom.sqlite review REPORT_ID
node server/moderate.mjs --db /var/data/crewroom.sqlite hide-post POST_ID
node server/moderate.mjs --db /var/data/crewroom.sqlite suspend-profile USER_ID_OR_HANDLE
node server/moderate.mjs --db /var/data/crewroom.sqlite review REPORT_ID reviewed
```

Use `review REPORT_ID dismissed` when the concern is not substantiated. Use `list all` to include previously handled reports. Marking a report reviewed/dismissed changes only its status; it does not remove content. Post hiding and profile suspension do not delete private crews. There is currently no dedicated operator hide-comment command; for a harmful approved comment, investigate and restrict its parent post or author profile as appropriate rather than claiming the report status removed it.

`restore-post POST_ID` and `restore-profile USER_ID_OR_HANDLE` remove those separate operator restrictions after an appeal. They do not bypass the content's current review status. Reinspect the current content before deciding to restore visibility. Use the support address for appeals and urgent escalation under the published policy; do not redistribute illegal imagery in a report or email.

## Deployment and acceptance

1. Verify a recent complete database/photo backup, deploy the updated server, and confirm the schema migration completes without losing private drafts, accounts, or crew records.
2. Inspect the migration queue. Review each existing real public profile/post/comment; do not bulk-approve content to make the gallery look populated.
3. With separate test accounts, submit a public profile, post with photos, and comment. Confirm another user and a signed-out visitor cannot retrieve pending/rejected text or photos through discovery, profile, post, or media routes.
4. Inspect and approve each submission. Confirm approved content becomes visible only when its parent post/profile is also eligible. Check that the approved comment's notification appears without exposing a pending comment beforehand.
5. Edit approved public profile/post content and confirm it is hidden again until reapproved. Try approving with the old fingerprint and confirm rejection. Check the author sees a useful rejection reason.
6. Check report/block behavior and moderator restrictions after approval. Verify reporting alone does not falsely appear to remove the content for everyone.

Record the deployed revision, test date/result, reviewer, and operating schedule in the release record. Local passing tests, a successful native build, and an operator runbook each cover only part of this process; none proves the live queue is staffed.
