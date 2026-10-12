# ECCS: where AI (the Claude API) fits in the app

Written 12 October 2026 for the founder. Nothing in this report is built. It lists every place in the app and the office console where a language model that can read text, photos and PDFs could help, in the order I would build them, with what each costs and what can go wrong.

**The short version**

- The strongest uses are the unglamorous ones: **reading a document into a form, translating what people type, nudging at the camera when a proof photo is unusable, drafting the inspection write-up, and a daily summary of which outlets need attention.** Comparable products already ship all five, and in each a person confirms the result.
- **AI should suggest and flag, never decide.** It should not change the hygiene score, an inspection mark, attendance or pay, and it should not be the judge of whether a kitchen is clean. No vendor publishes an error rate for "AI verifies cleanliness", and regulators' advisers warn it gives a false sense of security.
- **Cost is small.** On the cheapest current model a proof photo costs about ₹0.016 to check; 20 outlets sending 12,000 photos a month is about ₹190. Everything in the first two groups below, switched on for a 20-outlet pilot, comes to a few hundred rupees a month.
- **The API key lives on the server, never in the phone app.**
- **Face attendance stays as it is.** Anthropic's documentation says Claude cannot be used to name people in images and refuses to.

Notes behind this report: `research_notes/AI in the app/products-and-patterns.md` (not in git). Prices and limits were read on Anthropic's own pages on 12 October 2026; the links are at the end.

---

## 1. What the Claude API can and cannot do

| | |
|---|---|
| **Takes in** | Text, photos (JPEG, PNG, GIF, WebP) and PDFs. Several photos in one request, so "before and after" or "this photo against a reference photo" works. |
| **Does not take in** | Audio. A voice feature needs a separate speech-to-text service first. |
| **Gives back** | Text, or data in a fixed shape (for example `number`, `issuedOn`, `expiresOn`), which is what a form needs. |
| **Will not do** | Name a person from a photo. It also cannot tell whether a photo is genuine, recent or AI-made, and it receives none of a photo's hidden data (time, place), so those checks stay in our own code, where photo integrity already does them. |
| **Is weak at** | Rotated, blurred or tiny images; counting many small things; reading dial gauges; handwriting; fine judgements such as a thin film of grease. |
| **Languages** | Anthropic says all current models are multilingual but publishes no figures for the eleven Indian languages in the app. The translations in the app today were made by Claude and checked by script, not by native speakers. |

### The models and their prices

Prices are in US dollars per million "tokens" (a token is a little over half an English word on the current models; a 1000 × 750 photo is about 970 tokens).

| Model | In | Out | Use it for |
|---|---|---|---|
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 | $0.50 | High-volume, simple work: translating a line, a first look at a photo, sorting a support message. |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 | $10 | Reading documents, judging a photo that the cheap model was unsure of, digests. |
| Claude Opus 5.5 (`claude-opus-5-5`) | $4 | $20 | The inspection write-up and anything that needs careful reasoning. |
| Claude Fable 5.1 (`claude-fable-5-1`) | $10 | $50 | Not needed here. It also cannot be used under a zero-retention agreement. |

- **Work that can wait is half price** through the Batch API: the requests are handed over together and the answers come back later rather than at once.
- **Repeated instructions are cheaper** through prompt caching: text that is the same on every request, such as the long instruction or the checklist library, is charged at 5 to 10% on re-use.
- **Billing is prepaid.** Credits are bought in Anthropic's console in US dollars, with an optional automatic top-up.

### What it costs for ECCS

My arithmetic from the list prices above, at ₹88 to the dollar. The sizes are assumptions; Indian-language text uses more tokens than English, so treat these as rough.

| Use | Assumed size | Cheapest model | Stronger model |
|---|---|---|---|
| Check one proof photo | 1000 × 750 photo, short instruction, one-line answer | ₹0.016 (Haiku) | ₹0.31 (Sonnet) |
| Read one licence photo | 2000 × 1500 photo, fields back | ₹0.05 (Haiku) | ₹0.93 (Sonnet) |
| Translate one typed line into 11 languages | one sentence | ₹0.03 (Haiku) | |
| Draft one inspection write-up | 92 checks with notes in, a page out | | ₹1.40 (Sonnet), ₹2.80 (Opus) |
| One outlet's overnight digest | a day's records in, a paragraph out, half price overnight | | ₹0.44 (Sonnet) |

For a 20-outlet pilot: 12,000 proof photos a month is about ₹190 on Haiku or ₹3,700 on Sonnet; digests about ₹260; documents, translation and inspections together a few tens of rupees.

### What happens to the data

- Anthropic states that retained data is **never used for model training** without express permission.
- What is sent and what comes back is **deleted within 30 days** by default, under Anthropic's commercial data retention policy. Exceptions it lists: anything flagged as breaking its usage policy (kept up to two years), features that store files at our request, and legal requirements. A formal "zero data retention" agreement, where nothing is kept after the reply, exists but is arranged through Anthropic's sales team.
- The data **leaves India**: the first-party API runs in the US or globally. Claude is also sold through Amazon and Google, which have more regions; whether either offers it from an Indian region was not confirmed.
- So: restaurants must be told (privacy policy and the ECCS contract), and a lawyer should confirm the position on sending personal data abroad. Do not send face photos, clock-in photos, salaries or phone numbers. Staff medical certificates are health information; leave them out, or get the person's agreement first.

---

## 2. Where it fits, in the order I would build it

"Confirm" means a person must approve before the result counts.

### Build first: proven elsewhere, cheap, and a person confirms

| # | Use | Where in the app | In → out | Confirm? | Main risk |
|---|---|---|---|---|---|
| 1 | **Read any document into the vault form** | Licences and documents. The app already reads licences with a free reader that handles only clear English print; the code has a switch (`LICENCE_READER`) left for an AI reader. | Photo or PDF of an FSSAI licence, trade licence, fire NOC, pest-control report, water test → type, number, issue and expiry dates, "could not read" per field | Always, with the picture beside the fields | A wrong expiry date sets a wrong reminder. Dates and handwriting are the weak fields. |
| 2 | **Translate what people type** | Support threads (ECCS writes English, the kitchen reads Telugu or Hindi, and back); an Owner's own checklist items, SOPs and label names; and, at build time, new app text, which today I translate by hand each time. | Text → the reader's language, with the original always kept and a "translated" mark | No for chat; spot-check for standing content | A wrong chemical, quantity or temperature in one language. |
| 3 | **A nudge at the camera, and flags for review** | Daily checklists, visits, inspections. Sits beside photo integrity. | Photo + the wording of the check → "blurred / too dark / not the thing asked for: retake?" at once; and "something to look at" for the office board | Nudge only. The person can still submit; a person judges every flag. | False "looks fine" on a dirty surface; false alarm from an odd angle; staff feeling policed. |
| 4 | **Draft the inspection and visit write-up** | Supervisor's inspection and its PDF report. | The 92 scores, notes and photos → findings, the five things to fix first, and a plain summary in the Owner's language | The Supervisor edits and signs. The scores stay human. | An invented finding in a signed report. |
| 5 | **Daily digest and "explain my score"** | Office monitoring board; Owner's Home. | A day's or week's records → "these outlets need attention, and why" for the office; three sentences for the Owner on what pulled the score down and what to do | Read-only. Numbers come from the database, the model writes only the words. | A sentence that contradicts the number. |

### Build next

| # | Use | Where | In → out | Confirm? | Main risk |
|---|---|---|---|---|---|
| 6 | **Bring in a restaurant's own SOPs and checklists; suggest a starting set** | SOP library; checklist set-up; onboarding. | A photo or PDF of a paper SOP, or the kitchen type → numbered steps and suggested checks picked from the 588-item library | Yes, edit before saving | Plausible but wrong steps. |
| 7 | **Photo of a pest or problem → the right service and how urgent** | Raising an issue; booking a service. | Photo and a few words → likely problem, suggested service, urgency | The person picks; ECCS confirms | Wrong identification; under-rating urgency. |
| 8 | **Sort and summarise support for the office** | Console issues list. | A thread → category, urgency, a suggested reply, a summary of a long thread | The admin sends | Mis-rated urgency. |
| 9 | **Ask-the-SOP helper** | SOP library. | A question → an answer taken only from ECCS's own SOPs, with the SOP linked, or "I don't know, ask ECCS" | No, so it must be able to refuse | Invented safety advice. |
| 10 | **Match a typed food name to ECCS's shelf-life table** | Food labels. | "paneer tikka marination" → the row "Marinated paneer" in our own table | Yes | The model must never supply a shelf life or an allergen from its own memory. |

### Later, or to try carefully

| # | Use | Why later |
|---|---|---|
| 11 | **Speak a problem; hear the answer** | Needs a speech service as well (Sarvam lists about ₹30 an hour; Bhashini is the government's). In one field test the best system got about one Telugu word in three wrong, against one in six for Hindi, and kitchens are noisy. Always play back what was understood before saving. |
| 12 | **"Ask about my kitchen" chat** for the Owner, and "ask the data" for the office | Useful (Toast and Swiggy ship it), but every answer must quote the rows it came from. |
| 13 | **Read a thermometer's display from a photo** into a temperature log | Digital displays only, about 80% right at best in a published test; dial gauges about 30%. Confirm every reading. |
| 14 | **Before and after photos → a drafted service report; a quote from site-visit notes** | Saves the technician and sales time; low volume now. |
| 15 | **Explain a month's pay in plain words** | Wording only; the sum stays the app's. |
| 16 | **Booking and reminders by WhatsApp chat** | Low volume at 15 to 20 outlets; needs the WhatsApp registration first. |

---

## 3. Where AI should not be used

- **Recognising faces for attendance.** Not what Claude is for, and it refuses.
- **Working out or changing the hygiene score, an inspection mark, attendance or pay.** These must stay sums a person can check.
- **Failing a task automatically from a photo, or judging "clean" or "sanitised".**
- **Stating shelf lives, allergens or legal requirements from its own memory.** New York City's business chatbot told restaurants they could serve cheese a rat had bitten; it was shut down in 2026.
- **Deciding whether a photo is genuine or recent.**
- **Writing the consent notice, or anything shown to diners as a claim about the kitchen.**

---

## 4. How it would be built

- **The key stays on the server.** An app file can be unpacked and the key copied, and whoever has it spends ECCS's money. The phone asks our server; our server asks Claude. The founder creates the key in Anthropic's console and puts it in the server's `.env` as `ANTHROPIC_API_KEY`.
- **One small "AI" part in the server** that every feature goes through, using Anthropic's official library (`@anthropic-ai/sdk`). It holds: one switch to turn all AI off; a daily spending limit per outlet; a record of every request (which feature, which model, how much it cost, whether the person accepted or changed the result); and a pretend version for the automated tests, as face attendance has.
- **Answers come back in a fixed shape**, so a form can be filled without guessing, and "could not read" is an allowed answer for every field.
- **Start with the cheap model and step up only when it is unsure.**
- **Measure before trusting.** Before the photo check is switched on, run it on a few hundred real ECCS photos that a Supervisor has marked, and count how often it is wrong each way.
- **Every screen shows the original** (the document, the photo, the typed text) beside what the AI made of it.

**A sensible first step:** the shared AI part, with the document reader (1) and translation of support threads (2). Both are low risk, both fill a gap the app has today, and together they would cost a few rupees a month at pilot scale. Then measure the photo nudge (3) on real photos before deciding whether to switch it on.

---

## 5. What was not confirmed

- Any independent accuracy figure for photo checking by Xenia, Crunchtime, Operandio or others. Their own material calls it assistive.
- How well Claude reads FSSAI or trade licences, lab reports or handwritten certificates specifically; the evidence is from neighbouring document types.
- Translation quality in the eleven Indian languages; Anthropic publishes no figures and no native speaker has read the app's translations.
- Whether Claude is offered from an Indian region through Amazon or Google.
- FSSAI's position on AI-generated food-safety records: nothing found either way.
- Whether Indian businesses face any restriction or tax step when buying API credits; Anthropic's pages state only that prices are in US dollars.

## Sources

Anthropic (read 12 October 2026):
- [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) and [Pricing](https://platform.claude.com/docs/en/about-claude/pricing): models, prices, batch discount, caching.
- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision): image formats, limits, how a photo is charged, and the stated limitations, including that Claude cannot be used to name people in images.
- [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention): no training without permission, zero data retention, the 30-day requirement on Fable.
- [How long do you store my organization's data?](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data): deletion within 30 days and the exceptions.
- [How do I pay for my Claude API usage?](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage): prepaid credits and auto-reload.

Comparable products:
- [Crunchtime Photo Intelligence](https://www.crunchtime.com/blog/introducing-photo-intelligence-how-operators-spot-issues-before-they-spread)
- [Xenia AI](https://xenia.team/ai) and [visual compliance](https://www.xenia.team/articles/visual-compliance)
- [Mitti (formerly SafetyCulture) AI features](https://smartcompany.com.au/startupsmart/safetyculture-becomes-mitti-ai-features-insurance-focus/)
- [Taqtile AI Verify: set-up and best practices](https://docs.taqtile.com/ai-verify-setup-and-best-practices)
- [Toast IQ](https://pos.toasttab.com/blog/on-the-line/toast-iq)
- [Swiggy Guru](https://www.businesstoday.in/latest/trends/story/meet-swiggys-new-ai-assistant-guru-that-helps-restaurants-manage-business-from-one-chat-549634-2026-08-17)

Evidence and cautions:
- [ASHABot study, WhatsApp health-worker assistant in Rajasthan](https://arxiv.org/html/2409.10913v3)
- [Speech recognition on real farmer recordings, Hindi and Telugu](https://arxiv.org/html/2602.03868v2)
- [Field extraction from Indian government documents (Parichay)](https://arxiv.org/html/2602.16430)
- [Reading instruments from photos (MeasureBench)](https://arxiv.org/html/2510.26865v1)
- [New York City's business chatbot shut down](https://themarkup.org/artificial-intelligence/2026/01/30/mamdani-to-kill-the-nyc-ai-chatbot-we-caught-telling-businesses-to-break-the-law)
- [Can AI write your HACCP plan?](https://meatingplace.com/can-ai-write-your-haccp-plan-yes-should-you-rely-on-it-not-so-fast/)
- [UK Food Standards Agency Science Council, AI in food safety](https://www.gov.uk/government/publications/project-artificial-intelligence-applications)
- [Sarvam price list](https://docs.sarvam.ai/api-reference-docs/pricing)
