import Ionicons from '@expo/vector-icons/Ionicons';
import type { MessageKey } from '@eccs/i18n';
import {
  localize,
  speechTagFor,
  type BuddyCardDto,
  type BuddyMessageDto,
  type BuddyOpenDto,
  type BuddyStarterDto,
  type BuddyState,
} from '@eccs/shared';
import { router, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { BuddyMascot } from '@/components/buddy-mascot';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Notice } from '@/components/ui/notice';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buddyHref, openHref, showsBuddy } from '@/lib/buddy';
import { formatDayLong, formatRupees, formatSlot, formatTime, formatTimeOfDay } from '@/lib/format';
import { shelfLifeText } from '@/lib/labels';
import { readAloud, stopReading, useReadAloudVoice } from '@/lib/read-aloud';
import { useSession } from '@/lib/session';

// The pieces of ECCS Buddy's screen (16 Oct 2026). The pattern, from the research:
// - A confirmation card for every change, specific rather than "Are you sure?" (the service,
//   outlet, day, window and price with GST), with the action's own verb as the main button,
//   Change and Cancel, and a time it runs out (agent-UX "intent preview"; Shopify Sidekick).
// - Short answers with Open buttons to the exact screen (NN/g: less chat, more answer).
// - Under each answer: Read aloud (hidden with no voice for the language), Copy, and thumbs up or
//   down, as ChatGPT and Gemini put them; the thumbs go to ECCS's counts (never the words).

// ───────────────────────── Home's card ─────────────────────────

/**
 * A one-line card on Home that opens Buddy, for the Owner and the Manager only. The app's shared
 * card, filled with its arrow, like the checklist cards above it (22 Oct 2026: it was a box of its
 * own with a dark edge, and its arrow pointed the wrong way in Urdu).
 */
export function BuddyHomeCard() {
  const pathname = usePathname();
  const { t, user } = useSession();
  if (!showsBuddy(user?.memberships)) return null;
  return (
    <Card variant="filled" chevron onPress={() => router.push(buddyHref(pathname))}>
      <View style={styles.homeCard}>
        <BuddyMascot size={36} />
        <View style={styles.flex}>
          <ThemedText type="smallBold">{t('buddy.homeCard.title')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('buddy.homeCard.body')}
          </ThemedText>
        </View>
      </View>
    </Card>
  );
}

// ───────────────────────── Suggested prompts ─────────────────────────

/** The suggested prompts: tapping one sends its words. */
export function Starters({ starters, onPick, disabled, heading = true }: { starters: BuddyStarterDto[]; onPick: (words: string) => void; disabled: boolean; heading?: boolean }) {
  const theme = useTheme();
  const { t } = useSession();
  return (
    <View style={styles.starters}>
      {heading && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('buddy.starters')}
        </ThemedText>
      )}
      {starters.map((starter) => {
        const words = t(`buddy.starter.${starter.key}` as MessageKey, starter.params);
        return (
          <Pressable
            key={starter.key}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => onPick(words)}
            style={({ pressed }) => [styles.starter, { borderColor: theme.outline, backgroundColor: pressed ? theme.backgroundSelected : theme.background }]}>
            <ThemedText type="default" style={styles.flex}>
              {words}
            </ThemedText>
            <Ionicons name="arrow-up-circle-outline" size={22} color={theme.primary} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ───────────────────────── Messages ─────────────────────────

interface MessageProps {
  message: BuddyMessageDto;
  outletId: string | null;
  /** Buddy's latest answer, which shows the thumbs and Read aloud; older ones keep only their buttons. */
  latest: boolean;
  onFeedback: (outcome: 'HELPFUL' | 'NOT_HELPFUL') => void;
  onCardChanged: (card: BuddyCardDto, message: BuddyMessageDto | null) => void;
  onChange: (card: BuddyCardDto) => void;
  doCard: (card: BuddyCardDto) => Promise<{ card: BuddyCardDto; message: BuddyMessageDto | null }>;
  cancelCard: (card: BuddyCardDto) => Promise<BuddyCardDto>;
}

/** One message: the person's on the end side, Buddy's on the start side with its buttons and cards. */
export function Message({ message, outletId, latest, onFeedback, onCardChanged, onChange, doCard, cancelCard }: MessageProps) {
  const theme = useTheme();
  if (message.role === 'USER') {
    return (
      <View style={[styles.bubble, styles.mine, { backgroundColor: theme.primary }]}>
        <ThemedText type="default" selectable style={{ color: theme.onPrimary }}>
          {message.text}
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={styles.answer}>
      <View style={styles.answerHead}>
        <BuddyMascot size={22} />
        <ThemedText type="default" selectable style={styles.flex}>
          {message.text}
        </ThemedText>
      </View>
      {message.cards.map((card) => (
        <CardView key={card.id} card={card} onChanged={onCardChanged} onChange={onChange} doCard={doCard} cancelCard={cancelCard} />
      ))}
      {message.opens.length > 0 && <OpenButtons opens={message.opens} outletId={outletId} />}
      <AnswerActions message={message} latest={latest} onFeedback={onFeedback} />
    </View>
  );
}

/** Open buttons to the app's own screens. */
export function OpenButtons({ opens, outletId }: { opens: BuddyOpenDto[]; outletId: string | null }) {
  const { t } = useSession();
  return (
    <View style={styles.opens}>
      {opens.map((open, index) => (
        <Button
          key={`${open.target}-${index}`}
          variant="secondary"
          icon="open-outline"
          label={t(`buddy.open.${open.target}`)}
          onPress={() => router.push(openHref(open, outletId) as Href)}
        />
      ))}
    </View>
  );
}

/** Read aloud, Copy, and thumbs up or down, under an answer. */
function AnswerActions({ message, latest, onFeedback }: { message: BuddyMessageDto; latest: boolean; onFeedback: (outcome: 'HELPFUL' | 'NOT_HELPFUL') => void }) {
  const theme = useTheme();
  const { t, language } = useSession();
  const voice = useReadAloudVoice(speechTagFor(language));
  const [reading, setReading] = useState(false);
  const [copied, setCopied] = useState(false);
  const web = Platform.OS === 'web';

  async function copy() {
    // In the browser the words go straight to the clipboard; on a phone the share sheet offers Copy
    // (and WhatsApp). Long-pressing the answer also selects it for copying.
    if (web && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(message.text).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      await Share.share({ message: message.text }).catch(() => undefined);
    }
  }

  const icon = (name: React.ComponentProps<typeof Ionicons>['name'], label: string, onPress: () => void, selected = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <Ionicons name={name} size={20} color={selected ? theme.primary : theme.textSecondary} />
    </Pressable>
  );

  return (
    <View style={styles.actions}>
      {voice &&
        (reading
          ? icon('stop-circle-outline', t('buddy.stopReading'), () => {
              stopReading();
              setReading(false);
            })
          : icon('volume-high-outline', t('buddy.readAloud'), () => {
              setReading(true);
              readAloud(message.text, voice, () => setReading(false));
            }))}
      {icon(copied ? 'checkmark' : 'copy-outline', copied ? t('buddy.copied') : web ? t('buddy.copy') : t('buddy.share'), () => void copy())}
      {message.outcome === null && latest ? (
        <>
          {icon('thumbs-up-outline', t('buddy.helpful'), () => onFeedback('HELPFUL'))}
          {icon('thumbs-down-outline', t('buddy.notHelpful'), () => onFeedback('NOT_HELPFUL'))}
        </>
      ) : message.outcome ? (
        <View style={styles.thanks}>
          <Ionicons name={message.outcome === 'HELPFUL' ? 'thumbs-up' : 'thumbs-down'} size={18} color={theme.primary} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('buddy.thanks')}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

// ───────────────────────── The confirmation card ─────────────────────────

interface CardProps {
  card: BuddyCardDto;
  onChanged: (card: BuddyCardDto, message: BuddyMessageDto | null) => void;
  onChange: (card: BuddyCardDto) => void;
  doCard: (card: BuddyCardDto) => Promise<{ card: BuddyCardDto; message: BuddyMessageDto | null }>;
  cancelCard: (card: BuddyCardDto) => Promise<BuddyCardDto>;
}

/**
 * A change Buddy prepared: what will happen, in full, then the action's own button (Book, Add,
 * Save SOP, Send), Change and Cancel. Nothing happens until the main button is tapped; it works
 * once, before the time shown.
 */
function CardView({ card, onChanged, onChange, doCard, cancelCard }: CardProps) {
  const theme = useTheme();
  const { t, language } = useSession();
  const [busy, setBusy] = useState<'do' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = card.details;
  const live = (card.status === 'PENDING' || card.status === 'FAILED') && !card.expired;

  async function run(what: 'do' | 'cancel') {
    setBusy(what);
    setError(null);
    try {
      if (what === 'do') {
        const done = await doCard(card);
        onChanged(done.card, done.message);
      } else {
        onChanged(await cancelCard(card), null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const row = (label: string, value: ReactNode) => (
    <View style={styles.row} key={label}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
        {label}
      </ThemedText>
      {typeof value === 'string' ? (
        <ThemedText type="default" style={styles.flex}>
          {value}
        </ThemedText>
      ) : (
        <View style={styles.flex}>{value}</View>
      )}
    </View>
  );
  const when = (date: string, slot: string | null) => [formatDayLong(date, language), formatSlot(slot, language, t)].filter(Boolean).join(' · ');
  const time = (value: string | null) => (value ? formatTime(value, language) : t('buddy.card.noDueTime'));

  const rows: ReactNode[] = [row(t('buddy.card.outlet'), d.outletName)];
  let note: string | null = null;
  switch (d.action) {
    case 'BOOK':
      rows.push(row(t('buddy.card.service'), localize(d.serviceName, language)));
      rows.push(row(t('buddy.card.when'), when(d.date, d.slot)));
      rows.push(row(t('buddy.card.price'), t('buddy.card.priceLine', { price: formatRupees(d.pricePaise, language), gst: formatRupees(d.gstPaise, language), total: formatRupees(d.totalPaise, language) })));
      if (d.notes) rows.push(row(t('buddy.card.notes'), d.notes));
      note = `${t(`buddy.card.plan.${d.plan}`)} ${t('buddy.card.bookConfirm')}`;
      break;
    case 'CANCEL_BOOKING':
      rows.push(row(t('buddy.card.service'), localize(d.serviceName, language)));
      rows.push(row(t('buddy.card.when'), when(d.date, d.slot)));
      break;
    case 'ADD_CHECKLIST_ITEM':
      rows.push(row(t('buddy.card.checklist'), localize(d.checklistTitle, language)));
      rows.push(row(t('buddy.card.check'), d.label));
      rows.push(row(t('buddy.card.proof'), d.photoRequired ? t('setup.photoNeeded') : t('setup.tickOnly')));
      break;
    case 'ADD_CHECKLIST':
      rows.push(row(t('buddy.card.name'), d.title));
      rows.push(row(t('buddy.card.dueTime'), time(d.dueTime)));
      break;
    case 'CHECKLIST_DUE_TIME':
      rows.push(row(t('buddy.card.checklist'), localize(d.checklistTitle, language)));
      rows.push(row(t('buddy.card.dueTime'), `${time(d.from)} → ${time(d.to)}`));
      break;
    case 'SAVE_SOP':
      rows.push(row(t('buddy.card.name'), d.title));
      rows.push(row(t('buddy.card.category'), t(`sopCategory.${d.category}`)));
      if (d.replaces) note = t('buddy.card.replaces', { title: d.replaces });
      rows.push(
        row(
          t('buddy.card.steps'),
          <View style={styles.steps}>
            {d.steps.map((step, index) => (
              <ThemedText key={index} type="default">
                {`${index + 1}. ${step}`}
              </ThemedText>
            ))}
          </View>,
        ),
      );
      break;
    case 'ADD_FOOD_LABEL':
      rows.push(row(t('buddy.card.name'), d.name));
      rows.push(row(t('buddy.card.keeps'), shelfLifeText(d.shelfLifeHours, t)));
      break;
    case 'REPORT_ISSUE':
      rows.push(row(t('buddy.card.category'), t(`category.${d.category}`)));
      rows.push(row(t('buddy.card.message'), d.description));
      break;
    case 'ASK_ECCS':
      rows.push(row(t('buddy.card.message'), d.description));
      break;
  }
  const title = d.action === 'SAVE_SOP' && d.replaces ? t('buddy.card.SAVE_SOP.titleChange') : t(`buddy.card.${card.action}.title`);

  return (
    <View style={[styles.card, { borderColor: live ? theme.primary : theme.outline, backgroundColor: theme.background }]} accessibilityRole="summary">
      <View style={styles.cardHead}>
        <Ionicons name={card.status === 'DONE' ? 'checkmark-circle' : 'create-outline'} size={20} color={card.status === 'DONE' ? theme.primary : theme.text} />
        <ThemedText type="smallBold" style={styles.flex}>
          {card.status === 'DONE' ? t('buddy.card.done') : title}
        </ThemedText>
      </View>
      {rows}
      {note && (
        <ThemedText type="small" themeColor="textSecondary">
          {note}
        </ThemedText>
      )}

      {/* A done card has no Open button of its own: the "Done" message under it carries it. */}
      {card.status === 'CANCELLED' && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('buddy.card.cancelled')}
        </ThemedText>
      )}
      {card.expired && card.status !== 'DONE' && card.status !== 'CANCELLED' && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('buddy.card.expired')}
        </ThemedText>
      )}
      {live && (
        <>
          {card.status === 'FAILED' && card.error && <ErrorText message={t('buddy.card.failed', { reason: card.error })} />}
          <ErrorText message={error} />
          <Button
            icon="checkmark"
            label={card.status === 'FAILED' ? t('buddy.card.tryAgain') : t(`buddy.card.${card.action}.do`)}
            loading={busy === 'do'}
            disabled={busy !== null}
            onPress={() => void run('do')}
          />
          <View style={styles.cardButtons}>
            <Button fill variant="secondary" icon="create-outline" label={t('buddy.card.change')} disabled={busy !== null} onPress={() => onChange(card)} />
            <Button fill variant="secondary" label={t('common.cancel')} loading={busy === 'cancel'} disabled={busy !== null} onPress={() => void run('cancel')} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t('buddy.card.runsOut', { time: formatTimeOfDay(card.expiresAt, language) })}
          </ThemedText>
        </>
      )}
    </View>
  );
}

// ───────────────────────── When Buddy cannot answer ─────────────────────────

/** Where to do it in the app, when Buddy is off or over its limit. */
const FALLBACK_SCREENS: BuddyOpenDto[] = [
  { target: 'book_service', params: {} },
  { target: 'checklists', params: {} },
  { target: 'sops', params: {} },
  { target: 'support', params: {} },
];

/**
 * One line saying why Buddy cannot answer now, and what the notice offers: the app's own screens when Buddy is off, over a limit or paused; a few
 * suggested prompts with the out-of-scope line; a New chat button when the chat is full.
 */
interface StateNoticeProps {
  state: Exclude<BuddyState, 'ON'> | 'FAILED';
  dailyMessages: number;
  outletId: string | null;
  starters?: BuddyStarterDto[];
  onPick?: (words: string) => void;
  onNewChat?: () => void;
}

export function StateNotice({ state, dailyMessages, outletId, starters, onPick, onNewChat }: StateNoticeProps) {
  const { t } = useSession();
  const line = state === 'PERSON_LIMIT' ? t('buddy.state.PERSON_LIMIT', { count: dailyMessages }) : t(`buddy.state.${state}`);
  const screens = state === 'OFF' || state === 'LIMIT' || state === 'PERSON_LIMIT' || state === 'PAUSED';
  return (
    // The app's one notice box (22 Oct 2026): a question Buddy does not take is information; the rest
    // (off, over a limit, failed) are warnings.
    <Notice tone={state === 'OUT_OF_SCOPE' ? 'info' : 'warning'} text={line}>
      {screens && <OpenButtons opens={FALLBACK_SCREENS} outletId={outletId} />}
      {/* The line itself ends "Try one of these:", so the list has no heading of its own. */}
      {state === 'OUT_OF_SCOPE' && starters && onPick && starters.length > 0 && <Starters starters={starters} onPick={onPick} disabled={false} heading={false} />}
      {state === 'CHAT_FULL' && onNewChat && <Button icon="create-outline" label={t('buddy.newChat')} onPress={onNewChat} />}
    </Notice>
  );
}

// ───────────────────────── The mic while it listens ─────────────────────────

/**
 * The listening state, unmistakable: a red dot and "Listening… speak now", a bar that moves with
 * the voice, the language being heard (tap to change it), and Stop and Cancel. Stop keeps the
 * words in the box; Cancel puts the box back as it was.
 */
export function ListeningBar({ level, languageName, onLanguage, onStop, onCancel }: { level: number; languageName: string; onLanguage: () => void; onStop: () => void; onCancel: () => void }) {
  const theme = useTheme();
  const { t } = useSession();
  return (
    <View style={[styles.listening, { borderColor: theme.danger, backgroundColor: theme.backgroundElement }]} accessibilityLiveRegion="polite">
      <View style={styles.answerHead}>
        <View style={[styles.dot, { backgroundColor: theme.danger }]} />
        <ThemedText type="smallBold" style={styles.flex}>
          {t('buddy.mic.listening')}
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={onLanguage} style={styles.languageChip} hitSlop={6}>
          <Ionicons name="language-outline" size={18} color={theme.primary} />
          <ThemedText type="small" themeColor="primary">
            {t('buddy.mic.language', { language: languageName })}
          </ThemedText>
        </Pressable>
      </View>
      <View style={[styles.meter, { backgroundColor: theme.border }]}>
        <View style={[styles.meterFill, { backgroundColor: theme.danger, width: `${Math.round(10 + level * 90)}%` }]} />
      </View>
      <View style={styles.cardButtons}>
        <Button fill icon="stop" label={t('buddy.mic.stop')} onPress={onStop} />
        <Button fill variant="secondary" label={t('common.cancel')} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  homeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  starters: { gap: Spacing.two },
  starter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, minHeight: MinTouchSize },
  bubble: { maxWidth: '85%', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  mine: { alignSelf: 'flex-end', borderBottomEndRadius: Spacing.one },
  answer: { gap: Spacing.two, alignSelf: 'stretch' },
  answerHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  opens: { gap: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  action: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  thanks: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingStart: Spacing.two },
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  rowLabel: { width: 92, paddingTop: 2 },
  steps: { gap: Spacing.one },
  cardButtons: { flexDirection: 'row', gap: Spacing.two },
  listening: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  languageChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half, minHeight: 32 },
  meter: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3 },
});
