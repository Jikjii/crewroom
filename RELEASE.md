# Crewroom 0.3: from laptop preview to a phone beta

The hosted beta is live at **https://joincrewroom.com** with saved **System / Light / Dark** appearance, account deletion, working password-reset email, and public policy/support routes. Expo is linked and native build profiles target the hosted service. Signed native builds, physical-device acceptance, and store submission are separate steps below.

## Hosted server status

The Render deployment uses one HTTPS address for the web app, API, shared links and uploaded photos, with a persistent database/media disk. See [DEPLOY.md](DEPLOY.md) for its configuration and [BACKUPS.md](BACKUPS.md) for offsite backup operations and the restore drill.

The beta settings are Render hosting, `https://joincrewroom.com`, operator **Geraldo Grell**, **support@joincrewroom.com**, and **18+**. The private source repository, hosting, domain, support forwarding, approved policies, and Resend sender are connected. The owner confirmed email recovery and signing in with the new password. Continue the backup and moderation operating practices described in the published policies.

For existing pilot data, stop writes, make a complete database-and-photo backup, transfer it privately, and restore it to the host’s empty data directory **before** starting the service. Do not overwrite a running or already-used hosted database. Inspect the restored data before letting people sign in. The local `.data` database has not been uploaded anywhere.

The owner confirmed the gallery over cellular and a private photo with the Mac asleep; the hosted account, private draft, and photo also survived a Render restart. Those are hosted-web checks. The installed apps still require the device acceptance below.

## Then, build an installable app

Use the already-linked [Crewroom Expo project](https://expo.dev/accounts/geraldogs-team/projects/crewroom). CLI account `geraldog` is authenticated; the project belongs to `geraldogs-team`. See [NATIVE-TESTING.md](NATIVE-TESTING.md) for installation details and the build record.

These public values are already configured; do not create another project or rerun `init`:

| Setting | Value / location |
|---|---|
| Expo owner | `geraldogs-team` in `app.json` |
| Project UUID | `7e2b8c93-ce85-47b1-b0a5-ccf81c3d8d06` in `app.json` → `expo.extra.eas.projectId` |
| `CREWROOM_APP_ID` | `com.joincrewroom.app` in both `eas.json` profiles |
| `EXPO_PUBLIC_API_URL` | `https://joincrewroom.com` in both profiles |
| `EXPO_PUBLIC_WEB_URL` | `https://joincrewroom.com` in both profiles |

The app identifier follows the owned domain and should stay stable for future signed updates. Store registration availability has not yet been established. `.easignore` excludes local data, environment files, credentials, backups, work files, and server-only source from native source uploads. Keep mail and backup keys on the **server only**. See [Expo’s environment-variable guidance](https://docs.expo.dev/eas/environment-variables/usage/).

Start with Android; it can be installed directly as an APK without a Google Play developer account:

```sh
npx eas-cli@latest build --platform android --profile preview
```

Use the successful build's EAS installation link on the Android phone. Retain the managed Android signing credentials for updates.

The owner does not yet have active [Apple Developer Program membership](https://developer.apple.com/programs/enroll/). Complete enrollment before creating an ad hoc iPhone build. Once it is active, register all intended test iPhones before building:

```sh
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile preview
```

The account owner completes Apple authentication and two-factor prompts. Select the intended Apple team and registered devices. The iPhone install link works only for devices included in its provisioning profile. Both `preview` builds bundle the JavaScript and target the live service; neither requires Metro or the Mac to remain on. An internet connection is required. See [Expo's internal distribution guide](https://docs.expo.dev/build/internal-distribution/).

`npm run build:native` is only a JavaScript/assets export check. It does **not** create a signed installable app. Likewise, a successful browser check does not verify native secure storage, a native photo picker, or iOS/Android installation.

## Device acceptance before store submission

Use two disposable beta accounts and at least one physical iPhone and Android phone. Record device model, OS version, build number, date and result.

- Sign up, sign out/in, close the app completely, reopen it, and confirm the right account and private plans load.
- Select Light, Dark and System from the header’s Appearance button. Reopen the app and confirm persistence. With System selected, change the phone’s OS appearance. Check dialogs, text inputs, keyboard, photo picker, status bar and safe areas.
- Choose/cancel photos; test large images and iPhone HEIC photos, denied permission, rotated images, failed uploads and retry. Check uploaded images from the other device.
- Publish → discover → comment → collaboration request → accept → new private crew → assign/complete a task. Verify unrelated private crews are inaccessible.
- Use report/block and inspect the operator’s report queue. Establish who reviews it and how urgent child-safety issues and appeals are escalated.
- Request a password reset using a test mailbox. Verify successful delivery, reuse/expiry rejection, and sign-out on both devices after reset.
- Review account deletion with a shared crew and a solo crew. Delete only the disposable account, verify ownership transfer, preserved collaborators’ plans, removed account/photos, and signed-out devices. Also test the signed-out website’s `/delete-account` route.
- Repeat over cellular with the computer off; interrupt connectivity, background/reopen, use large text and the Android back button. The beta needs an internet connection; offline editing is not implemented.

This release currently targets phones (`supportsTablet: false`). Test and design for iPad deliberately before adding tablet support.

## Store release comes after that

```sh
npx eas-cli@latest build --platform all --profile production
```

This produces the store-distribution builds; upload them to TestFlight and Google Play’s testing track before a public release. Configure your app records, screenshots, descriptions, reviewer access, privacy/data-safety disclosures, account-deletion URL, content rating and support details. Follow [Expo’s submission guide](https://docs.expo.dev/deploy/submit-to-app-stores/).

The existing reporting/blocking tools and approved community standards are a foundation. Before a broad public creative network launch, finish objectionable-content filtering and staff the moderation/child-safety process. Store approval has not been established by these code changes. Check the current [Apple user-generated-content rules](https://developer.apple.com/app-store/review/guidelines/#user-generated-content), [Apple account deletion requirements](https://developer.apple.com/support/offering-account-deletion-in-your-app), and [Google’s deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). Google also has [child-safety standards for social apps](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en).
