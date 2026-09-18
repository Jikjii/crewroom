# Crewroom 0.3: from laptop preview to a phone beta

The app now has saved **System / Light / Dark** appearance, a deployable web/API service, account deletion, optional password-reset email, public policy/support routes, and signed-build profiles. Hosting and store accounts still need to be connected. No paid service, public release, IPA or AAB has been created.

## First, make the server independent of your computer

Follow [DEPLOY.md](DEPLOY.md). The initial deployment uses one HTTPS address for the web app, API, shared links and uploaded photos, with a persistent database/media disk. A Render Docker blueprint is included as a starting point; another Docker host can use the same package.

The selected beta settings are Render hosting, `https://joincrewroom.com`, operator **Geraldo Grell**, **support@joincrewroom.com**, and **18+**. Support forwarding has been confirmed; the hosting account, source repository, deployment and domain connection remain to be completed. Review `/privacy`, `/terms`, `/community`, `/support` and `/delete-account` with those details and establish the described backup and moderation operating practices before approving the policies. Password resets require a verified email sender; without one the interface clearly says recovery is unavailable.

For existing pilot data, stop writes, make a complete database-and-photo backup, transfer it privately, and restore it to the host’s empty data directory **before** starting the service. Do not overwrite a running or already-used hosted database. Inspect the restored data before letting people sign in. The local `.data` database has not been uploaded anywhere.

Acceptance is concrete: on your phone turn **Wi-Fi off**, use the hosted HTTPS website over cellular, then shut down this computer and repeat. Sign in, upload a photo, and load a private crew. Restart/redeploy the hosted service and confirm those records remain. This distinguishes a hosted service from an Expo tunnel.

## Then, build an installable app

Use [Expo EAS Build](https://docs.expo.dev/build/setup/) with your own Expo account. Apple’s developer program is needed for normal signed iPhone distribution. Developer account enrollment, identity checks and paid plan decisions are yours to complete.

1. Run `npx eas-cli@latest login`, then `npx eas-cli@latest init` from this app directory. If the CLI cannot edit the dynamic app config, copy the project UUID it gives you into `EAS_PROJECT_ID` instead. Do not substitute a made-up UUID.
2. Choose a final `CREWROOM_APP_ID` in reverse-domain form under your own naming namespace. The same identifier configures iOS and Android; it must be unique in the relevant stores. The build deliberately refuses a missing or sample identifier.
3. Set these **four public configuration values** locally for EAS config evaluation and in the Expo dashboard’s `preview` and `production` environments. They are not credentials:

   | Variable | Value |
   |---|---|
   | `CREWROOM_APP_ID` | Your final app identifier |
   | `EAS_PROJECT_ID` | Your linked Expo project UUID |
   | `EXPO_PUBLIC_API_URL` | Actual hosted HTTPS origin, with no `/api` suffix |
   | `EXPO_PUBLIC_WEB_URL` | The hosted website’s HTTPS origin |

   EAS reads each profile’s named environment. Keep mail keys and database configuration on the **server only**. See [Expo’s environment-variable guidance](https://docs.expo.dev/eas/environment-variables/usage/).
4. Register the physical iPhone with `npx eas-cli@latest device:create` for internal distribution, following the Apple/Expo credential prompts. Android preview installs use the APK link EAS returns.
5. Build the preview packages:

   ```sh
   npx eas-cli@latest build --platform all --profile preview
   ```

   The `preview` profile bundles the JavaScript inside an installable app and targets the hosted service. It does not require Metro or this laptop to remain running. Its iOS build is for registered devices; Android produces an APK. This build command has not yet been run against your account.

`npm run build:native` is only a JavaScript/assets export check. It does **not** create a signed installable app. Likewise, a successful browser check does not verify native secure storage, a native photo picker, or iOS/Android installation.

## Device acceptance before store submission

Use two disposable beta accounts and at least one physical iPhone and Android phone. Record device model, OS version, build number, date and result.

- Sign up, sign out/in, close the app completely, reopen it, and confirm the right account and private plans load.
- Select Light, Dark and System from the header’s Appearance button. Reopen the app and confirm persistence. With System selected, change the phone’s OS appearance. Check dialogs, text inputs, keyboard, photo picker, status bar and safe areas.
- Choose/cancel photos; test large images and iPhone HEIC photos, denied permission, rotated images, failed uploads and retry. Check uploaded images from the other device.
- Publish → discover → comment → collaboration request → accept → new private crew → assign/complete a task. Verify unrelated private crews are inaccessible.
- Use report/block and inspect the operator’s report queue. Establish who reviews it and how urgent child-safety issues and appeals are escalated.
- Request a password reset using a test mailbox after email is configured. Verify successful delivery, reuse/expiry rejection, and sign-out on both devices after reset.
- Review account deletion with a shared crew and a solo crew. Delete only the disposable account, verify ownership transfer, preserved collaborators’ plans, removed account/photos, and signed-out devices. Also test the signed-out website’s `/delete-account` route.
- Repeat over cellular with the computer off; interrupt connectivity, background/reopen, use large text and the Android back button. The beta needs an internet connection; offline editing is not implemented.

This release currently targets phones (`supportsTablet: false`). Test and design for iPad deliberately before adding tablet support.

## Store release comes after that

```sh
npx eas-cli@latest build --platform all --profile production
```

This produces the store-distribution builds; upload them to TestFlight and Google Play’s testing track before a public release. Configure your app records, screenshots, descriptions, reviewer access, privacy/data-safety disclosures, account-deletion URL, content rating and support details. Follow [Expo’s submission guide](https://docs.expo.dev/deploy/submit-to-app-stores/).

The existing reporting/blocking tools and draft community standards are a foundation. Before a broad public creative network launch, finish objectionable-content filtering and staff the moderation/child-safety process. Store approval has not been established by these code changes. Check the current [Apple user-generated-content rules](https://developer.apple.com/app-store/review/guidelines/#user-generated-content), [Apple account deletion requirements](https://developer.apple.com/support/offering-account-deletion-in-your-app), and [Google’s deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en). Google also has [child-safety standards for social apps](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en).
