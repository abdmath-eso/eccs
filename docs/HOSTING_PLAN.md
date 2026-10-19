# Hosting ECCS on AWS

**A plan for the founder to approve (19 Oct 2026).** The founder opened the AWS account on 19 Oct (Free plan, US$100 of credits); nothing else is created or paid for yet. The server packaging (section 6, Claude's part) started the same day.

Prices are AWS's list prices for Mumbai (ap-south-1). Lightsail's come from AWS's own pricing page, read on 19 Oct 2026; EC2, RDS and S3 come from third-party listings, because AWS's own pages could not be read (sources at the end). Rupees are at ₹88 to the US dollar. AWS India adds 18% GST to every bill; once ECCS has a GSTIN, it can claim that back as input tax credit (check with the CA).

## 1. The answer

| | Testing (now: the founder, BD demos, sample data) | 20 restaurants (live, real data) |
|---|---|---|
| **AWS, a month, with GST** | **about ₹2,800** (US$27 + GST) | **about ₹6,100** (US$59 + GST), or **₹8,600** with a separate test server |
| Outside AWS, a month | nothing new | AI (Anthropic) about ₹2,000 to ₹2,500, never more than about ₹5,500 (the daily AI limit); login SMS about ₹200 |
| **All in, a month** | **about ₹2,800** | **about ₹8,300 to ₹11,300**, which is ₹415 to ₹565 per restaurant |

The plan's budget was up to ₹15,000 a month for the pilot (PROPOSAL, 5 Oct). New AWS accounts get up to US$200 of credits (section 5), which pay for the testing server for its first few months.

## 2. The AWS services

| Service | What it does for ECCS | Testing | 20 restaurants |
|---|---|---|---|
| **Lightsail server**, Mumbai: 4 GB memory, 2 vCPUs, 80 GB SSD, 2 TB of traffic a month included | Runs the API, the console, the customer QR pages, the PDF printing (Chromium), face matching, and HTTPS (Caddy, with free certificates). In testing it also runs the database. | US$24 | US$24 |
| **Lightsail managed PostgreSQL**, 2 GB "Standard" plan | The database, run by AWS: encrypted at rest (the US$15 plan is not, so it is not used), a backup every day kept 7 days, and restore to any minute in those 7 days. | – | US$30 |
| **S3 bucket**, Mumbai, with versioning | Photos, licences, documents and PDFs. Versioning keeps a deleted file recoverable. | under US$1 | about US$2 |
| **Lightsail snapshots** of the server, daily, 7 kept | Rebuild the server from yesterday's copy if it breaks. | about US$2 | about US$2 |
| **Route 53** | The domain's addresses (api., console., and the customer pages). | US$0.50 | US$0.50 |
| A second Lightsail server, 4 GB (optional) | A test copy: each new version goes there first, with sample data, before the live server. | – | US$24 |
| **IAM**, **AWS Budgets**, **CloudWatch**, **SNS** | Logins and keys (the server's key reaches only its own bucket); an email when the month's bill passes an amount; alarms when the server is busy or its disk is filling. | free | free |
| **Total before GST** | | **about US$27** | **about US$59** (US$83 with the test copy) |

**Not needed now**, though PROPOSAL (5 Oct) named them:
- **ElastiCache (Redis):** the code does not use Redis.
- **ECS Fargate with a load balancer:** these run several copies of the API, but the API's timed jobs (reminders, invoices, the daily digest, translations, clean-ups) run inside it, so it must run as one copy for now.
- **CloudFront:** the server's 2 TB of traffic a month is far more than 20 restaurants use.
- **Terraform:** a written runbook is enough for one server.

## 3. Why Lightsail first

- **One fixed monthly price.** The server, its disk, its address and 2 TB of traffic come in one price, with fewer parts for a two-person team to look after.
- **Data stays in India.** It is AWS in Mumbai, as the plan approved on 5 Oct. Two things already leave India: the AI requests (Anthropic, US) and the push notifications (Expo, Google).
- **No surprises with the libraries.** Lightsail servers are Intel or AMD, like this PC, so face matching (onnxruntime), photo processing (sharp) and Chromium work as tested. AWS's cheaper ARM servers (Graviton) would need checking first.
- **Moving up later is a deployment change, not a rewrite.** The same containers go to EC2 or ECS, and the database is copied to RDS (section 7).
- **A standard EC2 and RDS setup costs about the same.** A t3.medium server is about US$33 a month, plus about US$4 for its public address. An RDS db.t4g.micro database is about US$15, plus storage. That totals US$55 to 60, but has more parts to set up and watch.

## 4. What the 20-restaurant figures assume

- **Outlets and photos:** about 25 outlets, each taking about 30 checklist photos a day. Photos average about 180 KB, as the stored ones do today. That is about 4 GB a month, or about 50 GB after a year (about ₹110 a month in S3).
- **Traffic:** well under the 2 TB included. Photos pass through the API, and traffic between the server and S3 in the same region costs nothing.
- **Database:** grows by about 1 to 3 GB a year; the Logs keep 365 days. The 2 GB plan has 80 GB of disk.
- **AI**, from the console's AI usage page (19 Oct):
  - the camera nudge is about ₹0.06 a photo;
  - an ECCS Buddy message is about ₹0.08;
  - the daily digest is about ₹0.50 a day.
  - At 25 outlets that comes to about ₹2,000 to ₹2,500 a month.
  - The daily AI limit (US$2, set on that page) means it can never pass about ₹5,500 a month.
- **Login SMS:** codes are sent only for Owner and ECCS staff logins. Sessions last 30 days and staff use PINs, so only a few hundred SMS a month, at ₹0.20 to ₹0.25 each.

## 5. The first months

- **Credits:**
  - A new AWS account gets US$100 of credits at sign-up, plus US$20 for each of five starter activities (up to US$100 more).
  - Lightsail has no free plan of its own; the credits pay for it.
  - The account starts on AWS's "Free plan", which closes after 6 months or when the credits run out, and may not include every service.
  - If Lightsail is not offered on it, upgrade the account to the "Paid plan". The unused credits still count for up to 12 months from sign-up.
- **Lightsail bills a stopped server:** a server that is not needed must be deleted (keep a snapshot), not just stopped.

**Found on 19 Oct, once the account was open:**
- **Lightsail is not on the Free plan.** A user reports AWS saying "you will need to upgrade to a paid account plan to access Lightsail". Upgrade when the first server is created, not before. The credits carry over for up to 12 months from sign-up, and no charge reaches the card while credits remain. Upgrading cannot be undone.
- **Earn up to US$100 more first, while on the Free plan.** Each of five short guided tasks in the console's "Explore AWS" panel gives US$20:
  1. **Set a cost budget in AWS Budgets.** Do this anyway.
  2. **Launch and terminate an EC2 server.**
  3. **Create an RDS database,** then delete it.
  4. **Make a Lambda function with a URL.**
  5. **Ask a question in the Bedrock playground.**
- **On the account's first day, nearly everything was denied, and not by the Free plan.** Lightsail, EC2, RDS, Lambda, CloudWatch and listing S3 buckets were refused, both before and after the upgrade to the Paid plan. The refusals come from an AWS Organization the account belongs to, whose management account uses the founder's email. It turned out to be AWS's new sign-up experience (AWS Settings and a Builder ID). After the founder activated its advanced features, one region rule remained, allowing only Sydney; Mumbai is added by editing that rule (STATUS section 6).
- **Never enable AWS Organizations or Control Tower,** and never set up IAM Identity Center in a way that turns Organizations on. Any of these ends the credits at once. Use a plain IAM user for the day-to-day admin login.

## 6. Before going online

**Claude's work** (no AWS account needed until the last step):

1. **Package the app for a server.** No server packaging exists yet; the only Docker file today runs the local database, Redis and S3 stand-in. Needed:
   - the API as a container, with Chromium, the Telugu and Hindi fonts its PDFs need, and the face models;
   - the console as a Next.js standalone build;
   - Caddy for HTTPS;
   - one file that starts them all.
2. **A clean start for the live database:** the migrations and the library (services, plans, SOPs, checklists), without the sample restaurants and logins.
3. **A test-server mode:** production settings, but with the fixed login code allowed, for a server holding only sample data. The server refuses that code in production. Today the only way round that would be running the public test server in development mode.
4. **A deploy script and a runbook:** how to deploy, roll back, restore the database, and rebuild the server from a snapshot.
5. **Production settings:**
   - new random secrets for PINs, file links and face templates;
   - push notifications on;
   - the server's S3 key limited to its own bucket.
6. **Point the app at the new address** (`https://api.<domain>/v1`) and build an APK, when the founder asks.

**The founder's part** (Claude cannot create accounts or enter card details):

1. **Create the AWS account** with a card.
   - Turn on two-step login (MFA) for the main login, and use a separate admin login day to day.
   - Choose the Mumbai region.
   - Add ECCS's GSTIN in Tax Settings once it exists.
2. **Set an AWS Budgets alert:** for example ₹4,000 a month while testing, ₹10,000 when live.
3. **Choose and buy the domain** (about ₹1,000 a year). Do it before any customer QR code is printed, because the codes carry the address.
4. **Real login codes by SMS, for real restaurants:** MSG91, with DLT sender registration, which needs the registered company. This, not AWS, is what decides when real restaurants can log in.
5. **Privacy Policy:** say that data is stored with AWS in Mumbai. This joins the lawyer's review already pending (`docs/LEGAL_NOTES.md`).
6. **Keep the secrets in a password manager**, above all the face-template key. If it is lost, every staff member has to enrol their face again.

## 7. When to move up

- **Signs it is time:**
  - more than about 100 restaurants;
  - the server busy for most of the day;
  - downtime no longer acceptable.
- **The next setup:**
  - the API as two or more copies (EC2 or ECS Fargate) behind a load balancer. First the timed jobs must move to one separate worker, a code change.
  - RDS PostgreSQL across two zones;
  - CloudFront in front of the console and the photos.
- **Rough cost:** US$200 to 300 a month at list prices, to be priced in the AWS calculator at the time.

## 8. The risk of one server

- **If the server fails**, the apps are offline until it is rebuilt from the latest snapshot: by hand, in about half an hour.
- **What keeps working:** daily checklists and visits carry on offline on the phones and are sent once the server is back.
- **What stops meanwhile:** logins, ECCS Buddy, the console and the customer QR pages.
- **What protects us:**
  - a daily server snapshot;
  - the database's own backups, restorable to the minute;
  - S3 versioning;
  - an email alarm when the server stops answering.

## Sources

- [Amazon Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) (bundles, Mumbai's halved traffic allowance, managed databases, snapshots), read 19 Oct 2026
- [AWS Free Tier: US$200 in credits and a 6-month free plan](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/) and [AWS Free Tier FAQs](https://aws.amazon.com/free/faqs/)
- [AWS: 100 GB a month of data transfer out free](https://aws.amazon.com/blogs/aws/aws-free-tier-data-transfer-expansion-100-gb-from-regions-and-1-tb-from-amazon-cloudfront-per-month)
- [AWS tax help, India (GST)](https://aws.amazon.com/tax-help/india/)
- [db.t4g.micro prices by region (RDS)](https://www.bytebase.com/dbcost/rds/instance/db.t4g.micro/) and [Spare Cores: db.t4g.micro](https://sparecores.com/database/aws/db.t4g.micro) (third-party)
- [Spare Cores: t3.medium](https://sparecores.com/server/aws/t3.medium) and [Devzero: t4g.medium](https://www.devzero.io/instances/aws/t4g.medium) (third-party)
- [S3 and transfer prices for Mumbai, from an AWS partner](https://precisiontech.in/cloud/amazon-aws-cloud/aws-pricing/aws-pricing-in-mumbai/) (third-party)
- [Cloudburn: Lightsail's total cost](https://cloudburn.io/blog/amazon-lightsail-pricing) (stopped servers are still billed)
