import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '@eccs/api-client';
import { LANGUAGE_NAMES, type LanguageCode, type MessageKey } from '@eccs/i18n';
import {
  BUDDY_RULES,
  speechChoices,
  speechLocaleSupported,
  speechTagFor,
  type BuddyCardDto,
  type BuddyMessageDto,
  type BuddyScreen,
  type BuddyStarterDto,
  type BuddyStartDto,
  type BuddyState,
  type Language,
} from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BuddyMascot } from '@/components/buddy-mascot';
import { ListeningBar, Message, Starters, StateNotice } from '@/components/buddy-parts';
import { ThemedText } from '@/components/themed-text';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Expandable } from '@/components/ui/expandable';
import { OptionSheet } from '@/components/ui/option-sheet';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { showsBuddy } from '@/lib/buddy';
import { useDirection } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { askForMic, micAllowed, speechAvailability, supportedSpeechLocales, useDictation, type DictationProblem } from '@/lib/speech';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

/** Shown under the box once this few messages are left today. */
const FEW_LEFT = 5;

/**
 * ECCS Buddy, the AI helper (16 Oct 2026), for the Owner and the Manager. Opened from the Buddy
 * button at the top of a screen (so the suggested prompts fit that screen), the card on Home or the
 * More menu. Main part first, as the founder asks: the welcome is two lines and the suggested
 * prompts; what Buddy can and cannot do is folded away. The box is pinned at the bottom with the
 * mic and Send. Every change Buddy prepares comes as a card that does nothing until tapped.
 */
export default function BuddyChatScreen() {
  const theme = useTheme();
  const { isRtl } = useDirection();
  const { t, api, user, language } = useSession();
  const params = useLocalSearchParams<{ screen?: string; chatId?: string }>();
  const screen = (params.screen ?? 'other') as BuddyScreen;
  const { outletId, outlets, choose } = useOutlet();

  const [start, setStart] = useState<BuddyStartDto | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(params.chatId ?? null);
  const [chatOutletId, setChatOutletId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BuddyMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<Exclude<BuddyState, 'ON'> | 'FAILED' | null>(null);
  const [offline, setOffline] = useState(false);
  const [messagesLeft, setMessagesLeft] = useState<number | null>(null);
  /** Offered with the out-of-scope line: things Buddy can help with instead. */
  const [scopeStarters, setScopeStarters] = useState<BuddyStarterDto[]>([]);
  const [attempt, setAttempt] = useState(0);

  // The mic: dictation into the box, never sent by itself.
  const [speakAs, setSpeakAs] = useState<Language>(language as Language);
  const [chooseSpeech, setChooseSpeech] = useState(false);
  const [askMic, setAskMic] = useState(false);
  const [micProblem, setMicProblem] = useState<DictationProblem | 'expoGo' | 'none' | null>(null);
  const [locales, setLocales] = useState<string[]>([]);
  const before = useRef('');
  const dictation = useDictation((heard) => setDraft(before.current ? `${before.current} ${heard}` : heard));

  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);

  const allowed = showsBuddy(user?.memberships);
  const viewOutletId = chatOutletId ?? outletId;

  // What Buddy can do now, and the suggested prompts, for this screen and outlet.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    api.buddy
      .start(screen, viewOutletId)
      .then((loaded) => {
        if (cancelled) return;
        setStart(loaded);
        setMessagesLeft(loaded.messagesLeft);
        setStartError(null);
      })
      .catch((e) => !cancelled && setStartError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // `t` changing with the language must not reload; the language itself does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, allowed, screen, viewOutletId, language, attempt]);

  // A chat from Recent chats.
  useEffect(() => {
    if (!params.chatId) return;
    let cancelled = false;
    api.buddy
      .chat(params.chatId)
      .then((chat) => {
        if (cancelled) return;
        setChatId(chat.id);
        setChatOutletId(chat.outletId);
        setMessages(chat.messages);
        scrollToEnd();
      })
      .catch((e) => !cancelled && setStartError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, params.chatId]);

  // Which languages the phone's speech recognition knows, to say plainly when one is missing.
  useEffect(() => {
    let cancelled = false;
    supportedSpeechLocales().then((list) => !cancelled && setLocales(list));
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(
    async (words: string) => {
      const text = words.trim();
      if (!text || sending) return;
      if (dictation.listening) dictation.stop();
      setSending(true);
      setOffline(false);
      setState(null);
      scrollToEnd();
      try {
        const reply = await api.buddy.send({ text, screen, ...(chatId && { chatId }), ...(viewOutletId && { outletId: viewOutletId }) });
        setMessagesLeft(reply.messagesLeft);
        if (reply.state === 'ON' && reply.chat) {
          setChatId(reply.chat.id);
          setChatOutletId(reply.chat.outletId);
          setMessages((current) => [...current, ...reply.messages]);
          setDraft('');
        } else if (reply.state === 'OUT_OF_SCOPE') {
          // Out of scope: the message shows as sent (on this phone only; it is not kept), with the
          // fixed line and a few things Buddy can help with under it, as a chat app answers a refusal.
          setMessages((current) => [...current, { id: `refused-${Date.now()}`, role: 'USER', text, createdAt: new Date().toISOString(), cards: [], opens: [], outcome: null }]);
          setDraft('');
          setState(reply.state);
          setScopeStarters(reply.starters ?? []);
        } else if (reply.state !== 'ON') {
          // Off, over a limit, too fast, or failed: one line, and what was typed stays in the box to send again.
          setState(reply.state);
          setScopeStarters(reply.starters ?? []);
        }
      } catch (e) {
        if (e instanceof ApiError && e.isNetworkError) setOffline(true);
        else setState('FAILED');
      } finally {
        setSending(false);
        scrollToEnd();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, chatId, screen, sending, viewOutletId, dictation.listening],
  );

  function newChat() {
    if (dictation.listening) dictation.cancel();
    setChatId(null);
    setChatOutletId(null);
    setMessages([]);
    setState(null);
    setOffline(false);
    setDraft('');
    router.setParams({ chatId: '' });
  }

  async function feedback(message: BuddyMessageDto, outcome: 'HELPFUL' | 'NOT_HELPFUL') {
    setMessages((current) => current.map((entry) => (entry.id === message.id ? { ...entry, outcome } : entry)));
    await api.buddy.feedback(message.id, { outcome }).catch(() => undefined);
  }

  /** A card changed: put it in its message, and add Buddy's line on what was done. */
  function cardChanged(card: BuddyCardDto, doneMessage: BuddyMessageDto | null) {
    setMessages((current) => [
      ...current.map((entry) => ({ ...entry, cards: entry.cards.map((existing) => (existing.id === card.id ? card : existing)) })),
      ...(doneMessage ? [doneMessage] : []),
    ]);
    if (doneMessage) scrollToEnd();
  }

  async function doCard(card: BuddyCardDto) {
    try {
      return await api.buddy.confirm(card.id);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      throw new Error(code?.startsWith('BUDDY_') ? t(`buddy.error.${code}` as MessageKey) : errorMessage(e, t));
    }
  }

  async function cancelCard(card: BuddyCardDto) {
    try {
      return await api.buddy.cancel(card.id);
    } catch (e) {
      throw new Error(errorMessage(e, t));
    }
  }

  /** "Change": back to the box with the card kept, to say what to change. */
  function changeCard() {
    setDraft(t('buddy.card.changePrompt'));
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  // ───────────────────────── The mic ─────────────────────────

  const speechTag = speechTagFor(speakAs);
  const languageName = LANGUAGE_NAMES[speakAs as LanguageCode];

  async function startListening() {
    const availability = speechAvailability();
    if (availability === 'expo-go') return setMicProblem('expoGo');
    if (availability === 'none') return setMicProblem('none');
    if (speechLocaleSupported(speechTag, locales) === false) return setMicProblem('notSupported');
    // Asked in the app's own words first; the phone's own question follows only after "Allow".
    if (!(await micAllowed())) return setAskMic(true);
    listen();
  }

  function listen() {
    setMicProblem(null);
    before.current = draft.trim();
    dictation.start(speechTag);
  }

  async function allowMic() {
    setAskMic(false);
    if (await askForMic()) listen();
    else setMicProblem('denied');
  }

  const problem = micProblem ?? dictation.problem;
  const problemLine =
    problem === 'expoGo'
      ? t('buddy.mic.expoGo')
      : problem === 'none'
        ? t('buddy.mic.unavailable')
        : problem === 'denied'
          ? t('buddy.mic.denied')
          : problem === 'notSupported'
            ? t('buddy.mic.notSupported', { language: languageName })
            : problem === 'noSpeech'
              ? t('buddy.mic.noSpeech')
              : problem === 'network'
                ? t('buddy.mic.network')
                : problem === 'error'
                  ? t('buddy.mic.error')
                  : null;

  if (!allowed) {
    return (
      <Screen back title={t('buddy.name')}>
        <ThemedText type="default">{t('buddy.error.BUDDY_NOT_ALLOWED')}</ThemedText>
      </Screen>
    );
  }

  const blocked = start && start.state !== 'ON' ? start.state : null;
  const notice = state ?? blocked;
  // Buddy's latest answer shows the thumbs; earlier answers keep only their buttons.
  const lastBuddy = [...messages].reverse().find((message) => message.role === 'BUDDY')?.id;

  return (
    <Screen
      back
      title={messages.length === 0 ? t('buddy.name') : undefined}
      scrollRef={scrollRef}
      headerRight={
        <View style={styles.headerButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('buddy.recent')} onPress={() => router.push('/buddy/chats')} style={styles.headerButton}>
            <Ionicons name="time-outline" size={24} color={theme.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('buddy.newChat')} onPress={newChat} style={styles.headerButton}>
            <Ionicons name="create-outline" size={24} color={theme.primary} />
          </Pressable>
        </View>
      }
      footer={
        <>
          {dictation.listening && (
            <ListeningBar
              level={dictation.level}
              languageName={languageName}
              onLanguage={() => setChooseSpeech(true)}
              onStop={dictation.stop}
              onCancel={() => {
                dictation.cancel();
                setDraft(before.current);
              }}
            />
          )}
          {offline && <ErrorText message={t('buddy.offline')} />}
          {problemLine && !dictation.listening && (
            <View style={styles.problem}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                {problemLine}
              </ThemedText>
              {problem === 'denied' && (
                <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} hitSlop={6}>
                  <ThemedText type="smallBold" themeColor="primary">
                    {t('buddy.mic.openSettings')}
                  </ThemedText>
                </Pressable>
              )}
            </View>
          )}
          {/* The cap on a message's length (the server refuses more), shown as it comes near. */}
          {draft.length > BUDDY_RULES.maxMessageChars * 0.8 && (
            <ThemedText type="small" themeColor={draft.length >= BUDDY_RULES.maxMessageChars ? 'danger' : 'textSecondary'}>
              {t('buddy.input.counter', { count: draft.length, max: BUDDY_RULES.maxMessageChars })}
            </ThemedText>
          )}
          {messagesLeft !== null && messagesLeft > 0 && messagesLeft <= FEW_LEFT && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('buddy.left', { count: messagesLeft })}
            </ThemedText>
          )}
          {/* One rounded bar holding the box, the microphone and send, as Gemini, ChatGPT and WhatsApp
              lay it out (22 Oct 2026: the box was taller than the two round buttons beside it, which sat
              at its foot). Send appears once there is something to send, so it is never a dead button;
              the buttons stay at the bar's foot as a long message grows the box. */}
          <View
            style={[
              styles.composer,
              { borderColor: dictation.listening ? theme.danger : theme.outline, backgroundColor: theme.backgroundElement },
            ]}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={t('buddy.input.placeholder')}
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel={t('buddy.input.placeholder')}
              multiline
              // A browser shows an empty multi-line box two lines tall unless told otherwise.
              {...(Platform.OS === 'web' ? { rows: 1 } : {})}
              maxLength={BUDDY_RULES.maxMessageChars}
              style={[styles.input, isRtl && styles.rightToLeft, { color: theme.text }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={dictation.listening ? t('buddy.mic.stop') : t('buddy.mic')}
              accessibilityState={{ selected: dictation.listening }}
              onPress={() => (dictation.listening ? dictation.stop() : void startListening())}
              style={[styles.round, dictation.listening && { backgroundColor: theme.danger }]}>
              <Ionicons name={dictation.listening ? 'stop' : 'mic-outline'} size={24} color={dictation.listening ? theme.onPrimary : theme.primary} />
            </Pressable>
            {(sending || draft.trim() !== '') && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('buddy.send')}
                disabled={sending}
                onPress={() => void send(draft)}
                style={[styles.round, { backgroundColor: theme.primary }]}>
                {sending ? <ActivityIndicator color={theme.onPrimary} /> : <Ionicons name="arrow-up" size={24} color={theme.onPrimary} />}
              </Pressable>
            )}
          </View>
        </>
      }>
      {/* An Owner with several outlets chooses which one Buddy works for. */}
      {messages.length === 0 && outlets.length > 1 && <OutletPicker outlets={outlets} outletId={outletId} onChoose={choose} />}
      <ErrorText message={startError} onRetry={() => setAttempt((count) => count + 1)} />

      {messages.length === 0 && (
        <>
          {/* Buddy's mascot greets the person, beside the lines that say what Buddy is. */}
          <View style={styles.greeting}>
            <BuddyMascot size={52} />
            <ThemedText type="default" style={styles.flex}>
              {t('buddy.welcome.body')}
            </ThemedText>
          </View>
          {start && start.state === 'ON' && <Starters starters={start.starters} onPick={(words) => void send(words)} disabled={sending} />}
          {!start && !startError && <ActivityIndicator color={theme.primary} />}
          <Expandable title={t('buddy.welcome.more')} icon="information-circle-outline">
            <ThemedText type="small">{t('buddy.welcome.can')}</ThemedText>
            <ThemedText type="small">{t('buddy.welcome.reads')}</ThemedText>
            <ThemedText type="small">{t('buddy.welcome.changes')}</ThemedText>
            <ThemedText type="small">{t('buddy.welcome.cannot')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('buddy.welcome.ai', { days: start?.keepDays ?? BUDDY_RULES.keepDays })}
            </ThemedText>
          </Expandable>
        </>
      )}

      {messages.length > 0 && start?.outletName && outlets.length > 1 && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('buddy.forOutlet', { outlet: outlets.find((entry) => entry.id === viewOutletId)?.name ?? start.outletName })}
        </ThemedText>
      )}

      {messages.map((message) => (
        <Message
          key={message.id}
          message={message}
          outletId={viewOutletId}
          latest={message.id === lastBuddy}
          onFeedback={(outcome) => void feedback(message, outcome)}
          onCardChanged={cardChanged}
          onChange={changeCard}
          doCard={doCard}
          cancelCard={cancelCard}
        />
      ))}

      {sending && (
        <View style={styles.answerHead}>
          <ActivityIndicator color={theme.primary} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('buddy.thinking')}
          </ThemedText>
        </View>
      )}
      {notice && (
        <StateNotice
          state={notice}
          dailyMessages={start?.dailyMessages ?? BUDDY_RULES.dailyMessagesPerPerson}
          outletId={viewOutletId}
          starters={scopeStarters}
          onPick={(words) => void send(words)}
          onNewChat={newChat}
        />
      )}
      {/* Under AI-written answers only: the out-of-scope line and the limits are the app's own fixed words. */}
      {lastBuddy && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.byAi}>
          {t('buddy.byAi')}
        </ThemedText>
      )}

      <ConfirmDialog
        visible={askMic}
        message={`${t('buddy.mic.askTitle')}\n\n${t('buddy.mic.askBody')}`}
        confirmLabel={t('buddy.mic.askYes')}
        onConfirm={() => void allowMic()}
        onCancel={() => setAskMic(false)}
      />
      <OptionSheet
        visible={chooseSpeech}
        title={t('buddy.mic.chooseLanguage')}
        options={speechChoices(language as Language).map((choice) => ({
          label: LANGUAGE_NAMES[choice as LanguageCode],
          icon: choice === speakAs ? 'checkmark' : 'language-outline',
          onPress: () => {
            setChooseSpeech(false);
            setSpeakAs(choice);
            // Listening again in the new language, keeping what was heard so far.
            if (dictation.listening) {
              dictation.stop();
              setTimeout(() => {
                before.current = draft.trim();
                dictation.start(speechTagFor(choice));
              }, 300);
            }
          },
        }))}
        onClose={() => setChooseSpeech(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
  headerButton: { width: MinTouchSize, height: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
  greeting: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  answerHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.half,
    minHeight: MinTouchSize,
    borderWidth: 1.5,
    borderRadius: MinTouchSize / 2,
    paddingStart: Spacing.three,
    paddingEnd: Spacing.half,
    paddingVertical: Spacing.half,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingVertical: Spacing.two + Spacing.half,
    fontSize: 17,
    lineHeight: 22,
  },
  rightToLeft: { writingDirection: 'rtl' },
  // 44 inside the 52 bar; the bar around it makes up the rest of the touch area.
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  problem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  byAi: { textAlign: 'center' },
});
