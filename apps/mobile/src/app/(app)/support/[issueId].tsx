import Ionicons from '@expo/vector-icons/Ionicons';
import { can, isIssueOpen, type IssueDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { TranslatableText } from '@/components/ai-parts';
import { IssueStatusBadge } from '@/components/issue-status-badge';
import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate, formatDateTime, formatTimeOfDay, indiaToday } from '@/lib/format';
import { useDirection } from '@/lib/direction';
import { useSession } from '@/lib/session';

/** One ECCS support issue: what was raised, its photos, and the conversation with ECCS. */
export default function IssueScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  // The paper plane on the send button flies the way the writing runs.
  const { mirror } = useDirection();
  const notify = useSnackbar();
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  const [issue, setIssue] = useState<IssueDto | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'message' | 'status' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Each error is shown beside what caused it: the reply box, or the close and reopen button.
  const [error, setError] = useState<{ at: 'message' | 'status'; text: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let cancelled = false;
    api.issues
      .get(issueId)
      .then(async (loaded) => {
        if (cancelled) return;
        setIssue(loaded);
        // Messages in another language are shown as written at once, then in this
        // person's language as soon as AI has translated them (once; kept after that).
        const translated = loaded.translationPending ? await api.issues.translate(issueId).catch(() => null) : null;
        if (!cancelled && translated) setIssue(translated);
      })
      .catch((e) => !cancelled && setLoadError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // The thread is read again in the new language when the app's language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, issueId, language]);

  /** Loads the issue again: for pull-to-refresh and "Try again". */
  async function load() {
    try {
      const loaded = await api.issues.get(issueId);
      setIssue(loaded);
      setLoadError(null);
      if (loaded.translationPending) {
        const translated = await api.issues.translate(issueId).catch(() => null);
        if (translated) setIssue(translated);
      }
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
  }

  // Opens at the newest message, and goes there again whenever one is added,
  // as chat apps do. Waits a moment so the page has been laid out first.
  const messageCount = issue?.comments.length ?? 0;
  useEffect(() => {
    if (messageCount === 0) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    return () => clearTimeout(timer);
  }, [messageCount]);

  if (!issue) {
    return (
      <Screen back>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  // The Owner and Manager may close an issue or reopen it; ECCS handles the stages in between.
  const mayChange = can(user?.memberships ?? [], 'issues', 'update', { outletId: issue.outletId });
  const open = isIssueOpen(issue.status);
  const closed = issue.status === 'CLOSED';

  async function act(kind: 'message' | 'status', action: () => Promise<IssueDto>, savedMessage: string) {
    setBusy(kind);
    setError(null);
    try {
      setIssue(await action());
      if (kind === 'message') setMessage('');
      notify(savedMessage);
    } catch (e) {
      setError({ at: kind, text: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  function sendMessage() {
    const body = message.trim();
    if (!body) {
      setError({ at: 'message', text: t('support.messageNeeded') });
      return;
    }
    void act('message', () => api.issues.comment(issue!.id, { body }), t('support.messageSent'));
  }

  const reopen = () => void act('status', () => api.issues.setStatus(issue.id, 'OPEN'), t('support.reopened'));

  // The day of a message as chat apps name it: Today, Yesterday, or the date.
  const today = indiaToday();
  const dayName = (day: string) =>
    day === today ? t('notif.today') : day === addDays(today, -1) ? t('notif.yesterday') : formatDate(day, language);

  // Pinned under the conversation. A closed issue takes no replies: whoever may
  // reopen it is offered that instead, and everyone else is told it is closed.
  const footer = closed ? (
    <>
      <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
        {t('support.closedNote')}
      </ThemedText>
      {mayChange && (
        <>
          <ErrorText message={error?.at === 'status' ? error.text : null} />
          <Button label={t('support.reopenToReply')} onPress={reopen} loading={busy === 'status'} />
        </>
      )}
    </>
  ) : (
    <>
      <ErrorText message={error?.at === 'message' ? error.text : null} />
      <View style={styles.composer}>
        <View style={styles.composerField}>
          <TextField
            label={t('support.reply')}
            value={message}
            onChangeText={(text) => {
              setMessage(text);
              if (error?.at === 'message') setError(null);
            }}
            maxLength={1000}
            multiline
            style={styles.message}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('support.sendMessage')}
          accessibilityState={{ busy: busy === 'message', disabled: busy !== null }}
          disabled={busy !== null}
          onPress={sendMessage}
          style={({ pressed }) => [styles.send, { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 }]}>
          {busy === 'message' ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <Ionicons name="send" size={24} color={theme.onPrimary} style={mirror} />
          )}
        </Pressable>
      </View>
    </>
  );

  return (
    <Screen
      back
      title={t(`category.${issue.category}`)}
      subtitle={`${issue.reference} · ${issue.outletName}`}
      footer={footer}
      onRefresh={load}
      scrollRef={scrollRef}>
      <IssueStatusBadge status={issue.status} />
      {/* A refresh that fails leaves the conversation as it was, and says so here. */}
      <ErrorText message={loadError} onRetry={() => void load()} />
      <TranslatableText original={issue.description} translation={issue.descriptionTranslation} />
      <ThemedText type="small" themeColor="textSecondary">
        {t('support.raisedBy', { name: issue.raisedByName, when: formatDateTime(issue.createdAt, language) })}
      </ThemedText>

      {issue.photoPaths.map((path) => (
        <ProofPhoto key={path} uri={api.fileUrl(path)} label={issue.description} />
      ))}

      {/* Closing sits with the issue itself, away from the reply box, so it is not hit by mistake. */}
      {mayChange && !closed && (
        <>
          <Button
            label={t('support.close')}
            variant="link"
            align="start"
            onPress={() => void act('status', () => api.issues.setStatus(issue.id, 'CLOSED'), t('support.closed'))}
            loading={busy === 'status'}
            disabled={busy !== null}
          />
          <ErrorText message={error?.at === 'status' ? error.text : null} />
        </>
      )}

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('support.messages')}
      </ThemedText>
      {issue.comments.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t(open || issue.status === 'RESOLVED' ? 'support.noMessages' : 'support.closedNote')}
        </ThemedText>
      )}
      {/* As chat apps lay a conversation out (WhatsApp, Google Messages): the day once, as a divider,
          and the time on each message; the restaurant's own messages on the far side, filled with the
          light accent and without their name when they are the reader's own; ECCS's on the near side,
          grey, with who wrote them. */}
      {issue.comments.map((comment, index) => {
        const { day } = indiaDayOf(comment.createdAt);
        const newDay = index === 0 || indiaDayOf(issue.comments[index - 1]!.createdAt).day !== day;
        const own = !comment.fromEccs;
        const mine = own && comment.authorName === user?.name;
        return (
          <View key={comment.id} style={styles.messageGroup}>
            {newDay && (
              <View style={styles.dayDivider} accessibilityRole="header">
                <ThemedText type="small" themeColor="textSecondary" style={[styles.dayText, { backgroundColor: theme.backgroundElement }]}>
                  {dayName(day)}
                </ThemedText>
              </View>
            )}
            <View
              style={[
                styles.bubble,
                own
                  ? [styles.ownBubble, { backgroundColor: theme.primaryContainer }]
                  : [styles.theirBubble, { backgroundColor: theme.backgroundElement }],
              ]}>
              {!mine && (
                <ThemedText type="smallBold" themeColor={comment.fromEccs ? 'primary' : 'textSecondary'}>
                  {comment.fromEccs ? `${t('support.eccs')} · ${comment.authorName}` : comment.authorName}
                </ThemedText>
              )}
              <TranslatableText original={comment.body} translation={comment.translation} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
                {formatTimeOfDay(comment.createdAt, language)}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </Screen>
  );
}

/** The calendar date in India a message was written on, YYYY-MM-DD, whatever the phone's own time zone. */
function indiaDayOf(iso: string): { day: string } {
  try {
    return { day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso)) };
  } catch {
    return { day: new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) };
  }
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: Spacing.three },
  center: { textAlign: 'center' },
  messageGroup: { gap: Spacing.three },
  dayDivider: { alignItems: 'center', marginTop: Spacing.two },
  dayText: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.three, overflow: 'hidden' },
  // Filled, with no edge, as chat bubbles are; the corner nearest the writer's side a little squarer.
  bubble: { maxWidth: '88%', borderRadius: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one, gap: Spacing.one },
  ownBubble: { alignSelf: 'flex-end', borderBottomEndRadius: Spacing.one },
  theirBubble: { alignSelf: 'flex-start', borderBottomStartRadius: Spacing.one },
  time: { alignSelf: 'flex-end' },
  // The send button stays level with the bottom of the box as the box grows with the text.
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  composerField: { flex: 1 },
  message: { maxHeight: 120, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
  send: {
    width: MinTouchSize,
    height: MinTouchSize,
    borderRadius: MinTouchSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
