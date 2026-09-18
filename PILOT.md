# Try Crewroom on your next shoot

This pilot answers one question: **does Crewroom make an upcoming group shoot easier to organize?** Use a real shoot and one willing friend. Allow about 20 minutes, then use the plan again before the shoot.

The app is a local prototype for iOS, Android, and web. It is not publicly deployed. Invite links work only while the development server is reachable. There are no push notifications or automatic email invitations; coordinate changes with your crew as usual.

## Get it onto a phone

From this project directory, the person running the project should use `npm run dev:phone` for the LAN API and Expo development server. Use `npm run dev` for the local web preview. Check `README.md` for setup and any required environment configuration.

1. Connect the phone and computer to the same Wi-Fi, then run `npm run dev:phone`.
2. Use the LAN URLs printed by the launcher. It configures the API and mobile client automatically. A phone's `localhost` refers to the phone, not the computer; if the selected address is wrong, see `CREWROOM_LAN_IP` in `README.md`.
3. Open the Expo QR code with Expo Go: Camera on iPhone, or the scanner in Expo Go on Android. Use an Expo Go version compatible with this project's Expo SDK.
4. Keep the API and Expo processes running. If the app cannot connect, check the configured IP, Wi-Fi isolation, and the computer's firewall. An Expo tunnel alone does not expose the local API.
5. Open copied invitation links in a browser. Phone mode sets their web origin to the computer's LAN address, for example `http://<computer-LAN-IP>:8081`. Do not assume a copied web invite automatically deep-links into Expo Go.

Expo Go is a native development preview, not an installed production release. A web test or simulator result does not establish that the app works on an actual iPhone or Android phone.

## Your first session: five tasks

### 1. Put your next shoot in one place

Try the demo briefly, then create an account and a crew for your own shoot. Create a project with its title, fandom, date, meeting time, and a location your friend could actually find.

**Success:** after closing and reopening the app, you can find the real plan and its meeting details without searching a chat history. If you upgraded the demo account, sample data may still be present; clearly name your real crew.

### 2. Make the lineup understandable

Set your character and current readiness for this project. Roles describe crew responsibilities; the captain can specify them when adding a planned member. Add one planned cosplayer and one planned photographer or helper. A planned member is a placeholder, not someone who has joined. Leave one costume unfinished so there is a real reason to check readiness later. Character and readiness should belong to this shoot's lineup, so a future project can use a different costume.

**Success:** you can tell who is doing what, who is still preparing, and which people have actually joined.

### 3. Turn preparation into concrete tasks

Add three small jobs you genuinely need, such as “finish wig styling,” “confirm photographer,” and “pack repair kit.” Assign them and add a useful due date. Complete one, then reopen the plan to confirm the assignment and completion were saved.

**Success:** your friend could identify their next action without asking you. Record any uncertainty about who owns a task.

### 4. Plan the shoot day and make one change

Add three timeline entries: meet up, shoot begins, and wrap up. Include a useful location or note. Change the project's meeting detail as if the venue or time changed. Timeline entries currently support adding and deleting; replace an entry if it needs correction.

**Success:** the latest plan is clear on a small screen. Remember that a saved change does not send a push notification.

### 5. Bring one real friend into the plan

Create an invite for the planned friend and share its copied link yourself. With the server running, your friend opens the LAN link, creates or signs into a real account, and accepts it. Demo accounts cannot accept invitations. They should claim the planned member entry, keeping its assignments, then set their own character/readiness and complete an assigned task. Refresh or reopen your view to confirm the change.

Invites expire after seven days and admit one person. Create a separate link for each friend. A general crew invite adds a new member; use a planned member's invite to preserve work already assigned to them. Revoke an unused link if you shared it with the wrong person. The captain can remove a non-owner member; a member can leave, but the owner cannot leave their own crew.

**Success:** two people can contribute to one useful plan. A different account cannot reuse the consumed invitation or see an unrelated private crew.

## What to tell us afterward

For each task, mark **worked unaided / needed help / blocked**, and note where you got stuck. Then answer:

- What did you still have to put in your group chat or notes?
- Which detail would you open Crewroom to check before the shoot?
- Did your friend understand their role and next action?
- Would you start the next shoot here? Why or why not?

Do not count enthusiasm alone as success. The strongest signal is returning to update the real plan and bringing a second participant back with you.

## Release acceptance checklist

- [ ] Complete all five tasks on an actual iPhone; record device, OS, Expo Go version, date, and result.
- [ ] Complete all five tasks on an actual Android phone; record the same details.
- [ ] Check keyboard behavior, scrolling, readable text, and reachable controls on both devices.
- [ ] Confirm project, task, and lineup changes survive reopening the app and restarting the API.
- [ ] Check signup, logout, a second account, invitation acceptance, replay rejection, and crew isolation.
- [ ] Confirm a claimed planned member keeps assignments; a revoked invite cannot be accepted; a removed member loses access.
- [ ] Give one person different characters/readiness in two projects and confirm the lineups stay independent.
- [ ] Clearly show network failures instead of implying an edit saved.

**Device verification is pending until these checks are actually performed.** Record results here; do not mark a platform verified from build or web checks alone.

| Device / OS / Expo Go | Date | Five tasks | Issues / evidence |
|---|---|---|---|
| iPhone — pending | — | Not tested | — |
| Android — pending | — | Not tested | — |
