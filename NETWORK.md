# Creative network pilot

The complete loop is: discover work → visit its maker → follow, save, or discuss → send a specific collaboration request → accept into a new private crew → plan the shoot together.

## Try it with two people

1. Browse Discover without signing in. Open a work and its creator profile. The initial AI-illustrated examples demonstrate the format; they are not real community members. You can bookmark examples after signing in, but cannot follow, comment on, or request a collaboration with them.
2. Create an account. Open Create, pick a photo, give the work a title, and save a private draft. It should appear in your own profile. Refresh to confirm it is saved.
3. Edit the draft, choose public publishing, and explicitly make your creator profile public if needed. Your private crews stay private. Add an optional open role such as photographer, with a broad area instead of a precise meeting point.
4. Have a friend create their own account and public creator profile on the same running server. They can discover your work, follow you, save it privately, and leave a comment. They can send a request describing a proposed shoot and their contribution.
5. Open Inbox and accept the request. Open the resulting private plan. Both people should see the new crew; neither gets access to the other's existing crews. Set the lineup, add preparation tasks, and plan the shoot day.

Use actual work you have permission to share. Collaborator credits are uploader-provided attribution, not verified endorsements. For a quick solo UI walkthrough, use an isolated demo; demo work is never visible to other accounts, and cannot interact with real creators.

## Visibility and contact

- Creator profiles start private. A public profile exposes only its explicitly editable creator fields, not account email or private crew details.
- Posts start as private drafts. Public publishing requires photos and a public profile. Making a profile private hides its public posts and images from other viewers; making it public again restores the visibility of posts still marked public.
- Following, commenting, and requesting collaboration require a public creator identity. Bookmarks stay private.
- Block removes follow relationships, cancels pending requests, and filters discovery/contact in both directions for signed-in users. It does not revoke membership of an existing private crew; use crew member controls for that. Public posts remain public to signed-out visitors.
- Reporting a post hides it from the reporter immediately. Reports persist for manual operator review; the app does not promise automatic takedowns or response times.
- Notifications persist in the inbox. They are not push notifications or email.
- Profile export returns JSON describing your profile and work, with media URLs. It is not an offline image archive.

## Photos and storage

The client prepares selected photos for upload. The API verifies JPEG, PNG, or WebP data, accepts up to 5 MB of decoded upload data and 25 million pixels, strips metadata, limits the output to 1600 pixels per side, and stores a JPEG. Each post supports up to four images and accessible descriptions. Image access follows post/profile visibility and signed-in block rules; private media is served without browser caching. Images cannot be attached to someone else's post without ownership.

Back up the full data directory with the API stopped. Set `DB_PATH` and optionally `MEDIA_DIR` to override storage locations; when `MEDIA_DIR` is separate, back up that directory too. Fictional gallery originals and generation prompts are documented in [ASSETS.md](ASSETS.md).

## Manual moderation

Run these from the project directory with Node 24+. The tools act only on your local database and are not exposed as public API endpoints.

```sh
npm run moderate -- list
npm run moderate -- review REPORT_ID
npm run moderate -- hide-post POST_ID
npm run moderate -- suspend-profile USER_ID_OR_HANDLE
npm run moderate -- review REPORT_ID reviewed
```

`restore-post`, `restore-profile`, and `review REPORT_ID dismissed` are also available. Add `--db /absolute/path/to/crewroom.sqlite` to target another database. Hiding content does not delete private crew records. Reviewing a report records its status separately from any moderation action.

## Scope of this build

This is a local creative-network pilot, not a launched community or a production service. The intended first test is a few real creators sharing work and completing one collaboration. Public deployment, recovery emails, production operations, push delivery, direct messages, payments, and native store distribution are later work. Actual iPhone and Android device tests remain necessary; successful platform bundles are not device verification.
