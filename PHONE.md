# Try Crewroom on your phone

The local pilot is running on this computer. Keep the computer awake and connect your phone to the **same Wi-Fi**.

1. Install **Expo Go** from your phone’s app store. This project uses Expo SDK 57.
2. Open the [Crewroom QR code](../crewroom-expo-qr.png) on this computer. Scan it with your iPhone camera or Expo Go’s Android scanner.
3. Browse the creative gallery, create an account, and add your first cosplay photo. Use **My crews** to return to planning. The [creative-network walkthrough](NETWORK.md) covers the full loop with a friend.

The QR code opens `exp://192.168.1.170:8081`. A browser companion is available at [Open Crewroom](http://192.168.1.170:8081).

The current IP can change when the computer changes networks. The QR code only works while this development server is running; it is not a public download or an App Store release. If a firewall or isolated guest network blocks the connection, use the network troubleshooting notes in [README.md](README.md).

## Restart on this computer

Open a terminal in the project and run:

```sh
cd /Users/jikjii/Documents/Codex/2026-09-17/i-x20/outputs/crewroom
CREWROOM_NO_WATCH=1 /Users/jikjii/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/dev.mjs --phone
```

With a regular Node 24+ installation, use `npm run dev:phone`. `CREWROOM_NO_WATCH=1` is a fallback for the file-watcher limit encountered in this workspace; restart after source edits when using it.

## The first useful test

Start with one of your sister’s real creations: save it as a draft, publish when ready, and have a friend discover and request a collaboration. Accept the request, open the private plan, and prepare the shoot together. The [network guide](NETWORK.md) covers this flow; the [planning pilot guide](PILOT.md) covers the existing crew tools.

Browser flows, API tests, and iOS/Android bundle generation have been checked. **Actual iPhone and Android use is still unverified.** The first phone session should check keyboard behavior, saving, and an invitation before relying on the app for a real event. Push notifications and offline editing are not included yet.
