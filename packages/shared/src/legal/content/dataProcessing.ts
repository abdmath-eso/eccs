// The dataProcessing document's text, as Markdown in the subset parseLegalMarkdown reads (see ../markdown.ts).
// Drafted on 14 Oct 2026 for review by a lawyer; [bracketed] text is to be completed before launch.
// Changing the wording people agree to needs a new version in ../index.ts (see LEGAL_VERSION_NOTE).
export const DATA_PROCESSING_MD = `# Data Processing Terms

**Draft for legal review:** text in [brackets] is to be completed before launch.

## 1. What these terms are

These Data Processing Terms are an agreement between the Restaurant and [Registered company name], "ECCS" or "we", about the personal data of the Restaurant's own employees that the Restaurant keeps in the ECCS app. They form part of our Terms of Service and are accepted by the Owner on the Restaurant's behalf. Words defined in the Terms of Service have the same meaning here.

The Digital Personal Data Protection Act, 2023 (the "DPDP Act") allows a Data Fiduciary to have personal data processed by a Data Processor only under a valid contract. These terms are that contract.

## 2. Words we use

- **Staff data** means personal data about the Restaurant's employees kept in the app: staff records, attendance, face attendance data, clock-in photos, salary tracker entries and face consent records.
- **Employee** means any person whose Staff data the Restaurant enters, including Managers and Head Chefs in their role as employees.
- **Data Fiduciary** means the party that decides why and how personal data is used. **Data Processor** means the party that processes it for the Data Fiduciary. A **Data Principal** is the person the data is about.
- **Sub-processor** means a service provider we use that may process Staff data, such as our hosting provider.
- **Personal data breach** means any unauthorised processing of, or accidental disclosure, use, change or loss of, or loss of access to, Staff data that harms its confidentiality, integrity or availability.

## 3. Our roles

- The Restaurant is the **Data Fiduciary** for Staff data. It decides whether to use the staff, attendance, face attendance and salary features, and for which employees.
- ECCS is the Restaurant's **Data Processor**. We process Staff data only to provide those features to the Restaurant.
- These terms do not cover users' login details or our business records with the Restaurant, for which ECCS is the Data Fiduciary under our Privacy Policy.

## 4. The data and the purposes

**Employees concerned:** the Restaurant's employees, including those who have left.

**Data:** name, job title, phone number, joining and leaving dates, pay type, salary or daily wage, overtime rate and weekly day off; clock-in and clock-out times, how each was recorded, flags and corrections; for employees who consent, an encrypted face template; a photo at each clock-in and clock-out; days worked, pay worked out, overtime, bonuses, advances, deductions, payments and balance; face consent records.

**Purposes:** only these:

1. **Attendance:** recording when employees clock in and out, and working out days and hours.
2. **Face attendance:** recognising enrolled employees when they clock in and out, for employees who have consented.
3. **Salary tracking:** keeping a record of pay worked out, overtime, bonuses, advances, payments and balance. The salary tracker is a record book, not payroll; it calculates no PF or ESI and sends no money.

**Duration:** for as long as the Restaurant uses the app, and then as set out in section 12.

## 5. The Restaurant's duties

The Restaurant will:

1. **Have a lawful basis** for all Staff data it enters, such as the legitimate use for employment purposes under section 7(i) of the DPDP Act, or consent.
2. **Tell its employees** what Staff data it records in the app, why, and how they can use their rights, before or when it starts. It may point them to our Privacy Policy for how ECCS handles the data.
3. **Get face consent properly.** Face attendance may be used for an employee only after that employee personally reads and accepts the consent notice in the app, in a language they understand. The Restaurant must not accept it for them, pressure them, or treat them worse in any way, including their job or pay, for refusing or withdrawing. Anyone who refuses or withdraws must be clocked in by an Owner's or Manager's PIN instead.
4. **Act on withdrawal at once.** When an employee withdraws face consent, or leaves, record it in the app straight away, so the face template is deleted.
5. **Not enrol anyone under 18** for face attendance. For any employee under 18, the Restaurant is responsible for complying with labour law and for getting a parent's verifiable consent where the law requires it.
6. **Enter only what is needed.** Do not enter bank or card details, Aadhaar numbers, health information or other data the features do not need.
7. **Keep it accurate** and correct it when asked.
8. **Answer its employees' requests and complaints** about their Staff data, using the app's tools and our help.
9. **Keep records the law requires.** If labour or other law requires the Restaurant to keep attendance or wage records for a period, it is responsible for keeping them, for example by exporting them before deleting data or closing its account.
10. **Give lawful instructions only.** The Restaurant confirms that its instructions to us comply with the law.

## 6. Our duties

We will:

1. **Process Staff data only on the Restaurant's instructions.** These terms, the Terms of Service and the Restaurant's use of the app's settings and features are its instructions. We will tell the Restaurant if we believe an instruction breaks the law.
2. **Not use Staff data for our own purposes.** We do not sell it, use it for advertising, or combine it with other data for any other purpose.
3. **Keep Staff data away from our office.** The app's and console's permissions refuse ECCS's office staff and Supervisors access to Staff data. A small number of named technical staff who run our servers may reach the database only when needed to keep the service running or secure, or when the Restaurant asks for help, and only to the extent necessary.
4. **Keep the processing in India.** We store Staff data on servers in India [to confirm] and do not send face templates or clock-in photos outside India. The text of a push notification about attendance, which may include an employee's name, passes through push notification services that may process it outside India.
5. **Follow the retention periods** in section 12 and in our Privacy Policy: clock-in photos are deleted 35 days after they are taken; a face template is deleted at once when consent is withdrawn, when the employee is recorded as having left, or when the account closes; enrolment photos are never kept.

## 7. Confidentiality of our people

Everyone at ECCS, and every sub-processor, who may have access to Staff data is bound by a written duty of confidentiality that continues after their work for us ends. We give access only to those who need it for the purposes in section 4.

## 8. Security

We keep reasonable security safeguards in place, including:

- encryption of connections between the app and our servers (HTTPS);
- encryption of face templates (AES-256) with a key kept apart from the database, unlocked only in server memory while comparing;
- PINs stored only as keyed hashes;
- role-based access, with ECCS staff refused access to Staff data;
- audit logs recording who changed attendance, face enrolment, staff and salary records, and when;
- locking a phone after repeated wrong PINs.

We review these measures as the service and the law develop. No system is completely secure, and we cannot promise a breach will never happen.

## 9. Sub-processors

- The Restaurant allows us to use sub-processors in these categories: cloud hosting and file storage, and push notification services.
- We will have a written contract with each sub-processor that requires confidentiality and reasonable security, and we remain responsible to the Restaurant for their work.
- The current list is available on request at [grievance email].
- We will give at least 15 days' notice [to confirm] in the app or by email before adding or replacing a sub-processor of Staff data. If the Restaurant objects on reasonable grounds, we will discuss it. If we cannot resolve it, the Restaurant may stop using the staff features or end its Plan, with a refund of unused prepaid fees.

## 10. Helping with employees' rights

- Most requests can be handled by the Restaurant in the app: Staff data can be seen, corrected and deleted, and face consent can be recorded as withdrawn.
- If an employee contacts us directly, we will pass the request to the Restaurant within 3 working days [to confirm] and will not answer it ourselves unless the Restaurant asks us to or the law requires it.
- **One standing instruction:** if an employee asks us directly to withdraw their face consent, the Restaurant instructs us to delete that employee's face template once we have checked who they are, and we will tell the Restaurant. This keeps withdrawal as easy as giving consent, as the DPDP Act requires.
- We will give the Restaurant reasonable help to answer requests and complaints from employees, and from the Data Protection Board of India.

## 11. Personal data breaches

- We will tell the Restaurant about a personal data breach affecting its Staff data without undue delay, and in any case within 24 hours [to confirm] of becoming aware of it, through the Owner's contact details.
- Our first notice will say, as far as we then know, what happened, when, what data and how many employees are affected, the likely consequences, and what we are doing. We will send further details as we learn them, aiming to give a full report within 48 hours [to confirm].
- We will help the Restaurant meet its own duties: from May 2027, the DPDP Rules require a Data Fiduciary to tell affected people and the Board without delay, and to give the Board a detailed report within 72 hours. Our 24-hour target leaves the Restaurant time to do so.
- We will take reasonable steps to contain the breach and prevent it happening again, and, if asked, help prepare the notices to employees.
- Separately, we report cyber incidents to CERT-In within 6 hours, as the law requires of us.

## 12. Deletion or return at the end

- **During use:** when the Restaurant deletes Staff data in the app, we delete it from the live system.
- **At the end:** when the Restaurant's account closes, the Owner can export Staff data for 30 days [to confirm]. We then delete it within 90 days of closure [to confirm]. Face templates are deleted at once when the account closes, and clock-in photos no later than 35 days after they were taken.
- **Backups:** deleted data may remain in backup copies for up to 30 days [to confirm] until they are overwritten.
- **Legal holds:** we keep Staff data longer only if the law requires it, and then only for that purpose.
- **Confirmation:** on request, we will confirm in writing that deletion is complete.

## 13. Records and audits

- We keep records of our processing of Staff data, including face consent records (notice version, language and time) and audit logs of changes to sensitive records.
- On reasonable written request, and not more than once a year unless there has been a breach or a regulator asks, we will give the Restaurant the information reasonably needed to show that we meet these terms.
- If that information is not enough, the Restaurant may audit our compliance, at its own cost, with at least 30 days' notice [to confirm], during business hours, under a confidentiality agreement, and in a way that does not expose other customers' data or our security. We may meet an audit request with written answers or a report by an independent auditor.

## 14. Liability

Each party's liability under these terms is subject to the limits and exclusions in the Terms of Service, including the indemnities there. The Restaurant is responsible for having a lawful basis for Staff data and for its employees' notice and consent. We are responsible for processing Staff data as these terms require.

## 15. Order and changes

If these terms conflict with the Terms of Service on how we handle Staff data, these terms win. We may change these terms as the Terms of Service describe, including by asking the Owner to agree again in the app after a material change.
`;
