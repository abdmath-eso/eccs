# ECCS DevOps plan: automatic deploys, no stored keys

**A plan for the founder to approve (20 Oct 2026). Nothing in it is built yet.**

What the founder asked for:
- anything changed in the app or the console reaches AWS by itself;
- no long-lived keys: OIDC or federated identity, for AWS and for the Anthropic (Claude) API.

## 1. The answer

| | Today | After this plan |
|---|---|---|
| **A change to the console or the API** | Claude runs `deploy.ps1` from this PC | GitHub tests it and puts it on AWS by itself when it reaches `main` (at end of day, as now), or at the press of "Deploy now" |
| **A change to the phone app** | A new APK built on this PC, sent to each phone by hand | Screen and text changes reach installed phones by themselves (an over-the-air update); a new APK is built only when native parts change |
| **AWS keys** | An admin key on this PC; an S3 key on the server | **None stored.** GitHub signs in to AWS with a token that lasts minutes (OIDC); the server has an AWS role, not a key |
| **The Anthropic key** | A permanent `sk-ant-` key in the server's settings file | **None.** The server proves who it is with an AWS-signed token, and Anthropic gives it a 10-minute Claude token (Workload Identity Federation) |
| **The server's other secrets** | In a settings file copied over SSH | In AWS Parameter Store (encrypted), read by the server through its role |
| **Server access** | SSH with a key file, port 22 open | AWS Session Manager; port 22 closed |
| **AWS cost a month** | about US$14 (Lightsail 2 GB) | **about US$25** (EC2 2 GB), so about US$11 more. GitHub Actions, Parameter Store, Session Manager and federation are free at this size |

## 2. How it fits together

```
 you commit ─► GitHub (main)
                 │
                 ├─ CI: type checks, lint, unit tests, end-to-end tests (a throwaway database)
                 │
                 └─ CD (only if CI passed):
                      1. signs in to AWS with GitHub's OIDC token (no key stored in GitHub)
                      2. builds the API, migrate and console images; pushes them to ECR (Mumbai)
                      3. tells the server, through AWS Systems Manager, to deploy that version
                      4. the server pulls the images with its own role, migrates, starts, checks health;
                         if health fails, it puts the previous version back by itself
                      5. pushes the phone app's over-the-air update (if the app changed)

 EC2 server "eccs-live" (Mumbai), role eccs-server, no keys on it:
   ├─ reads its secrets from Parameter Store
   ├─ reads and writes photos in S3
   ├─ pulls images from ECR
   ├─ is reached through Session Manager (no SSH)
   └─ gets an AWS-signed token (STS GetWebIdentityToken) ─► Anthropic exchanges it for a short-lived Claude token
```

## 3. Why EC2 instead of Lightsail

**Every keyless step above needs the server to have an AWS IAM role.** EC2 servers have one; Lightsail servers cannot. Without a role:
- the server would still need a stored S3 key;
- a stored registry key;
- an SSH key in GitHub;
- and an Anthropic key, because Anthropic's AWS federation needs the role's identity.

The other options are weaker:
- **Keep Lightsail with SSH from GitHub.** That needs a permanent SSH private key stored in GitHub, the opposite of what was asked.
- **Keep Lightsail and register it as a "hybrid" Systems Manager node.** This gives it temporary AWS credentials, but through a workaround (a credentials file written by the agent). AWS meant this for servers outside AWS, so it is not the standard path.
- **Lightsail's container service.** It is managed, but a 4 GB size is US$80 a month, and it still has no role for Anthropic.

**EC2 t3.small** (2 GB, x86, the same size as today) runs the same images unchanged:
- **Server:** about US$16.4 a month.
- **Disk:** about US$3 (30 GB).
- **Public address:** US$3.65.
- **Image registry (ECR):** about US$1 a month (the last 10 versions).

If 2 GB becomes tight, t3.medium (4 GB) is about US$33. AWS's ARM servers (t4g) are cheaper per GB, but the images would need building and testing for ARM first.

## 4. The pieces, one by one

### 4.1 CI: every push is checked (GitHub Actions)
- **What runs, on every push and pull request:**
  - install;
  - type checks (shared, API, console, app, database package);
  - lint;
  - the shared unit tests;
  - the API's end-to-end tests, against a throwaway PostgreSQL and S3 stand-in started for the run with the sample data.
- **Time:** about 10 to 15 minutes.
- **Cost:** a private repository gets 2,000 free minutes a month, which is about 60 to 80 runs.
- **If a check fails:** nothing deploys, and GitHub emails the person who pushed.

### 4.2 Signing GitHub in to AWS without a key (OIDC)
- **The link:**
  - AWS is told to trust GitHub's token issuer (`token.actions.githubusercontent.com`).
  - A role `eccs-github-deploy` can be taken on only by this repository's `main` branch in the `production` environment. The trust rule pins the exact subject, so other branches, forks and pull requests cannot use it.
- **What the role may do, and nothing else:**
  - push to the two ECR repositories;
  - send one Systems Manager command (the deploy script), only to `eccs-live`;
  - read the deploy's result.
- **Session length:** 15 minutes. Nothing is stored in GitHub's secrets for AWS.

### 4.3 The deploy itself
- **The images:** the same three as today (`infra/docker/`), tagged with the commit, kept in ECR (Mumbai). A lifecycle rule keeps the last 10.
- **On the server:** the deploy script does what `deploy.ps1` does now:
  - pull the images, run the migrations, start the new version, wait for "healthy";
  - **if the health check fails, roll back by itself** to the previous tag.
- **Manual controls in GitHub:**
  - a **Deploy now** button (`workflow_dispatch`) for a deploy outside the end-of-day push;
  - a **Roll back** button with a version to return to.
- **The founder's rule stays:** code reaches GitHub at end of day, so deploys normally happen then, once a day. To deploy at every push instead, that is one setting.
- **Optional:** GitHub's "required reviewer" on the `production` environment makes each deploy wait for the founder's click.

### 4.4 The server's identity (role `eccs-server`)
- **What the role allows:**
  - read and write only the photo bucket;
  - pull from ECR;
  - Systems Manager (the deploy commands and Session Manager);
  - read only its own parameters (`/eccs/live/*`);
  - `sts:GetWebIdentityToken` (for Anthropic).
- **Inside the containers:** they reach these credentials through the server's metadata service, set to IMDSv2 only, with a hop limit of 2 so containers can reach it.
- **The S3 access key in `eccs.env` is deleted:** the API's S3 client already falls back to the server's role when no key is set.

### 4.5 Secrets in Parameter Store
- **Moved there, as encrypted SecureString parameters (free):**
  - `PIN_SECRET`, `FILE_URL_SECRET`, `FACE_TEMPLATE_KEY`;
  - the database password.
- **How they reach the containers:** the deploy script writes them into the server's environment at start-up. They never pass through GitHub or this PC.
- **The copy in the founder's password manager stays** as the backup. Above all `FACE_TEMPLATE_KEY`: lose it, and every face has to be enrolled again.

### 4.6 The Anthropic key: Workload Identity Federation
- **Anthropic offers this, generally available since mid-2026:** a workload presents a short-lived token signed by its own identity provider, and Anthropic returns a short-lived Claude token (`sk-ant-oat01-…`, minutes long). No `sk-ant-` key exists to leak.
- **On AWS it works through the server's role.** The server calls STS `GetWebIdentityToken` (audience `https://api.anthropic.com`), and Anthropic checks the token against a rule that names the role `arn:aws:iam::412611737507:role/eccs-server`.
- **Setup:**
  1. **AWS:** turn on "Outbound web identity federation" in IAM's account settings (one switch), and allow the role to call `sts:GetWebIdentityToken`.
  2. **Claude Console** (the founder, as an organization admin): Settings, then **Workload identity**, then **Connect workload**, then **AWS**. Give it the issuer URL AWS shows and the role ARN. It creates a service account, the issuer and a rule (token life 10 minutes).
  3. **The code:**
     - `apps/api/src/ai/claude-engine.ts` sends `Authorization: Bearer <token>` instead of `x-api-key`;
     - it gets and refreshes the token (STS, then `POST /v1/oauth/token`), about 60 lines;
     - it uses the key when `ANTHROPIC_API_KEY` is set, which keeps this PC's development copy working.
  4. **Cut-over:** remove `ANTHROPIC_API_KEY` from the server, confirm the AI usage page still records requests, then **delete the key** in the Claude Console.
- **The AI usage page and the daily limits are unchanged:** they count requests on our side.
- **Bedrock was looked at and not chosen.** Claude through Amazon Bedrock would also remove the key (IAM roles), but:
  - from Mumbai, the 5.5 models only run through Bedrock's *global* routing, so requests may be processed anywhere. Only the older models (Sonnet 5, Haiku 4.5) can be kept inside India;
  - it means rewriting the AI engine for Bedrock's model names and features;
  - it is not confirmed that the account's credits pay for Claude on Bedrock.

### 4.7 The phone app
- **Over-the-air updates (EAS Update):** screen, text and logic changes (the JavaScript) reach installed apps by themselves, at the next app start.
  - **Setup:** add `expo-updates`, with the "fingerprint" rule, so an update only goes to phones whose native parts match. Then one last APK is installed by hand.
  - **After that,** CI publishes an update when `apps/mobile` changes.
  - **Cost:** free up to 1,000 phones a month.
  - **Rule:** small fixes and screen changes only. Google Play's policy forbids changing what the app fundamentally is outside the store.
- **New APKs:** only when native parts change (a new library, permissions, the Expo version). CI builds it on a version tag (`v1.2.0`) and keeps the file with the GitHub release. When the Google Play account exists, it uploads to Play's internal-testing track instead.
- **The one remaining stored secret:** Expo has no OIDC, so CI needs an Expo "robot" token, stored as a GitHub secret. It can only publish updates and builds for this one project, and it is renewed yearly.

### 4.8 Watching it
- **AWS:**
  - the EC2 status-check alarm and a Route 53 health check on `https://api.eosfera.in/v1/health` (US$0.50 a month);
  - both email the founder through SNS.
- **The database:**
  - a nightly `pg_dump` to S3, kept 30 days;
  - plus nightly EBS snapshots of the disk (Data Lifecycle Manager, 7 kept).
- **Later, optional:**
  - send the containers' logs to CloudWatch Logs (pay per GB);
  - Sentry's free plan for errors.

## 5. Order of work

| Phase | What | Who | Time |
|---|---|---|---|
| **1. CI** | The GitHub Actions checks (4.1). Nothing on AWS changes. | Claude | half a day |
| **2. Keyless AWS and CD** | OIDC provider and the two roles. EC2 `eccs-live-2` with its role, Session Manager, and the metadata service set as above. ECR, Parameter Store, the deploy workflow with rollback. **Move the data from Lightsail** (`pg_dump` and restore, copy nothing else, S3 is unchanged). Point the three DNS names at the new address. Delete the Lightsail server, its static IP and the S3 access key. | Claude, with the founder's yes for each AWS step; the founder changes the three DNS records at GoDaddy | one day, then about 30 minutes of the app being away while the DNS changes over |
| **3. Anthropic federation** | Switch on outbound federation; the console wizard; the code change; cut-over; delete the key (4.6). | The founder (Claude Console admin) and Claude | half a day |
| **4. The phone app** | `expo-updates`, the update workflow, the APK-on-tag workflow, one last APK (4.7). | Claude, and the founder makes the Expo robot token | half a day to a day |
| **5. Watching** | Alarms, health check, nightly dump, snapshots (4.8). | Claude | a few hours |

**Afterwards,** this PC's admin key can be replaced by `aws login` or deleted. Claude needs no AWS key for deploys any more.

## 6. Choices for the founder

1. **Move from Lightsail to EC2** for the keyless setup: about US$11 a month more. **Recommended:** it is what makes "no stored keys" possible.
2. **When to deploy:** automatically at each end-of-day push to `main` (recommended), with a **Deploy now** button for the rest of the day. Or wait for the founder's click on each deploy.
3. **Anthropic federation (4.6),** or keep a key and store it in Parameter Store instead of the settings file, which is still a long-lived key.
4. **Over-the-air updates for the phone app (4.7):** these need the Expo robot token as the one stored secret.
5. **A test copy (staging):** not now. Add one when real restaurants are on the live server; with this pipeline it is a second server and a second environment.

## Sources

- [Claude: Workload Identity Federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation)
- [Claude: Use WIF with AWS (STS GetWebIdentityToken)](https://platform.claude.com/docs/en/manage-claude/wif-providers/aws)
- [GitHub Docs: OpenID Connect in Amazon Web Services](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)
- [AWS: run commands on EC2 with Systems Manager](https://aws.amazon.com/blogs/mt/run-scripts-stored-in-private-or-public-github-repositories-using-amazon-ec2-systems-manager)
- [AWS: Bedrock in-country inference for Claude in India](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-expands-claude-model-availability-to-india-cross-region-inference/)
- [AWS: Claude Sonnet 5.5 model card (Mumbai: global routing only)](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html)
- [Expo: plans (EAS Update free up to 1,000 monthly users)](https://docs.expo.dev/billing/plans/)
- [Google Play: Device and Network Abuse policy (updates outside Play)](https://support.google.com/googleplay/android-developer/answer/9888379)
