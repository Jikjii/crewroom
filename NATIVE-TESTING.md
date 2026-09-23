# Crewroom: installable phone beta

For the September 22 native video update, follow [VIDEO-BETA.md](VIDEO-BETA.md). Its camera, microphone, video upload/playback, moderation, and device checks supersede the photo-only scope below. The results below are historical and do not establish that the new video build has passed physical testing.

**Current candidate: 0.4.0 (4).** The [signed iPhone preview](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/3239cd1b-a202-4506-8453-23adb4b1099b) is ready for installation on the owner's registered iPhone. Open that page in iPhone Safari and choose **Install**. It includes the moderation status/wording/report updates at client revision `5af210e`. Its supporting backend is live at revision `e813943`, with screening still manual pending setup in [HYBRID-MODERATION.md](HYBRID-MODERATION.md). Physical video and moderation testing remain pending, and the existing TestFlight 0.3.0 (2) has not been replaced.

Updated September 18, 2026. Android preview 0.3.0 (build 3) and iPhone ad hoc preview 0.3.0 (build 1) are complete. The owner reported core iPhone installation, login, photo, dark-mode, persistence and cellular checks passed; Android physical testing is deferred. App Store distribution iPhone 0.3.0 (build 2) is uploaded and processed. At 12:26 PM EDT, Apple showed **Waiting for Review** in **Crewroom Private Beta**. Three external testers are added with automatic notification configured; they still show **No Builds Available** pending Apple approval. This is a private TestFlight release, not a public App Store launch.

## What is ready

- Crewroom 0.3.0 uses installed Expo SDK 57.0.24 and React Native 0.86.3.
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
| App identifier | `com.joincrewroom.app` is configured for both platforms, based on the owned `joincrewroom.com` domain. Registered with Apple team `A48T68DM6A`; App Store Connect app ID `6813563844`. |
| Apple Developer Program | Active; renews September 18, 2027. |
| Physical iPhone registration | One iPhone registered and preview build 1 tested. TestFlight does not use the ad hoc device list. |
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

## 2. Install or rebuild Android

Use the completed [preview build 3](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/faaadd41-0526-4b87-ab4c-e04962cab939). Expo manages the Android signing key. Build 2 is superseded because its validation reported the missing direct `expo-font` dependency; build 3 includes the fix and passes all 21 Expo checks. The Expo dashboard showed the Free plan with 15 Android builds included before these two builds.

To create a later preview:

```sh
npx eas-cli@latest build --platform android --profile preview
```

Let EAS create/manage an Android signing keystore if this is the first app under the confirmed identifier. If an existing app already uses it, reuse its signing credentials. Retain access to those credentials for future updates.

After the build succeeds, open its EAS installation link on the Android phone and install the APK. Android may require allowing installation from that browser. Record the build number and device/OS. A downloaded AAB is not a directly installable preview APK.

## 3. Register the iPhone, then build

Apple Developer enrollment is active. For another ad hoc preview, register any additional devices first:

```sh
npx eas-cli@latest device:create
```

Open the registration link on each intended test iPhone and complete registration. Include each intended ad hoc test phone before building. TestFlight testers do not need ad hoc device registration. Then:

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
4. Run a two-account collaboration: submit public profiles/work, have the operator inspect and approve them, submit a comment for approval, request/accept collaboration, and verify the resulting private crew is visible only to its members. Check pending/rejected states and that edits queue approved profiles/work again.
5. Reset a disposable account's password using email, then sign in with the new password. Test report/block and account deletion following the fuller device checklist in `RELEASE.md`.
6. Lose connectivity and restore it; background/reopen; check larger text and Android Back.

`npm run build:native` checks JavaScript/assets only; it does not create an APK/IPA, sign an app, or validate a physical phone. The production iPhone build is now awaiting TestFlight review. Its physical acceptance remains separate from the completed ad hoc checks; Android/Play testing and any public store release are separate work.

## Build record

| Platform | EAS build URL | Version/build | Device/OS | Installed | Acceptance |
|---|---|---|---|---|---|
| Android | [Build 3](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/faaadd41-0526-4b87-ab4c-e04962cab939) | 0.3.0 (3) | Pending | Pending | Pending |
| iPhone ad hoc | [Build 1](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/8ff22f27-f04c-4081-8c17-b275634bcabe) | 0.3.0 (1) | Not recorded | Yes, user-reported | Core checks passed, user-reported |
| iPhone App Store distribution | [Build 2](https://expo.dev/accounts/geraldogs-team/projects/crewroom/builds/7f3b3057-cb92-4bb5-8bc0-df46d1e1259d) | 0.3.0 (2) | Pending TestFlight | Pending | Apple processing complete; Waiting for Review |

## Private TestFlight build 2

Apple listing: **Crewroom: Cosplay & Crews** (the plain Crewroom name was unavailable); the installed name remains Crewroom. Build 2 uses the SDK 57 patch updates and owner-visible submission review states. Local Expo Doctor passed 21/21. The IPA targets iOS 16.4+, contains the live HTTPS origin and icon font, has an App Store profile with no device allowlist and no debug entitlement, and passed ZIP CRC checks. Its provisioning CMS signature was verified without independently evaluating Apple certificate-chain trust.

Submission [c6757624](https://expo.dev/accounts/geraldogs-team/projects/crewroom/submissions/c6757624-2168-41b4-8975-bf591bf7e654) succeeded September 18 at **12:18 PM EDT**. Apple processing is **Complete**, with Apple build UUID `5c0a8ae8-0770-4970-8888-7ee153c3ee95`. At **12:26 PM EDT**, build 0.3.0 (2) showed **Waiting for Review** in external group **Crewroom Private Beta**, UUID `858d3c31-fabf-41d3-8b80-50eff303d459`.

The group has **3 authorized external testers and 1 build**. Automatic notification is configured; no public invitation link is enabled. Testers currently show **No Builds Available**. Do not describe invitations as delivered, Apple review as approved, or TestFlight installation as available until those states are verified. The dedicated reviewer login, private contact details, beta metadata and What to Test are saved in App Store Connect.

`eas.json` records the real App Store Connect ID. For a future submission only, supply the app identifier because build-profile environment values are not automatically supplied to the submit command:

```sh
CREWROOM_APP_ID=com.joincrewroom.app EXPO_PUBLIC_API_URL=https://joincrewroom.com EXPO_PUBLIC_WEB_URL=https://joincrewroom.com npx eas-cli@latest submit --platform ios --profile production --id NEW_BUILD_ID
```

Do not rerun the successful submission or build again for the same release. Expo holds an App Manager API key for EAS Submit; no credential was added to the repository. Geraldo Grell confirmed daily moderation; follow [MODERATION.md](MODERATION.md) and finish the routine private image-review transfer setup. Upload completion and TestFlight review submission do not establish Apple approval or physical-device acceptance of build 2.
