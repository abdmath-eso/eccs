# Test logins

Every login for trying the ECCS apps on this computer. **All of this is sample data** created by the seed (`packages/db/prisma/seed.ts`). None of it is a real person, phone number or password, and none of it must be used once the system goes live.

The one-time code (OTP) is always **`123456`** in development. No SMS is sent.

---

## 1. Restaurant app (mobile app)

Open the app, tap **"I have a restaurant code"**, type the code for the branch once, then enter a PIN. The phone remembers the branch; after that it only asks for a PIN.

### Spice Route Kitchens (two branches)

| Branch | Restaurant code |
|---|---|
| Spice Route, Jubilee Hills | **`SPICE-JH2K7M`** |
| Spice Route, Gachibowli | **`SPICE-GB4N8P`** |

| Person | Role | PIN | Works with code | App language | Sees |
|---|---|---|---|---|---|
| Sample Owner (Spice Route) | Owner | **`2580`** | either Spice code | English | Both branches |
| Sample Manager (Jubilee Hills) | Manager | **`4821`** | `SPICE-JH2K7M` | English | Jubilee Hills only |
| Sample Head Chef (Jubilee Hills) | Head Chef | **`7306`** | `SPICE-JH2K7M` | Telugu | Jubilee Hills only |
| Sample Manager (Gachibowli) | Manager | **`1593`** | `SPICE-GB4N8P` | Hindi | Gachibowli only |
| Sample Head Chef (Gachibowli) | Head Chef | **`6042`** | `SPICE-GB4N8P` | Hindi | Gachibowli only |

### Deccan Biryani House (one branch)

| Branch | Restaurant code |
|---|---|
| Deccan Biryani House, Kukatpally | **`DECCA-KP6R3T`** |

| Person | Role | PIN | App language | Sees |
|---|---|---|---|---|
| Sample Owner (Deccan Biryani) | Owner | **`3917`** | Telugu | Kukatpally |
| Sample Head Chef (Kukatpally) | Head Chef | **`8264`** | Telugu | Kukatpally |

Deccan Biryani has no Manager in the sample data. Add one from **Staff logins** as the Owner if you want to test that.

### Switching person or branch

- **Next person on the same phone:** open the menu (top left of the home screen) and tap **Lock**. The PIN pad comes back.
- **A different branch or restaurant:** on the PIN pad tap **"Use a different restaurant"**, then enter another code.
- The language can be changed at the bottom of the menu.

### Owner's login by phone and one-time code

This is the flow a new owner uses once, to link their phone and be given a PIN. Tap **"I am the owner"**.

| Owner | Phone | Email | One-time code |
|---|---|---|---|
| Sample Owner (Spice Route) | `9100000001` | owner@spiceroute.example | `123456` |
| Sample Owner (Deccan Biryani) | `9100000002` | owner@deccanbiryani.example | `123456` |

The sample owners already have a PIN, so this simply logs them in and keeps the PIN in the tables above. Only **"Owner: forgot PIN"** on the PIN pad (same phone number and code) issues a **new PIN**; the old one then stops working, so note the new one, or reset everything with the command in section 4.

---

## 2. ECCS web console

Open http://localhost:3000, enter the phone number, then the code.

| Person | Role | Phone | One-time code | Can do |
|---|---|---|---|---|
| Sample Super Admin | Super Admin | `9000000001` | `123456` | Everything |
| Sample Ops Manager | Operations Manager | `9000000002` | `123456` | Clients, issues, licences, SOPs |
| Sample Supervisor | Supervisor | `9000000003` | `123456` | Mostly read-only |

The same three can log in to the mobile app through **"ECCS staff login"**, but the app has nothing built for ECCS staff yet; their work is in the console.

---

## 3. What each restaurant role can open

| Section | Owner | Manager | Head Chef |
|---|---|---|---|
| Dashboard (home screen) | Yes, with branch selector | Yes, own branch | Today's checklists only |
| Daily checklists | Fill in, review, set up | Fill in, review, set up | Fill in |
| Raise an issue | Yes | Yes | Yes |
| SOPs | Read, add own | Read, add own | Read |
| History calendar | Yes | Yes | No |
| Licences and documents | Yes | Yes | No |
| Staff logins | Yes | Yes, own branch | No |

---

## 4. If a login stops working

- **"Could not reach the server":** the API is not running. Start it with `pnpm --filter @eccs/api start` from `C:\Users\eosfera\eccs`.
- **A PIN is refused:** check the phone is linked to the right branch (a Manager's or Head Chef's PIN only works with their own branch's code). It may also have been changed from Staff logins ("New PIN") or by "Owner: forgot PIN". The Owner can issue a new PIN from **Staff logins**.
- **Five wrong PINs in a row** lock that phone (or browser) for 15 minutes, for everyone. Wait, or use another device.
- **Reset everything to the lists above:** run this from `C:\Users\eosfera\eccs\packages\db`. **It wipes all data** (checklists filled in, issues, licences, SOPs you added) and reloads the samples.

  ```powershell
  pnpm seed
  ```

---

## 5. Where to open the apps

| App | Address |
|---|---|
| Restaurant app in a browser | http://localhost:8081 |
| ECCS web console | http://localhost:3000 |
| Restaurant app on the Android phone | Expo Go, scan the QR code from `pnpm --filter @eccs/mobile start` |

How to start them is in `docs/STATUS.md`, section 6, "See it running".
