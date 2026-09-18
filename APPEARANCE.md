# Appearance

Use the sun or moon button at the top of Crewroom to choose **System**, **Light**, or **Dark**. The same control is available in **My crews → You** and **Profile → Settings & export**. It is available without an account.

- **System** follows the device or browser’s appearance and responds when it changes.
- **Light** and **Dark** keep that appearance until you choose another option.
- The choice is saved on this device, including after signing out. Other devices can use a different choice.

The setting covers discovery, creator profiles, work, composing, inbox, the private crew planner, dialogs, form fields, and status bars. Existing crew member colors remain recognizable and their initials use a readable foreground color.

## Device check

1. Choose Dark, close and reopen the app, and confirm Dark remains selected.
2. Open a post, create/edit dialog, inbox, private plan, and account screen. Check text, photo badges, keyboards, and status bars.
3. Choose Light and repeat. Photos should keep their original colors.
4. Choose System, switch the phone’s appearance in Settings, and return to Crewroom. Confirm the app follows it.
5. On a narrow phone, confirm all three appearance choices and the close button remain reachable with larger system text.

Native release builds require `userInterfaceStyle: "automatic"` and `expo-system-ui`. Rebuild the native binary after changing those settings; a JavaScript refresh does not change native configuration. See [Expo’s color theme guide](https://docs.expo.dev/develop/user-interface/color-themes/).
