# Crewroom: installable phone beta

Prepared September 18, 2026. No signed iPhone or Android build has been created yet. This guide updates the native-build steps in `RELEASE.md`; the live website and password recovery already work.

## What is ready

- Crewroom 0.3.0 uses installed Expo SDK 57.0.23 and React Native 0.86.3.
- `preview` builds bundle the app and use `https://joincrewroom.com` for API requests, photos, and shared links. The computer and Metro do not need to remain on. An internet connection is still required.
- Android preview produces an installable APK. iPhone preview uses an ad hoc build for registered devices. These are Expo's [internal distribution](https://docs.expo.dev/build/internal-distribution/) options.
- Preview and production build numbers increment through EAS. The production profile produces the later store builds.
- System, Light, and Dark modes and native photo-library selection are configured. Camera and microphone permissions are not requested.
- Signed-build validation refuses missing app/project identifiers or local/insecure service addresses. No server email or backup credentials belong in the mobile build.

## Account and build status

| Item | Status / decision |
|---|---|
| Expo account | CLI authenticated as `geraldog`; project owner is `geraldogs-team`. |
| Expo project | Linked to `@geraldogs-team/crewroom`, UUID `7e2b8c93-ce85-47b1-b0a5-ccf81c3d8d06`. |
| App identifier | `com.joincrewroom.app` is configured for both platforms, based on the owned `joincrewroom.com` domain. Store registration has not been tested. |
| Apple Developer Program | The owner does not yet have active paid membership. It is required for this iPhone ad hoc distribution route. Apple's listed fee is US$99 per year or local equivalent. |
| Physical iPhone registration | Register before creating its first build. |
| Android test phone | No Google Play developer account is needed to install the preview APK directly. |

Apple enrollment is completed by the account owner through the [Apple Developer Program](https://developer.apple.com/programs/enroll/). Expo build availability depends on the account's current [plan and quota](https://expo.dev/pricing); do not upgrade a plan just to complete configuration.

## 1. Confirm the existing Expo connection

Use a Terminal with Node 24 or later. From the project directory:

```sh
cd "/Users/jikjii/Documents/Codex/2026-09-17/i-x20/outputs/crewroom"
npx eas-cli@latest whoami
npx eas-cli@latest project:info
```

The expected project is [Crewroom in geraldogs-team](https://expo.dev/accounts/geraldogs-team/projects/crewroom). Its real UUID is stored in `expo.extra.eas.projectId` and its owner in `expo.owner` in `app.json`; `app.config.js` preserves both. The account is already authenticated. If a later session is signed out, use `npx eas-cli@latest login` with the same account. Do not run `init` again or create a duplicate project. See [Expo's setup guide](https://docs.expo.dev/build/setup/).

`CREWROOM_APP_ID=com.joincrewroom.app` is already set in both profiles' `env` objects in `eas.json`. It configures both `ios.bundleIdentifier` and `android.package`. This is the first Crewroom native identity and follows the namespace of the owned domain; no existing app identity was replaced. Keep it stable for updates after the first signed build. A later bundle/package change creates a different app identity and requires its own registration and installation path.

The two public HTTPS origins are already supplied in `eas.json`. `EAS_PROJECT_ID` is optional if the UUID is saved in `app.json`. If using EAS dashboard environment variables instead, identity values must use **Plain text** or **Sensitive** visibility so EAS can resolve the configuration locally. Check that dashboard values do not point to a different app/server. See [Expo environment configuration](https://docs.expo.dev/eas/environment-variables/usage/).

`.easignore` preserves the local data, backup, work, dependency, and build-output exclusions from `.gitignore`, and also excludes local environment files, signing keys, credentials, and server-only source. Public app configuration, mobile source, assets, and package manifests remain available to EAS. When adding a `.gitignore` rule later, mirror it here if it also belongs outside the native source upload. See [Expo's archive-ignore guidance](https://docs.expo.dev/build-reference/easignore/).

Local validation on September 18 resolved the preview configuration to the owner, UUID, platform identifiers, and HTTPS origins above. A source-copy check using the installed EAS CLI's archive implementation included the required mobile files and excluded local data, environment files, signing credentials, backups, and work files. It did not upload source or start a build.

## 2. Make the Android build

```sh
npx eas-cli@latest build --platform android --profile preview
```

Let EAS create/manage an Android signing keystore if this is the first app under the confirmed identifier. If an existing app already uses it, reuse its signing credentials. Retain access to those credentials for future updates.

After the build succeeds, open its EAS installation link on the Android phone and install the APK. Android may require allowing installation from that browser. Record the build number and device/OS. A downloaded AAB is not a directly installable preview APK.

## 3. Register the iPhone, then build

Once Apple Developer enrollment is active:

```sh
npx eas-cli@latest device:create
```

Open the registration link on each intended test iPhone and complete registration. Include the owner's and sister's phones before building. Then:

```sh
npx eas-cli@latest build --platform ios --profile preview
```

The account owner completes Apple sign-in and two-factor authentication. Select the intended Apple team, let EAS configure the distribution certificate and ad hoc profile, and include the registered devices. Apple may delay processing newly registered devices on a new or renewed membership. Build completion and an install link are the evidence of a signed build; registering with Expo alone does not complete Apple's provisioning.

Open the successful build's installation link on a registered iPhone. A device added later requires a new build or `eas build:resign` with an updated provisioning profile. See [Expo's internal-build walkthrough](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/).

## 4. Accept each installed build

Both preview builds use the live beta's accounts and data. Use disposable accounts for deletion testing. On each platform, record pass/fail for:

1. Launch over cellular with the Mac asleep; sign in and reopen the app after fully closing it.
2. Save a private photo draft using the native picker; cancel picking; check a large/rotated image and an iPhone HEIC image where available. Reopen the draft from the other device.
3. Switch Light / Dark / System and reopen the app. With System selected, change the phone's appearance; check keyboard, dialogs, status bar, and screen edges.
4. Run a two-account collaboration: publish a test post, request/accept collaboration, and verify the resulting private crew is visible only to its members.
5. Reset a disposable account's password using email, then sign in with the new password. Test report/block and account deletion following the fuller device checklist in `RELEASE.md`.
6. Lose connectivity and restore it; background/reopen; check larger text and Android Back.

`npm run build:native` checks JavaScript/assets only; it does not create an APK/IPA, sign an app, or validate a physical phone. Production/TestFlight/Play testing and public store submission remain separate later steps.

## Build record

| Platform | EAS build URL | Version/build | Device/OS | Installed | Acceptance |
|---|---|---|---|---|---|
| Android | Pending | Pending | Pending | Pending | Pending |
| iPhone | Pending | Pending | Pending | Pending | Pending |
