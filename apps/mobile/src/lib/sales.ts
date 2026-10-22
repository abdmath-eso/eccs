import type { LanguageCode, Translator } from '@eccs/i18n';
import type {
  DoTodayItemDto,
  LeadActivityDto,
  LeadDetailDto,
  LeadInput,
  LeadRowDto,
  LeadUpdateInput,
  StaleDto,
  StepInput,
} from '@eccs/shared';
import { Linking } from 'react-native';

import { addDays, formatDayShort, formatRupees, formatTime, formatTimeOfDay, indiaToday } from './format';
import { newId } from './offline/files';
import { outbox } from './offline/outbox';

// The BDE's leads on the phone (B2, 16 Oct 2026): the words for what the server sends
// (stages, to-dos, the timeline), in the BDE's own language, and the one way every step
// is saved: into the outbox first, so it is never lost without signal, with the lead's,
// the step's and the photo's ids and the time it was done chosen here on the phone.
// The server's rules decide everything else (packages/shared/src/sales.ts).

// ───────────────────────── Words ─────────────────────────

/** The India date of a moment. */
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** "today", "yesterday", "tomorrow" or "Thu, 8 Oct". */
export function dayWords(date: string, t: Translator, language: LanguageCode): string {
  const today = indiaToday();
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return t('bde.when.today');
  if (diff === -1) return t('bde.when.yesterday');
  if (diff === 1) return t('bde.when.tomorrow');
  return formatDayShort(date, language);
}

/** A moment as "today, 4:10 pm" or "Thu, 8 Oct, 4:10 pm". */
export const momentWords = (iso: string, t: Translator, language: LanguageCode) => `${dayWords(dayOf(iso), t, language)}, ${formatTimeOfDay(iso, language)}`;

/** The day a number of days ago, in words: how lateness is said without counting ("since Tue, 14 Oct"), so no language needs plurals. */
const daysAgo = (days: number, t: Translator, language: LanguageCode) => dayWords(addDays(indiaToday(), -Math.max(0, days)), t, language);

/** When a to-do is due: its time, "By 6 pm", or since when it is late. */
export function todoWhen(item: DoTodayItemDto, t: Translator, language: LanguageCode): string {
  if (item.bucket === 'OVERDUE') return t('bde.todo.late', { day: daysAgo(item.days ?? 1, t, language) });
  return item.time ? formatTime(item.time, language) : t('bde.todo.byEndOfDay');
}

/** A to-do's reason in one short line, from the facts the server sends with it. */
export function todoLine(item: DoTodayItemDto, t: Translator, language: LanguageCode): string {
  const p = item.params ?? {};
  // A recent day, short: "yesterday", "Tue, 13 Oct" (the year only clutters a to-do).
  const date = (value: string | undefined) => (value ? dayWords(value, t, language) : '');
  switch (item.kind) {
    case 'PARKED_DUE':
      return p.reason ? t('bde.todo.PARKED_DUE', { date: date(p.parkedOn), reason: p.reason }) : t('bde.todo.PARKED_DUE.noReason', { date: date(p.until) });
    case 'NEXT_ACTION_OVERDUE':
      return p.nextAction ? t('bde.todo.NEXT_ACTION_OVERDUE', { action: p.nextAction, day: p.dueOn ? dayWords(p.dueOn, t, language) : '' }) : t('bde.todo.NEXT_ACTION_OVERDUE.plain', { day: p.dueOn ? dayWords(p.dueOn, t, language) : '' });
    case 'QUOTE_NO_REPLY':
      return t('bde.todo.QUOTE_NO_REPLY', { amount: formatRupees(p.totalPaise ?? 0, language), date: date(p.sentOn) });
    case 'QUOTE_NOT_OPENED':
      return t('bde.todo.QUOTE_NOT_OPENED', { amount: formatRupees(p.totalPaise ?? 0, language), date: date(p.sentOn) });
    case 'CHECK_TODAY':
      return p.checkWith ? t('bde.todo.CHECK_TODAY', { name: p.checkWith }) : t('bde.todo.CHECK_TODAY.alone');
    case 'QUOTE_NOT_SENT':
      return t('bde.todo.QUOTE_NOT_SENT', { date: date(p.doneOn) });
    case 'OFFER_PLAN':
      return p.plan ? t('bde.todo.OFFER_PLAN', { date: date(p.doneOn), plan: p.plan }) : t('bde.todo.OFFER_PLAN.any', { date: date(p.doneOn) });
    case 'DAY10_CALL':
      return t('bde.todo.DAY10_CALL');
    case 'PITCH_MORE':
      return t('bde.todo.PITCH_MORE', { count: p.more ?? 1, onPlan: p.onPlan ?? 1 });
    case 'NEXT_ACTION_TODAY':
      return p.nextAction ?? t('bde.todo.NEXT_ACTION_TODAY');
  }
}

/** Why a lead is waiting ("rotting"), in words, with the day it has been waiting since. */
export const staleWords = (stale: StaleDto, t: Translator, language: LanguageCode) => t(`bde.stale.${stale.reason}`, { day: daysAgo(stale.days, t, language) });

/** The lead's next step and when: "Call back · Fri, 18 Oct, 10:00 am". */
export function nextStepWords(lead: Pick<LeadRowDto, 'nextAction' | 'nextActionAt'>, t: Translator, language: LanguageCode): string | null {
  if (!lead.nextAction && !lead.nextActionAt) return null;
  const what = lead.nextAction && lead.nextAction !== 'Next step' ? lead.nextAction : t('bde.next.generic');
  return lead.nextActionAt ? `${what} · ${momentWords(lead.nextActionAt, t, language)}` : what;
}

/** What happened on a lead, in a few words, as its timeline shows it. */
export function activityWords(entry: LeadActivityDto, t: Translator, language: LanguageCode): string {
  switch (entry.kind) {
    case 'CHECK_BOOKED':
      return entry.checkAt
        ? t(entry.checkWith ? 'bde.activity.CHECK_BOOKED.with' : 'bde.activity.CHECK_BOOKED.at', { when: momentWords(entry.checkAt, t, language), name: entry.checkWith ?? '' })
        : t('bde.activity.CHECK_BOOKED');
    case 'CHECK_DONE':
      return t('bde.activity.CHECK_DONE', { count: entry.findings ?? 0 });
    case 'QUOTE_SENT':
      return entry.amountPaise ? t('bde.activity.QUOTE_SENT.amount', { amount: formatRupees(entry.amountPaise, language) }) : t('bde.activity.QUOTE_SENT');
    case 'WON':
      return t(entry.toStage === 'ON_PLAN' ? 'bde.activity.WON.plan' : 'bde.activity.WON');
    case 'ASKED':
      return t(entry.signal === 'MONTHLY_PRICE' ? 'bde.activity.ASKED.monthly' : 'bde.activity.ASKED');
    default:
      return t(`bde.activity.${entry.kind}`);
  }
}

// ───────────────────────── Saving, through the outbox ─────────────────────────

const now = () => new Date().toISOString();

/** A lead logged on this phone, with its board photo (if not already sent) and the first note. */
export async function queueNewLead(input: LeadInput & { id: string }, extra: { photoToSend?: { id: string; capturedAt: string }; note?: string }) {
  if (extra.photoToSend) {
    await outbox.enqueue({ subject: 'lead', subjectId: input.id, kind: 'leadPhoto', photoId: extra.photoToSend.id, capturedAt: extra.photoToSend.capturedAt });
  }
  // The time it was logged here goes with it, so it counts on that day however late it arrives.
  await outbox.enqueue({ subject: 'lead', subjectId: input.id, kind: 'leadCreate', input: { ...input, at: input.at ?? now() } });
  if (extra.note?.trim()) await queueStep(input.id, { kind: 'NOTE', note: extra.note.trim() });
}

/** A step on a lead: a call, a visit, a note, a free check booked or done. Returns the step's id. */
export async function queueStep(leadId: string, input: Omit<StepInput, 'id' | 'at'>, photos: { id: string; capturedAt: string }[] = []): Promise<string> {
  for (const photo of photos) await outbox.enqueue({ subject: 'lead', subjectId: leadId, kind: 'leadPhoto', photoId: photo.id, capturedAt: photo.capturedAt });
  const id = newId();
  await outbox.enqueue({ subject: 'lead', subjectId: leadId, kind: 'leadStep', input: { ...input, id, at: now() } });
  return id;
}

export const queueUpdate = (leadId: string, changes: LeadUpdateInput) => outbox.enqueue({ subject: 'lead', subjectId: leadId, kind: 'leadUpdate', changes });

export const queuePark = (leadId: string, until: string, reason: string) =>
  outbox.enqueue({ subject: 'lead', subjectId: leadId, kind: 'leadPark', input: { id: newId(), at: now(), until, reason } });

export const queueLose = (leadId: string, reason: string) => outbox.enqueue({ subject: 'lead', subjectId: leadId, kind: 'leadLose', input: { id: newId(), at: now(), reason } });

/**
 * Call: logs the call on the lead and opens the phone's dialler with the number ("the
 * phone comes from the call"), as Pipedrive's app logs a call made from it. A sample
 * lead's made-up number is never dialled.
 */
export async function callLead(lead: Pick<LeadDetailDto, 'id' | 'contactPhone' | 'isSample'>) {
  await queueStep(lead.id, { kind: 'CALL' });
  if (lead.contactPhone && !lead.isSample) await Linking.openURL(`tel:${lead.contactPhone}`).catch(() => undefined);
}
