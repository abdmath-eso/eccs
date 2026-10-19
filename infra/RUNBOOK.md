# Running ECCS on a server: the runbook

How to put ECCS on one Amazon Lightsail server in Mumbai, keep it running, update it, and get it back when something breaks. Written for the founder; every command is given in full. The plan behind it is `docs/HOSTING_PLAN.md` (19 Oct 2026).

> **Never turn on AWS Organizations, Control Tower, or IAM Identity Center (which switches on Organizations) on the account while it is on AWS's Free plan.** Doing so ends the free credits at once. Nothing in this runbook needs any of them.

## Contents

1. [What runs where](#1-what-runs-where)
2. [What this PC needs](#2-what-this-pc-needs)
3. [Create the server](#3-create-the-server)
4. [Create the file storage (S3)](#4-create-the-file-storage-s3)
5. [Create the database (live server only)](#5-create-the-database-live-server-only)
6. [Point the domain at the server](#6-point-the-domain-at-the-server)
7. [Prepare the server](#7-prepare-the-server)
8. [The settings file](#8-the-settings-file)
9. [The first deploy and the first Super Admin](#9-the-first-deploy-and-the-first-super-admin)
10. [Deploy a new version](#10-deploy-a-new-version)
11. [Roll back](#11-roll-back)
12. [Restore the database](#12-restore-the-database)
13. [Rebuild the server from a snapshot](#13-rebuild-the-server-from-a-snapshot)
14. [What to keep safe off the server](#14-what-to-keep-safe-off-the-server)
15. [Everyday commands](#15-everyday-commands)

## 1. What runs where

One server (Lightsail, Mumbai, Ubuntu 24.04, 4 GB of memory, 2 processors) runs four containers with Docker:

| Container | What it does |
|---|---|
| `caddy` | Answers on the internet (ports 80 and 443), gets and renews the free HTTPS certificates by itself, and passes each request on. |
| `api` | The ECCS API: logins, data, photos, PDFs (with Chromium), face matching. Exactly one copy, because its timed jobs (reminders, invoices, plan visits) run inside it. |
| `web` | The console, the customer QR pages, the quote pages and the legal pages. |
| `postgres` | **Test server only**: its own database. The live server uses Lightsail's managed database instead, which AWS backs up every day. |

Photos and documents go to an S3 bucket. The files that define all this are in `infra/`:

- `infra/docker/api.Dockerfile` and `web.Dockerfile`: how the images are built;
- `infra/server/compose.yml`, `Caddyfile`, `server.env.example`: what the server runs;
- `infra/server/setup-server.sh`: prepares a new server, once;
- `infra/scripts/deploy.ps1`: builds a new version on this PC and puts it on the server;
- `infra/scripts/new-secrets.mjs`: makes the three secret keys.

**A test server and a live server** use the same files. The test server holds sample data, uses its own database, and lets anyone log in with the fixed code (`SAMPLE_SERVER=on`). The live server holds real restaurants, uses the managed database, and needs real SMS codes.

> **The live server cannot log anyone in yet.** Login codes are sent by SMS, and SMS (MSG91, with DLT registration) is not built. Until it is, only the test server, with its fixed code, can be used.

## 2. What this PC needs

All of these are already on the founder's PC: Docker Desktop (running), Git, this repository, and Windows' own SSH (`ssh` and `scp`). Every PC command below is for **PowerShell**, run from the repository folder:

```powershell
cd C:\Users\eosfera\eccs
```

## 3. Create the server

In the AWS console (Lightsail must be on the "Paid plan" account; see `docs/HOSTING_PLAN.md` section 5):

1. Open **Lightsail** and choose **Create instance**.
2. **Location**: Mumbai (`ap-south-1`), zone A.
3. **Platform**: Linux/Unix. **Blueprint**: "OS Only", **Ubuntu 24.04 LTS**.
4. **SSH key pair**: "Create new", name it `eccs-lightsail`, and download the `.pem` file. Save it as `C:\Users\eosfera\.ssh\eccs-lightsail.pem`. Lightsail will not show it again.
5. **Plan**: the 4 GB plan (2 vCPUs, 80 GB SSD, US$24 a month). The "dual-stack" one is fine.
6. **Name**: `eccs-test` for the test server or `eccs-live` for the live one. Create it.

Then, on the server's page:

7. **Static IP**: tab **Networking**, **Attach static IP**, create one named like the server. Note the address (for example `13.200.10.20`). It is free while attached; the address never changes, even when the server is rebuilt.
8. **Firewall**: same tab, under **IPv4 Firewall**, keep exactly three rules, and the same under **IPv6 Firewall**:
   - SSH, TCP 22
   - HTTP, TCP 80
   - HTTPS, TCP 443
   Delete any other rule.
9. **Automatic snapshots**: tab **Snapshots**, switch **Automatic snapshots** on, and pick a time at night (for example 03:00 India time). Lightsail keeps the newest seven.

Lock the key file so SSH accepts it (once):

```powershell
$key = "$HOME\.ssh\eccs-lightsail.pem"
icacls $key /inheritance:r
icacls $key /grant:r "$($env:USERNAME):(R)"
```

From here on, in PowerShell, set these two lines first in every new window (with your own address):

```powershell
$ip = '13.200.10.20'
$key = "$HOME\.ssh\eccs-lightsail.pem"
```

## 4. Create the file storage (S3)

**The bucket.** In the AWS console, open **S3**, then **Create bucket**:

- Region: Asia Pacific (Mumbai) `ap-south-1`.
- Name: unique in all of AWS, for example `eccs-files-live` (or `eccs-files-test`).
- **Block all public access**: on (the default). ECCS shows files only through its own signed links.
- **Bucket Versioning**: **Enable**. A deleted or replaced file can then be brought back.
- Default encryption: SSE-S3 (the default).

Optionally, under the bucket's **Management** tab, add a lifecycle rule "Permanently delete noncurrent versions" after 90 days, so old versions do not pile up.

**A key that reaches only this bucket.** Lightsail servers cannot use AWS roles, so the server gets an access key of its own:

1. Open **IAM**, then **Users**, **Create user**, named `eccs-server-live` (or `-test`). Do not give it console access.
2. On the permissions step choose **Attach policies directly**, attach nothing, and finish.
3. Open the user, **Add permissions**, **Create inline policy**, tab **JSON**, and paste this, with your bucket's name in both places:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "EccsFiles",
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::eccs-files-live/*"
       },
       {
         "Sid": "EccsBucket",
         "Effect": "Allow",
         "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
         "Resource": "arn:aws:s3:::eccs-files-live"
       }
     ]
   }
   ```

   Name the policy `eccs-files-only`.
4. Tab **Security credentials**, **Create access key**, use case "Application running outside AWS". Copy the **Access key** and the **Secret access key** straight into the settings file (section 8) and the password manager. AWS shows the secret only once.

## 5. Create the database (live server only)

The test server skips this: its database runs on the server itself.

1. In **Lightsail**, tab **Databases**, **Create database**, location Mumbai (same zone as the server if offered).
2. **PostgreSQL 16** (the version ECCS is tested with).
3. **Specify login credentials**: user name `eccs_admin`, and a password of 24 or more **letters and digits only** (no symbols: the password goes inside a web-style address, where symbols need escaping). Keep it in the password manager.
4. **Database name**: `eccs`.
5. **Plan**: Standard, 2 GB (US$30 a month; encrypted, a backup every day kept 7 days, restore to any minute).
6. Name it `eccs-live-db` and create it. It takes about 15 minutes.
7. Leave **Public mode** off: only Lightsail servers in the same region can reach it.
8. On its **Connect** tab, note the **Endpoint**. The settings file then gets:

   ```
   DATABASE_URL=postgresql://eccs_admin:PASSWORD@ENDPOINT:5432/eccs?sslmode=require
   ```

   The images already trust Amazon's database certificates.

## 6. Point the domain at the server

Three names, all pointing at the static IP (an "A" record each, TTL 300), in Route 53's hosted zone for the domain or at the registrar:

| Name | Used for | Setting in .env |
|---|---|---|
| `api.<domain>` | the API the apps and the console call | `API_HOST` |
| `console.<domain>` | the console | `CONSOLE_HOST`, `WEB_URL` |
| `<domain>` itself | what printed QR codes and quote links hold | `PUBLIC_HOST`, `PUBLIC_PAGE_BASE_URL` |

For a test server use other names, for example `api.test.<domain>`, `console.test.<domain>` and `test.<domain>`.

**Decide the QR address before printing any QR code.** Every printed code holds `PUBLIC_PAGE_BASE_URL` for good; changing it later breaks every printed code.

Before the first start, check each name answers with the server's address (Caddy can only get a certificate once it does):

```powershell
Resolve-DnsName api.example.in
```

## 7. Prepare the server

Once per new server. Copy the setup script over and run it:

```powershell
scp -i $key infra/server/setup-server.sh ubuntu@${ip}:~
ssh -i $key ubuntu@$ip "sudo bash setup-server.sh"
```

The first `ssh` asks whether to trust the server's fingerprint: type `yes`. The script installs Docker, adds 2 GB of swap, closes the server's own firewall to everything but SSH, 80 and 443, turns on automatic security updates, and makes the folder `/opt/eccs`. If it ends with "The updates need a restart", run:

```powershell
ssh -i $key ubuntu@$ip "sudo reboot"
```

Security updates install themselves every day, but a new Linux kernel only takes effect after a restart: once a month, or when `ssh -i $key ubuntu@$ip "ls /var/run/reboot-required"` finds the file, run the reboot above at a quiet hour. ECCS starts again by itself.

## 8. The settings file

The server's settings live in one file, `/opt/eccs/.env`. It holds the passwords and keys, so it is made on this PC **outside the repository**, kept in the password manager, and copied to the server.

1. Make a folder for it and start from the example:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\Documents\eccs-server" | Out-Null
   Copy-Item infra\server\server.env.example "$HOME\Documents\eccs-server\live.env"
   ```

2. Add the three secret keys (they are written into the file and never shown):

   ```powershell
   node infra\scripts\new-secrets.mjs "$HOME\Documents\eccs-server\live.env"
   ```

   It refuses a file inside the repository that git could commit. Run again, it keeps the keys already there. **If `FACE_TEMPLATE_KEY` is ever lost or changed, every staff member has to enrol their face again**, and a new `PIN_SECRET` stops every restaurant PIN working.

3. Open the file in Notepad (`notepad "$HOME\Documents\eccs-server\live.env"`) and fill in every line: the three addresses, `ACME_EMAIL`, `WEB_URL` and `PUBLIC_PAGE_BASE_URL`, `DATABASE_URL` (section 5), the S3 bucket and key (section 4), and `ANTHROPIC_API_KEY`. Each line has a comment saying what it is.

   For a **test server** (its own database, sample data, the fixed code), change these lines instead:

   ```
   COMPOSE_PROFILES=testing
   SAMPLE_SERVER=on
   DEV_FIXED_OTP=123456
   POSTGRES_PASSWORD=<letters and digits>
   DATABASE_URL=postgresql://eccs:<the same password>@postgres:5432/eccs
   PUSH_NOTIFICATIONS=off
   ```

4. Save a copy in the password manager. Then copy it to the server and lock it:

   ```powershell
   scp -i $key "$HOME\Documents\eccs-server\live.env" ubuntu@${ip}:/opt/eccs/.env
   ssh -i $key ubuntu@$ip "chmod 600 /opt/eccs/.env"
   ```

To change a setting later: change your copy, copy it over again as above, then run `docker compose up -d` on the server (section 15).

## 9. The first deploy and the first Super Admin

**Deploy.** On this PC, with everything committed:

```powershell
.\infra\scripts\deploy.ps1 -Server $ip -KeyPath $key
```

It reads the API's address from the server's settings, builds the three images for this commit (about 10 minutes the first time), uploads them (about 600 MB, once per version), applies the database migrations, and starts everything. At the end it says "Done" and shows the containers as `healthy`. Caddy then gets the certificates; the first visit may take half a minute.

Check in a browser: `https://api.<domain>/v1/health` shows `{"status":"ok"}`, and `https://console.<domain>` shows the console's login.

**Load the library and the first Super Admin** (once, on a new database). Put your own number and name:

```powershell
ssh -i $key ubuntu@$ip "cd /opt/eccs && docker compose run --rm migrate npm run seed:live -- --phone 98xxxxxxxx --name 'Full Name'"
```

It loads the services and plans, the SOPs and SOP library, the inspection checklist, the checklist suggestions and their translations, and makes that person the Super Admin. It loads no sample restaurants or people. Run again, it changes nothing; it refuses to make a second Super Admin (add people from the console instead).

**A test server with sample data instead**: on a test server only (`SAMPLE_SERVER=on`), this **wipes the database** and loads the sample restaurants and logins of `docs/TEST_LOGINS.md`:

```powershell
ssh -i $key ubuntu@$ip "cd /opt/eccs && docker compose run --rm migrate npm run seed"
```

On a server without `SAMPLE_SERVER=on` it refuses.

## 10. Deploy a new version

Commit the change, then:

```powershell
.\infra\scripts\deploy.ps1 -Server $ip -KeyPath $key
```

The version running before is kept as "previous". If the database migrations fail, the new version is not started and the old one keeps running.

The phone app does not change with a deploy. It is built separately (`docs/APK_BUILD.md`), pointed at `https://api.<domain>/v1`.

## 11. Roll back

If a new version misbehaves:

```powershell
.\infra\scripts\deploy.ps1 -Server $ip -KeyPath $key -Rollback
```

This puts the previous version back in about a minute (running it again goes forward again). It does **not** undo database changes: if the new version's migrations changed the database in a way the old version cannot read, restore the database to just before the deploy (section 12).

## 12. Restore the database

**Live server (managed database).** Lightsail can make a new database as it was at any minute of the last 7 days:

1. Lightsail, **Databases**, `eccs-live-db`, tab **Snapshots & restore**.
2. **Restore to a point in time**: pick the moment (before the problem), name the new database `eccs-live-db-restored`, create it, and wait until it is available.
3. On its **Connect** tab, copy the new endpoint into `DATABASE_URL` in your copy of the settings file, copy the file to the server (section 8, step 4), and run:

   ```powershell
   ssh -i $key ubuntu@$ip "cd /opt/eccs && docker compose up -d --force-recreate api"
   ```

4. Check the console. When all is well, delete the old database (Lightsail bills it while it exists).

Before a risky change you can also keep a copy of your own. Open a terminal on the server (`ssh -i $key ubuntu@$ip`), then type:

```bash
cd /opt/eccs
docker run --rm --env-file .env postgres:16-alpine sh -c 'pg_dump --no-owner "$DATABASE_URL"' | gzip > backup-$(date +%F).sql.gz
ls -lh backup-*
exit
```

**Test server (its own database).** Its data is inside the server, so the daily server snapshot covers it (section 13). A copy by hand, in a terminal on the server:

```bash
cd /opt/eccs
docker compose exec -T postgres pg_dump -U eccs eccs | gzip > backup-$(date +%F).sql.gz
```

## 13. Rebuild the server from a snapshot

If the server is broken beyond a restart:

1. Lightsail, the server's tab **Snapshots**: on the newest good snapshot choose **Create new instance**. Keep Mumbai and the 4 GB plan; name it `eccs-live-2`.
2. When it is running, tab **Networking**: detach the static IP from the broken server and attach it to the new one. The domain needs no change.
3. Set the new server's firewall as in section 3, step 8, and switch its automatic snapshots on.
4. ECCS starts by itself. Check `https://api.<domain>/v1/health`, then delete the broken server (a stopped server is still billed).

The managed database and S3 are separate and are not affected.

## 14. What to keep safe off the server

- **The settings file** (`live.env`, `test.env`) in the password manager. Above all `FACE_TEMPLATE_KEY` and `PIN_SECRET`; also the database password, the S3 key and the Anthropic key.
- **The SSH key** `eccs-lightsail.pem`, also in the password manager. Without it the server can only be reached through Lightsail's browser terminal.
- The rest is kept by AWS: server snapshots (7 days), the managed database's backups (7 days, any minute), and S3's old file versions.

## 15. Everyday commands

Open a terminal on the server with `ssh -i $key ubuntu@$ip`, type `cd /opt/eccs`, then any of these; `exit` leaves the server:

| To | Command |
|---|---|
| See what runs and whether it is healthy | `docker compose ps` |
| Read the API's latest log | `docker compose logs --tail 200 api` |
| Read the console's or Caddy's log | `docker compose logs --tail 200 web` (or `caddy`) |
| Apply a changed setting | `docker compose up -d` |
| Restart the API | `docker compose restart api` |
| See which versions have been deployed | `cat deploy-history.log` |
| Memory and processor use | `docker stats --no-stream` |
| Free disk space | `df -h /` |

If the console does not open: `docker compose ps` should show four (live: three) containers `healthy`. If `api` is not, its log says why in a sentence (a database it cannot reach, a missing setting). If HTTPS fails on a new server, the domain usually does not point at the server yet (section 6); Caddy keeps trying by itself.
