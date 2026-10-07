import Ionicons from '@expo/vector-icons/Ionicons';
import { can, isIssueOpen, type IssueDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ScrollView } from 'react-native';

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
import { formatDateTime } from '@/lib/format';
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
      .then((loaded) => !cancelled && setIssue(loaded))
      .catch((e) => !cancelled && setLoadError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, issueId]);

  /** Loads the issue again: for pull-to-refresh and "Try again". */
  async function load() {
    try {
      setIssue(await api.issues.get(issueId));
      setLoadError(null);
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
      <ThemedText type="default">{issue.description}</ThemedText>
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
      {issue.comments.map((comment) => (
        <View
          key={comment.id}
          style={[
            styles.bubble,
            comment.fromEccs
              ? { backgroundColor: theme.backgroundElement, borderColor: theme.primary, alignSelf: 'flex-start' }
              : { backgroundColor: theme.background, borderColor: theme.outline, alignSelf: 'flex-end' },
          ]}>
          <ThemedText type="smallBold" themeColor={comment.fromEccs ? 'primary' : 'textSecondary'}>
            {comment.fromEccs ? `${t('support.eccs')} · ${comment.authorName}` : comment.authorName}
          </ThemedText>
          <ThemedText type="default">{comment.body}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDateTime(comment.createdAt, language)}
          </ThemedText>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: Spacing.three },
  center: { textAlign: 'center' },
  bubble: { maxWidth: '88%', borderWidth: 1.5, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
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
