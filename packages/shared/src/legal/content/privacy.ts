// The privacy document's text, as Markdown in the subset parseLegalMarkdown reads (see ../markdown.ts).
// Drafted on 14 Oct 2026 for review by a lawyer; [bracketed] text is to be completed before launch.
// Changing the wording people agree to needs a new version in ../index.ts (see LEGAL_VERSION_NOTE).
export const PRIVACY_MD = `# Privacy Policy

**Draft for legal review:** text in [brackets] is to be completed before launch.

This Privacy Policy explains what personal data ECCS collects, why, who can see it, how long we keep it, how we protect it, and what your rights are. "Personal data" means any information about a person who can be identified from it, such as a name, a phone number or a photo of their face.

## 1. In short

- We collect only what we need to run the app and our cleaning, hygiene and compliance services.
- We do not sell personal data. We use no advertising or analytics trackers.
- A restaurant's information about its own employees belongs to the restaurant. We process it only for the restaurant, and ECCS's staff cannot see it.
- Face attendance is optional for every employee. It needs the employee's own consent, can be withdrawn at any time, and matches faces against an encrypted face template, not stored face photos. A small photo taken at each clock-in and clock-out is kept for 35 days.
- You can ask to see, correct or delete your data, withdraw consent, or complain. Write to [grievance email].

## 2. Who we are and how to reach us

ECCS (Eosfera Commercial Cleaning Services) is the trading name of [Registered company name], a [Company type] registered in India under [CIN or registration number], at [Registered address]. In this policy, "ECCS", "we", "us" and "our" mean [Registered company name].

- Email: [support email]
- Phone: [support phone]
- Website: [website address]

**Grievance Officer.** Our Grievance Officer handles complaints and answers questions about how we process personal data:

- Name: [Grievance Officer name]
- Designation: [Grievance Officer designation]
- Email: [grievance email]
- Phone: [support phone]
- Address: [Registered address]

## 3. Who this policy applies to

- **Restaurant users:** Owners, Managers and Head Chefs who log in to the app.
- **Restaurant employees** whose details a restaurant enters in the app for staff records, attendance, face attendance or salary tracking.
- **People at an outlet** who deal with our team, for example the person who signs off a visit.
- **Contacts at ECCS partners** (such as laboratories, training providers and medical camp providers) and at businesses listed in our vendor directory.
- **Diners and members of the public** who open a restaurant's customer page.
- **Visitors to our website**, including these legal pages.

It does not cover ECCS's own employees, who receive a separate staff notice [to confirm], or other organisations' websites and apps that we link to (such as a payment provider's pages or FSSAI's website), which have their own policies.

## 4. Our two roles

Data protection law gives two different roles to the organisations that handle personal data:

- A **Data Fiduciary** decides why and how personal data is used, and is responsible for it under the law.
- A **Data Processor** handles personal data only for a Data Fiduciary and on its instructions.

**We are the Data Fiduciary** for: the account and login details of restaurant users; business, outlet, booking, visit, inspection, invoice and support records; customer pages; partner and vendor contacts; and server logs from our app and websites.

**We are the restaurant's Data Processor** for its employees' data: staff records, attendance, face attendance, clock-in photos and salary records. The restaurant is the Data Fiduciary for this data. It decides whether to use these features, must tell its employees what it records, and is responsible for having a lawful basis. If you are a restaurant employee, please contact your employer first about this data; we will help them, and section 17 explains how you can also reach us. Our Data Processing Terms with each restaurant set out these duties.

If you are a Manager or Head Chef, you may be in both groups: we are the Data Fiduciary for your login, and your restaurant is the Data Fiduciary for your staff and salary record.

## 5. Why we are allowed to use your data

- **Your consent.** When you tick the box and agree to this policy in the app, you consent to the uses it describes. You can withdraw consent at any time, as easily as you gave it (section 17).
- **Legitimate uses the law allows.** The Digital Personal Data Protection Act, 2023 (the "DPDP Act") lets us use personal data without separate consent in some cases, for example for the purpose for which you gave it to us (such as your phone number, to send you a login code). A restaurant may rely on the legitimate use for employment purposes for its staff, attendance and salary records.
- **Legal duties.** Some data we must keep or share by law, for example GST invoices, or information an authority lawfully demands.
- **Face data always needs consent.** Face attendance is used for an employee only with that employee's own consent, given in the app. A face template is "biometric information", which the Information Technology Act rules treat as sensitive personal data needing consent in writing; consent given electronically, as in the app, is a recognised way of giving it.

If you withdraw consent, we stop the uses that depend on it, but this does not affect what was done before. Some features may then stop working for you, and we may still keep data the law requires us to keep.

## 6. What we collect and why

### Account and login details

What we collect:

- your name, your role (Owner, Manager or Head Chef) and the outlets you can use;
- the Owner's mobile number, and the one-time login codes we send to it by SMS;
- your PIN, stored only as a hash (a scrambled form that cannot be turned back into the PIN);
- the name of each linked phone, the outlet it is linked to, failed PIN attempts, and login sessions (kept as tokens);
- your app language, and an email address or profile photo if you add one;
- a record of which version of our terms and policies you agreed to, when, and from which device.

What we use it for:

- creating your account and letting you log in securely;
- showing you only what your role allows;
- sending login codes and service messages;
- keeping proof of our agreement with you and your restaurant;
- protecting accounts, for example locking a phone after repeated wrong PINs.

### Business and outlet details

What we collect:

- the business's name, GSTIN and billing address;
- each outlet's name, address and map location;
- names and phone numbers of contact people at each outlet.

What we use it for:

- arranging visits, issuing invoices and contacting you;
- checking where proof photos were taken, and sorting the vendor directory by distance;
- showing the outlet's name on its customer page, if the Owner switches it on.

### Daily checklists and proof photos

What we collect:

- ticks, notes and times for each checklist item, and who filled it in;
- proof photos taken in the app;
- if the person allows location access, where the phone was when the photo was taken, how accurate that was, and the distance from the outlet;
- checks on each photo: a digital fingerprint (to spot the same file used again or a near-identical picture), the time the phone gave compared with our server's time, and whether the phone reported its location as faked.

What we use it for:

- recording and showing the outlet's daily hygiene work to its own users;
- working out the checklist part of the hygiene score;
- flagging doubtful photos for checking.

Our office cannot browse a restaurant's checklist photos. It sees only the photos the restaurant chooses to send for its customer page, and may see how many photos were flagged, but not the photos themselves.

### Service visits and inspections

What we collect:

- bookings, visit dates and times, the tasks done and the chemicals used;
- before and after photos taken by our Supervisor;
- the sign-off: the name and role of the person who signed, their signature where the app asks for it, and any rating and comment;
- service reports, certificates, inspection findings and photos, scores, grades and corrective actions;
- issues you raise with us, and our replies.

What we use it for:

- delivering, recording and approving the services you book;
- giving you reports and certificates;
- handling complaints, and checking and improving the quality of our work.

### Licences and document vault

What we collect:

- licence and registration numbers (such as FSSAI, trade licence and fire NOC), their expiry dates, and copies you upload;
- any personal details printed on those copies, such as a licence holder's name, address or photo.

What we use it for:

- storing your documents and reminding you before they expire;
- working out the licence part of the hygiene score.

Please do not upload documents carrying information we do not need, such as Aadhaar numbers. If a restaurant uploads documents about its employees, such as medical fitness certificates, we process them for the restaurant as employee data [to confirm].

### Food labels

What we collect:

- item names, prepared and use-by times, and the name of the person who printed the label.

What we use it for:

- printing the label, and showing who printed it, for the kitchen's own records.

### Billing and payments

What we collect:

- your Plan, invoices, credit notes, amounts, GST details and payment status;
- payment reference numbers and the type of payment method used.

What we use it for:

- billing, refunds, accounting and meeting GST law.

When you pay online, the payment provider collects your card, UPI or bank details directly. We do not receive or store full card numbers or banking passwords.

### Notifications

What we collect:

- a push token for your phone (a code that lets it receive notifications), and the notifications we send you and whether you have read them.

What we use it for:

- telling you about visits, reports, reminders, flags and replies.

### Technical and security information

What we collect:

- IP address, device type, operating system, app version, times of requests and error reports, kept in server logs;
- audit logs showing who changed attendance, face enrolment, staff, salary and other sensitive records, and when.

What we use it for:

- keeping the app secure, preventing fraud and misuse, fixing faults, and meeting legal duties such as reporting cyber incidents.

### Restaurant employees' data (processed for the restaurant)

What we collect, as entered by the restaurant:

- name, job title, phone number, joining and leaving dates, pay type, salary or daily wage, overtime rate and weekly day off;
- clock-in and clock-out times, how each was recorded (face or PIN), flags, and corrections with the reason and who made them;
- face attendance data, only where the employee has consented (section 7);
- a small photo taken at each clock-in and clock-out;
- salary tracker entries: days worked, pay worked out, overtime, bonuses, advances, deductions, payments and balance;
- the employee's consent record for face attendance (which notice version, in which language, when) and any withdrawal.

What we use it for:

- only to keep the restaurant's attendance and salary records, as the restaurant instructs.

The salary tracker is a record book. It is not payroll, calculates no PF or ESI, sends no money, and does not ask for bank or card details. Only the restaurant's Owner, and its Managers as the app allows, can see this data. ECCS's staff cannot.

### Partner contacts and vendor directory

What we collect:

- names, roles, phone numbers and email addresses of people at ECCS partners;
- for each vendor in the directory: business name, what it sells, area, address and location, phone and WhatsApp numbers, delivery details, opening hours, and FSSAI number as given. Where a vendor is a sole trader, some of this is personal data.

What we use it for:

- arranging partner services you book;
- showing restaurants vendors near them.

### Diners and website visitors

We do not ask diners or website visitors for any personal data. There are no forms, cookies or trackers on the customer page or these legal pages. Like every web server, ours receive technical details with each request (IP address, browser type, the page asked for and the time), which we keep in server logs only to deliver the page, keep it secure and find faults.

## 7. Face attendance, in plain words

- **What it is.** A way for a restaurant's employees to clock in and out by showing their face to the outlet's linked phone. Each restaurant decides whether to use it.
- **Consent comes first.** The Owner can add an employee's face only after the employee personally reads and accepts a consent notice in the app, in their own language. We record which version of the notice they accepted, in which language and when.
- **Saying no is free.** An employee can refuse, or withdraw later, with no effect on their job or pay. They are then clocked in and out by an Owner's or Manager's PIN instead.
- **What is stored.** A few photos of the face are turned into a face template: a list of numbers. The photos used to make it are not kept. The template is encrypted before it is stored, with a key kept apart from the database, and is unlocked only in our server's memory for the moment of comparison.
- **How matching works.** The phone only finds the face in the camera picture. Recognising who it is happens on ECCS's own servers, using openly licensed face-recognition models, and compares the face only with the employees enrolled at that outlet. We do not send faces to another company for matching.
- **Clock-in photos.** A small photo is taken at each clock-in and clock-out. It is kept for 35 days so the Owner and Manager can check it, then deleted automatically.
- **Deletion.** The template is deleted at once when the employee withdraws consent, when they are recorded as having left, or when the restaurant's account closes.
- **Under 18s** are not enrolled.
- **No other use.** Face data is used only for clocking in and out. It is not sold, not shared and not used for advertising.
- **Mistakes.** Like any face system, it can make mistakes, for example with look-alikes. Unsure matches are flagged for the Owner, who can correct a day's attendance, with the reason recorded.
- **How to withdraw.** Tell the Owner or Manager, who must record it in the app straight away, or write to [grievance email]. If you write to us, we will delete your template after checking who you are, and tell your employer.

## 8. Location and phone permissions

- **Location.** The app asks for location permission only to save where a proof photo was taken and compare it with the outlet's location. You can refuse, or switch it off later in your phone's settings; the photo is then saved without a location. We do not track your location in the background or at any other time.
- **Camera.** Used only when you take a photo in the app or clock in by face.
- **Notifications.** The app asks before sending push notifications. You can turn them off in your phone's settings; the in-app list of notifications still works.

## 9. Photos

- **Proof photos** for checklists are seen by the restaurant's own users. Our office cannot browse them.
- **Visit and inspection photos** are taken by our Supervisor and seen by the restaurant and our office.
- **Clock-in photos** are seen by the Owner and Manager and deleted after 35 days.
- **Profile photos** are optional.
- **Customer page photos** are chosen by the restaurant and approved by us, and shown for at most 90 days.

Please avoid photographing people when it is not needed, and never send a photo of identifiable people for the customer page unless they have agreed.

## 10. Push and in-app notifications

Notifications appear in your in-app list and, if you allow it, as push notifications on your phone. Push notifications are delivered through push notification services, such as Google's Firebase Cloud Messaging, so the text of a notification (for example an outlet name, a task name, or an employee's name in an attendance alert) passes through them and may be processed outside India. We do not send marketing notifications without your consent.

## 11. The customer page

- **What it shows:** yesterday's hygiene score, the names of the outlet's daily checklists and whether each was done, photos the restaurant chose and we approved, our latest inspection result, and recent services.
- **What it never shows:** staff names, prices or bills.
- **Who controls it:** the Owner switches it on or off. We can take a page down.
- **How long:** a photo is shown for at most 90 days, and an inspection result for at most 180 days.
- **Privacy for diners:** the page uses no cookies, no trackers and no analytics, and asks search engines not to list it in their results (most do as asked, but we cannot control every search engine).
- **What it is:** a private assessment by ECCS, a private company paid by the restaurant, not associated with FSSAI, TG-SAFE or any government body. The page says so.

## 12. Cookies and similar technologies

Cookies are small files a website stores in your browser.

- The customer page and these legal pages set no cookies.
- The app keeps your login token in your phone's secure storage, and keeps work done without signal on the phone until it uploads.
- Our console, used only by ECCS staff, keeps its login token in the browser's local storage, a similar small store in the browser.
- We use no advertising or analytics trackers and no third-party cookies. If this changes, we will update this policy first and ask for consent where needed.

## 13. Who we share data with

- **Within your restaurant**, according to roles: the Owner sees all outlets, a Manager sees their outlet, and a Head Chef sees kitchen work.
- **ECCS staff**, only what their role needs. Our office cannot see employees' data or browse checklist photos.
- **Service providers** who work for us under contracts that require confidentiality and security: hosting and file storage, SMS delivery of login codes, push notifications, and payment processing. They may use the data only to provide their service to us.
- **ECCS partners**, for a service you book, only the details needed to deliver it, such as the outlet's name, address, contact person and booking details.
- **The public**, only through the customer page, as the Owner chooses.
- **Authorities**, when the law requires it, for example a court order, a tax authority, or CERT-In (India's computer emergency response team), or when needed to protect people's safety or our legal rights.
- **A business that takes over ECCS**, including a company formed to carry on its business, under the same protections, with notice to you.

The current list of our service providers and partners is available on request at [grievance email].

### We do not sell personal data

We never sell or rent personal data, and we do not use it for advertising.

## 14. Where data is stored, and transfers outside India

We store the app's data, including photos and documents, on servers and cloud storage located in India [to confirm]. We do not send face templates or clock-in photos outside India.

Some service providers may process data outside India, in particular push notification services. The DPDP Act allows personal data to be transferred outside India except to countries the Government of India restricts by notification, and we will follow any such restriction. We transfer data only to providers who protect it to the standard Indian law requires.

## 15. How long we keep data

We keep personal data only as long as we need it for the purposes in this policy or as the law requires, and then delete it or remove anything that identifies people.

- **Clock-in and clock-out photos:** 35 days, then deleted automatically.
- **Face templates:** until the employee withdraws consent or is recorded as having left, or the account closes; then deleted at once. Enrolment photos are not kept at all.
- **Face consent records:** for as long as the employee's staff record exists, and deleted with it.
- **Restaurant data** (checklists, proof photos, documents, labels, staff records, attendance and salary records): while the account is active, unless the restaurant deletes them sooner. After the account closes, the Owner can export it for 30 days [to confirm], and we delete it within 90 days of closure [to confirm].
- **Customer page:** a photo is shown for at most 90 days and an inspection result for at most 180 days. The photos and results themselves are kept with the records above.
- **Visit records, sign-offs, service reports, certificates and inspection reports:** while the account is active and for 3 years after it closes [to confirm], because they record the work we did and may be needed to answer a claim.
- **Invoices, credit notes and payment records:** at least as long as GST law requires. Under section 36 of the Central Goods and Services Tax Act, 2017, that is 72 months from the due date of the annual GST return for the year concerned, which is about seven to eight years from the invoice date; longer if another law or an open tax case requires it.
- **Account details of users:** while the login is active, then deleted or anonymised within 1 year [to confirm] after the login is removed or the account closes, except where they appear in records we keep for longer, such as a name on an invoice or a signed service report.
- **Records of agreement to our terms and policies:** while the account exists and for 3 years after it closes [to confirm].
- **Support messages and issues:** while the account is active and for 1 year after it closes [to confirm].
- **Partner and vendor contact details:** while the relationship or listing lasts, and for up to 1 year after [to confirm].
- **Server, security and audit logs**, including logs of visits to customer pages: 1 year [to confirm], then deleted.
- **Backups:** deleted data may remain in backup copies for up to 30 days [to confirm] until they are overwritten.

Where a law requires us to keep data longer (for example, from May 2027 the DPDP Rules require certain personal data and logs to be kept for at least one year from processing), we keep it only for that purpose, securely, and then delete it.

## 16. How we protect data

We take these measures:

- connections between the app, browsers and our servers are encrypted (HTTPS);
- face templates are encrypted (AES-256) with a key kept apart from the database;
- PINs are stored only as keyed hashes, never as the PIN itself;
- login tokens are kept in the phone's secure storage, and sessions can be ended;
- role-based access: each person sees only what their role allows, and ECCS staff are refused access to restaurants' employee data;
- audit logs record who changed attendance, faces and other sensitive records;
- a phone is locked after repeated wrong PINs;
- our staff and service providers are bound to keep data confidential.

No system is completely secure, and we cannot guarantee that data will never be lost or accessed without permission. If you think your account or data is at risk, tell us at once at [support email].

### If there is a data breach

- We act at once to contain it and find out what happened.
- We report cyber incidents to CERT-In within 6 hours of noticing them, as the law requires.
- For data we are responsible for, we tell the people affected without delay: what happened, the likely consequences, what we are doing, what you can do to protect yourself, and whom to contact. From May 2027 we also report to the Data Protection Board of India as the DPDP Rules require: at once, and in detail within 72 hours.
- For restaurant employees' data, we tell the restaurant promptly, as our Data Processing Terms set out, and help it inform its employees and the Board.

## 17. Your rights

You have the right to:

- **Access:** get a summary of your personal data, how we use it, and whom we have shared it with;
- **Correction:** have inaccurate or incomplete data corrected, completed or updated;
- **Erasure:** have your data deleted when it is no longer needed, unless the law requires us to keep it;
- **Withdraw consent** at any time, as easily as you gave it;
- **Grievance redressal:** have your complaint dealt with by our Grievance Officer;
- **Nominate** someone to use these rights for you if you die or become unable to act.

**How to use them.** You can correct some details yourself in the app. For anything else, write to [grievance email] or call [support phone]. To protect you, we may check who you are, for example by a call or message to the phone number on your account. There is no fee.

**Restaurant employees.** Please ask your employer first, since the restaurant is responsible for your data. You can also write to us: we will pass your request to the restaurant within 3 working days [to confirm] and help it reply. For face attendance, you can withdraw consent directly with us, as section 7 explains.

**How fast we reply.** We acknowledge every request within 48 hours and reply in full within one month of receiving it. This meets the one month the Information Technology Act rules allow for grievances, and is well within the 90 days the DPDP Rules allow.

The law also asks you to give true information when you use these rights, and not to make false or frivolous complaints.

## 18. Deleting your account

**How to ask.** In the app, open Profile and tap "How to delete your account", which brings you to this section. To ask for deletion, write to [grievance email] or [support email] from anywhere, or raise an issue in the app. Tell us your name, your role, your restaurant's name and the phone number or outlet you use. You do not need the app installed to ask. We will check who you are and delete your account within 30 days [to confirm], and tell you when it is done. Uninstalling the app does not delete your account.

**Managers and Head Chefs.** The Owner can remove your login at any time in the app, which ends your access at once. You can also ask us directly.

**Owners.** The Owner's account controls the restaurant's account, so deleting it closes the restaurant's account, unless the business tells us who takes over as Owner. Before we close it, you can export your restaurant's data, and we will end any Plan. Unpaid invoices remain payable, but they do not stop us deleting your login.

**What we delete:** your login, name, phone number, email, PIN hash, profile photo, push tokens and settings.

**What we keep, and why:**

- invoices and payment records, because GST law requires it;
- the record of your agreement to our terms, as proof of the contract;
- your name where it appears in sign-offs, service and inspection reports, or audit logs, as a record of work done and for security;
- records you created for the restaurant, such as checklist entries, which remain part of the restaurant's data.

We keep these only for the periods in section 15.

**Employees without a login.** Ask your employer to delete your staff record, or write to us and we will pass it on. Your face template can be deleted at once on your request.

## 19. Children

- The app is only for people aged 18 or over.
- We do not knowingly collect personal data about children (people under 18), except where a restaurant records an employee who is under 18. The restaurant is then responsible for following labour and data protection law, including getting a parent's verifiable consent where the law requires it. Under 18s are never enrolled for face attendance.
- The customer page and our website collect nothing from children, and we do no tracking or targeted advertising.
- If we learn that we hold a child's data without a lawful basis, we will delete it.

## 20. Which laws apply, and when

- **In force now:** section 43A of the Information Technology Act, 2000 and the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011. They require this published policy, consent in writing before collecting sensitive personal data (which includes passwords such as PINs, financial information, health records and biometric information such as face templates), reasonable security, and a Grievance Officer who resolves complaints within one month.
- **In force now:** CERT-In's directions of 2022, which require cyber incidents to be reported within 6 hours and system logs to be kept.
- **Starting in phases:** the DPDP Act and the Digital Personal Data Protection Rules, 2025, notified in November 2025. The provisions setting up the Data Protection Board of India started then. The rules on Consent Managers start in November 2026. The main duties (notices, consent, security, breach reporting, retention, children's data, rights, and replying to grievances within 90 days) start in May 2027, 18 months after the Rules were published. From then, section 43A and the 2011 rules stop applying.

We already follow the DPDP standard wherever we can.

## 21. Complaints, and the Data Protection Board of India

If you are unhappy with how we handle your data, please contact our Grievance Officer first (section 2). The DPDP Act requires you to use our grievance process before going to the Data Protection Board.

If you are not satisfied with our answer, then once the Board's complaint powers start in May 2027 you can complain to the Data Protection Board of India, which is set up to work digitally, at [Data Protection Board address]. Until then, you may approach the Adjudicating Officer under section 46 of the Information Technology Act, 2000, or the courts.

Restaurant employees should first raise complaints about their employee data with the restaurant, which is responsible for it.

## 22. Changes to this policy

We may update this policy, for example when the law changes or we add features. The version date at the top shows which version applies. If we make a material change, we will tell you in the app or by email before it takes effect, and the app will ask you to agree to the new version. If we want to use personal data for a new purpose that needs consent, we will ask first.
`;
