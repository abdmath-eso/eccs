# ECCS app: building the Android APK and testing push notifications

Written 8 October 2026. This is the founder's guide to getting the ECCS app onto an Android phone as a real installed app (an APK file), and seeing push notifications arrive on it.

Until now the app ran inside Expo Go. Expo Go cannot receive push notifications on Android, so this needs a real build. There are two ways to make one, and both end in the same kind of APK file:

- **On this PC** (set up on 8 October 2026, and the quicker way day to day): see "Building on this PC" just below. This has been run: the APK was built, installed on the virtual phone, and the app linked, logged in and showed Home.
- **On Expo's computers** ("EAS Build"): Parts A to C of this guide. Needs no Android Studio, but each build takes one of 15 free builds a month and waits in a queue.

**Push notifications need the two accounts in Part A whichever way the app is built.** Everything else in the app works without them.

## Building on this PC

Android Studio, the Android SDK and a virtual phone are installed on this PC. To build:

1. Stop the mobile app's terminal (Expo) with Ctrl+C. The API and console terminals may stay running.
2. In a PowerShell window:

```powershell
cd C:\Users\eosfera\eccs\apps\mobile
.\build-apk.ps1
```

3. Wait. The first build takes 10 to 30 minutes; later ones a few minutes. It ends with "Done. The APK is at ...".
4. The file is `C:\Users\eosfera\eccs\apps\mobile\ECCS-test.apk`. Send it to the phone (USB cable, WhatsApp to yourself, Google Drive) and open it there; Android asks once to allow installing from that app. Or connect the phone by USB with "USB debugging" on and run `.\build-apk.ps1 -Install`.

Things to know:

- **The API's address is built into the APK.** By default it is this PC's Wi-Fi address (today `192.168.1.40`), port 4000. The phone must be on the same Wi-Fi, the PC on, and the API terminal running. If the PC's address changes, build again. For another address: `.\build-apk.ps1 -ApiUrl "https://your-server/v1"`.
- **The virtual phone:** open Android Studio > More Actions > Virtual Device Manager and press the play button, then `.\build-apk.ps1 -Install`. It is heavy on memory alongside Docker and the terminals.
- **Java:** the build must use Java 17, which the script finds by itself. Android Studio's own Java (25) is too new and fails with "A restricted method in java.lang.System has been called".
- **If Windows Firewall asks** whether Node may accept connections on private networks, allow it; otherwise the phone cannot reach the API.

The rest of this guide is the cloud route and the accounts push needs. **The cloud-build steps (Parts B and C) have not been run yet.** No cloud build could be made while writing it, because that needs the accounts below. Every command and file name was checked against the current Expo and Firebase documentation (the pages are listed at the end), but expect small differences in the wording of what you see on screen.

Steps marked **[Founder only]** need you personally: creating an account, logging in, or touching the phone. Claude can do the rest, or help with it.

---

## What it costs

| What | Cost | Limits found in the documentation | Page read (8 Oct 2026) |
|---|---|---|---|
| Expo account, free plan | Free | 15 Android builds a month (and 15 iOS). Builds wait in a "low-priority queue", so a build may sit for a while before it starts. A build is stopped if it runs over 45 minutes. One build at a time. | https://expo.dev/pricing |
| Expo's push notification service | Free | "There is no cost associated with sending notifications through Expo push notification service." At most 600 notifications a second per project. | https://docs.expo.dev/push-notifications/faq/ |
| Firebase project, "Spark" plan | Free | "No payment method needed." Cloud Messaging (the part we use) is listed as no-cost on every plan. | https://firebase.google.com/pricing |
| Google Play developer account | Not needed | Only needed later, to publish in the Play Store (US$25 once). An APK is installed directly. | |

So the whole test costs nothing. The one limit that matters is **15 builds a month**: each time the app's code or the PC's address changes, a new build is needed (see step 11).

Not found in the documentation: how long Expo keeps a finished APK available for download on the free plan. Download it when the build finishes.

---

## Before you start

- The phone and this PC on the **same Wi-Fi**, and that Wi-Fi connected to the internet. (Push travels PC → Expo → Google → phone, so both need the internet, not only each other.)
- An Android phone (the one used with Expo Go is fine).
- About an hour, most of it waiting for the build.

### Step 0. Stop the three terminals and install the new packages

Two packages were added to the app for this (`expo-notifications` and `expo-build-properties`). They could not be fully installed while the app was running in your terminals, because Windows locks files that are in use.

1. In each of the three VS Code terminals (API, mobile preview, console) press **Ctrl+C**.
2. In one of them, at `C:\Users\eosfera\eccs`:

```powershell
pnpm install
pnpm build
```

3. Start the three terminals again as usual (`docs/STATUS.md`, "See it running").

Until this is done, every `pnpm` command prints a warning that "the install that runs before scripts failed". After it, the warning is gone.

---

## Part A. Accounts (once only)

### Step 1. Create the free Expo account  **[Founder only]**

1. Open https://expo.dev/signup in a browser.
2. Sign up with the ECCS email address. Choose a username; write it down, with the password.
3. Confirm the email if Expo asks.

### Step 2. Create the free Firebase project  **[Founder only]**

Google delivers the notifications to Android phones. Firebase is the Google website where an app gets permission for that.

1. Open https://console.firebase.google.com and sign in with a Google account that ECCS owns (not a personal one you may lose).
2. Click to create a project. Enter a project name, for example `ECCS`.
3. Google Analytics is optional: you can switch it off. Finish creating the project. No payment method is asked for.

### Step 3. Download `google-services.json`  **[Founder only]**

This file tells the app which Firebase project it belongs to.

1. In the Firebase project, add an **Android** app (the Android icon on the project's first page).
2. **Android package name:** type exactly

   ```
   com.eosfera.eccs
   ```

   It must match exactly, or push will not work. The app nickname is optional (`ECCS`). Register the app.
3. Click **Download google-services.json**.
4. You can skip the remaining steps Firebase shows ("Add Firebase SDK" and so on): Expo does those.
5. Move the downloaded file to this exact place and name:

   ```
   C:\Users\eosfera\eccs\apps\mobile\google-services.json
   ```

   If Windows named it `google-services (1).json`, rename it to `google-services.json`.

**May this file be committed to GitHub?** Yes. Expo's documentation says it "contains public-facing identifiers" and may be committed; Firebase's says it "contains unique, but non-secret identifiers". It is committed here, because the cloud build only receives files that Git knows about. (If you lose it, it can be downloaded again from the Firebase project's settings.)

### Step 4. Download the service account key  **[Founder only]**

This is a different file, and this one **is a secret**: it is the private key that lets a server send notifications as ECCS. Expo's documentation says to store it securely and to add it to `.gitignore`. **Never commit it, never send it to anyone, never put it in a chat.**

1. In the Firebase console: **Project settings** (the gear) → **Service accounts**.
2. Click **Generate New Private Key**, then **Generate Key**. A `.json` file downloads, with a name like `eccs-xxxxx-firebase-adminsdk-xxxxx-xxxxxxxxxx.json`.
3. Move it **outside the project**, for example:

   ```powershell
   New-Item -ItemType Directory -Force C:\Users\eosfera\eccs-keys
   Move-Item "$env:USERPROFILE\Downloads\*firebase-adminsdk*.json" C:\Users\eosfera\eccs-keys\
   ```

   (As a safety net, `.gitignore` also refuses any file with `firebase-adminsdk` in its name.)

---

## Part B. Connect the project to Expo (once only)

All commands from here are run in PowerShell **from the app's folder**:

```powershell
cd C:\Users\eosfera\eccs\apps\mobile
```

`npx eas-cli@latest` downloads and runs Expo's build tool; the first time it asks to install it, answer `y`.

### Step 5. Log in to Expo  **[Founder only]**

```powershell
npx eas-cli@latest login
```

Enter the Expo username (or email) and password from step 1. Check it worked:

```powershell
npx eas-cli@latest whoami
```

It prints your username.

### Step 6. Create the project at Expo

```powershell
npx eas-cli@latest init
```

It asks whether to create a project for `eccs` under your account: answer yes. It then writes the project's id into `apps/mobile/app.json` (a new `extra` → `eas` → `projectId`, and an `owner` line). The app needs this id to get its push address.

Check it is there:

```powershell
git diff app.json
```

You should see a `projectId` line. If instead the command printed the id and asked you to add it by hand, tell Claude: it goes in `app.json` under `"expo"` as `"extra": { "eas": { "projectId": "…" } }`.

### Step 7. Give Expo the service account key  **[Founder only]**

Expo sends our notifications on to Google, and needs the key from step 4 to do it. Either way works.

**In the browser (simpler):**

1. Open https://expo.dev, sign in, open the `eccs` project.
2. **Project settings** → **Credentials**.
3. Under Android, click **Add Application Identifier** (or choose `com.eosfera.eccs` if it is listed). If asked, the identifier is `com.eosfera.eccs`.
4. Under **Service Credentials** → **FCM V1 service account key**, click **Add a service account key** and upload the file from `C:\Users\eosfera\eccs-keys\`.

**Or in the terminal:**

```powershell
npx eas-cli@latest credentials
```

Choose, in order: `Android` → the build profile it offers (`preview`; Expo's own example shows `production`, and the key belongs to the app, not to one profile) → `Google Service Account` → `Manage your Google Service Account Key for Push Notifications (FCM V1)` → `Set up a Google Service Account Key for Push Notifications (FCM V1)` → `Upload a new service account key`, then give the path to the file in `C:\Users\eosfera\eccs-keys\`.

### Step 8. Check the PC's address, then commit

The address of the API is built into the APK. It is in `apps/mobile/eas.json`, under `preview` → `env` → `EXPO_PUBLIC_API_URL`, and today says `http://192.168.1.40:4000/v1`.

Check the PC still has that address:

```powershell
ipconfig
```

Look under "Wireless LAN adapter Wi-Fi" for **IPv4 Address**. If it is not `192.168.1.40`, change the number in `eas.json` (keep `http://`, `:4000/v1`) before building.

Then ask Claude to commit (`google-services.json`, `app.json`, and `eas.json` if changed). The cloud build is made from the files Git knows about.

---

## Part C. Build and install

### Step 9. Run the cloud build

```powershell
cd C:\Users\eosfera\eccs\apps\mobile
npx eas-cli@latest build --platform android --profile preview
```

- The first time it asks about an **Android Keystore** (the signature that proves later versions come from ECCS): let it **generate a new one**. Expo keeps it in your account and reuses it for every later build.
- It uploads the project, then shows a link to the build's page. You can close the terminal; the build carries on at Expo. On the free plan it may wait in the queue before starting.
- When it finishes, the terminal (and the build's page at expo.dev) shows a **link and a QR code** to the APK.

If the build stops straight away saying `apps/mobile/google-services.json is missing`, step 3 or the commit in step 8 was missed.

If the build fails for another reason, open the build's page, and send Claude the red part of the log.

### Step 10. Install the APK on the phone  **[Founder only]**

1. On the phone, scan the QR code with the camera (or open the build's link in Chrome, signed in to expo.dev), and tap **Install** / download the `.apk` file. Anyone with the link can download it, so do not post it publicly.
2. Open the downloaded file (from Chrome's download bar, or the Files app → Downloads).
3. Android says the browser (or Files) is not allowed to install apps. Tap **Settings**, switch on **Allow from this source**, go back, tap **Install**.
4. If Google Play Protect says it does not recognise the app, choose **Install anyway**: it only means the app did not come from the Play Store.
5. Open **ECCS**. It is a separate app from Expo Go; both can stay on the phone.

A later build installs over this one and keeps the phone linked and logged in, as long as it comes from the same Expo account (same keystore).

---

## Part D. Make it work with this PC

### Step 11. The phone must reach the API on this PC

1. The API must be running (terminal 1) and the phone on the same Wi-Fi.
2. On the phone's browser open:

   ```
   http://192.168.1.40:4000/v1/health
   ```

   It should show `{"status":"ok"}`. If it does, the app will work too.

If it does not load:

- Check the Wi-Fi is marked Private on the PC:

  ```powershell
  Get-NetConnectionProfile
  ```

  `NetworkCategory` should say `Private`. If it says `Public`, in PowerShell opened with **Run as administrator**:

  ```powershell
  Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
  ```

- Allow the API's port through Windows Firewall. In PowerShell opened with **Run as administrator**  **[Founder only: needs the admin password]**:

  ```powershell
  New-NetFirewallRule -DisplayName "ECCS API (port 4000)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4000 -Profile Private
  ```

  (On 6 Oct the firewall already let Node through on private networks, so this is usually not needed.)

- Some routers stop devices on Wi-Fi from talking to each other ("AP isolation" or "client isolation"). If the health page still does not load, look for that setting in the router, or use the phone's hotspot for both.

**When the PC's address changes** (after a router restart, or on another Wi-Fi), the installed APK can no longer find the API and says it cannot reach the server. Then:

1. `ipconfig`, read the new IPv4 address.
2. Put it in `apps/mobile/eas.json` (`EXPO_PUBLIC_API_URL`), and in `apps/mobile/.env.local` for Expo Go.
3. Commit, build again (step 9) and install again (step 10). This uses one of the month's 15 builds.

To avoid this, give the PC a fixed address in the router ("DHCP reservation" / "static lease" for this PC), so it always gets `192.168.1.40`.

### Step 12. Switch push on in the API

Push is off unless switched on. Open `C:\Users\eosfera\eccs\.env` (not `.env.example`) and add this line:

```
PUSH_NOTIFICATIONS=on
```

Restart the API (Ctrl+C in terminal 1, then):

```powershell
pnpm build
pnpm --filter @eccs/api start
```

In the API's output you should see: `Push notifications are ON: new notifications are also sent to registered phones through Expo.` With it off, it says how to turn it on.

From now on the words of each notification pass through Expo's and Google's servers on their way to the phone.

---

## Part E. Test

### Step 13. Turn notifications on in the app  **[Founder only]**

1. Open ECCS on the phone and log in (for example restaurant code `SPICE-JH2K7M`, PIN `2580`, the Owner).
2. Tap the **bell**. The app asks "Get told straight away?". Tap **Turn on notifications**, then **Allow** on Android's own question.
3. The Notifications screen now has a line: **"Notifications are on for this phone."** (On Android 12 or older there is no question to answer: notifications are allowed from the start and the line appears by itself.)

What the other lines mean:

| The line says | Meaning | Do |
|---|---|---|
| Notifications are on for this phone, but ECCS is not sending them to phones yet. | The phone is registered, the API has push switched off. | Step 12. |
| Notifications are off for this phone… | Not allowed yet. | Tap **Turn on notifications**. |
| Notifications from ECCS are blocked in this phone's settings… | "Don't allow" was chosen (twice, on newer Android). | Tap **Open phone settings** → Notifications → allow. |
| Notifications could not be set up on this phone… | The phone could not get its push address or reach the API. | Check the internet and step 11; if it stays, the build is missing `google-services.json` or the project id (steps 3 and 6). |
| This version of the app cannot show notifications on the phone… | This is Expo Go or the browser preview, not the APK. | Use the installed ECCS app. |

### Step 14. Send a test push from the console

1. On the PC open the console (http://localhost:3000), log in as an ECCS admin (`9000000001`, code `123456`).
2. Open **Notifications** (the bell). At the bottom is **Push notifications to phones**. It should say "Push is on."
3. Under **Send a test to**, choose the person logged in on the phone (only people with a phone registered are listed), and click **Send a test push**.
4. Within a few seconds the phone shows **"Test notification"**. Try it three ways: with the app open, with the app in the background, and with the app swiped away. Tapping it opens the app on the Notifications screen.

What the result under the button means:

| Result | Meaning |
|---|---|
| Sent to 1 phone. | Expo accepted it. If nothing arrives: is the phone online, and are notifications allowed for ECCS? |
| Nothing was sent: push is switched off on the server. | Step 12. |
| Nothing was sent: this person has no phone registered. | They are not logged in on the APK, pressed Lock, or have not allowed notifications. |
| The push service said: `InvalidCredentials` or `MismatchSenderId` | The key from step 7 is missing, or is from a different Firebase project than `google-services.json`. Redo steps 3, 4 and 7 from the same Firebase project; a change to `google-services.json` needs a new build. |
| The push service said: `DeviceNotRegistered` | The app was removed from that phone. The phone is taken off the list automatically. |

### Step 15. Try real notifications

With the Owner logged in on the phone:

- In the console, open **Issues**, open one raised by Spice Route and reply. The phone shows "ECCS replied". Tap it: the app opens on that issue.
- In the console, **Visits** → confirm a booking request, or move a visit. The phone shows "Booking confirmed" or "Visit moved"; tapping opens the visit.
- Change the app's language (More → language), then cause another one: it arrives in that language.

Shared phone check: press **Lock** in the app (More → Lock). Send a test to the Owner again: the console says the person has no phone registered, and nothing appears on the phone. Log in as the Manager (PIN `4821`): the phone now receives the Manager's notifications only.

---

## If something goes wrong

| What you see | Likely cause |
|---|---|
| The app opens but says it cannot reach the server | The PC's address changed, the API is not running, the firewall, or different Wi-Fi. Step 11. |
| The build fails at "Install dependencies", in a step named `eas-build-post-install`, or at "Run gradlew" | Send Claude the red part of the log from the build's page. The first build of a project often needs one correction. |
| The app worked in Expo Go but a photo or a file fails in the APK | Tell Claude which screen: a few things behave differently in an installed app. |
| `eas` says the `eas.json` is not valid | The file contains comments, which the build tool accepts; if a tool refuses them, ask Claude to remove the comment lines. |

---

## Documentation these steps were checked against (read 8 October 2026)

- Expo, notifications library for SDK 57: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
- Expo, push notifications setup: https://docs.expo.dev/push-notifications/push-notifications-setup/
- Expo, Firebase (FCM V1) credentials, including which file may be committed: https://docs.expo.dev/push-notifications/fcm-credentials/
- Expo, sending notifications (the service our API calls): https://docs.expo.dev/push-notifications/sending-notifications/
- Expo, push notifications FAQ (cost, limits): https://docs.expo.dev/push-notifications/faq/
- Expo, building an APK: https://docs.expo.dev/build-reference/apk/
- Expo, first build (login, credentials): https://docs.expo.dev/build/setup/
- Expo, internal distribution (the install link): https://docs.expo.dev/build/internal-distribution/
- Expo, `eas.json` reference: https://docs.expo.dev/eas/json/ and command list: https://docs.expo.dev/eas/cli/
- Expo, build properties (plain http on Android): https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/
- Expo, environment variables in cloud builds: https://docs.expo.dev/build-reference/variables/
- Expo, monorepos: https://docs.expo.dev/build-reference/build-with-monorepos/ and https://docs.expo.dev/guides/monorepos/
- Expo, app version codes: https://docs.expo.dev/build-reference/app-versions/
- Expo pricing: https://expo.dev/pricing
- Firebase, adding an Android app: https://firebase.google.com/docs/android/setup
- Firebase pricing: https://firebase.google.com/pricing
- The Windows commands (`ipconfig`, `Get-NetConnectionProfile`, `Set-NetConnectionProfile`, `New-NetFirewallRule`) are standard Windows PowerShell commands and were not checked against a web page.
