import { can, isIssueOpen, type IssueDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { IssueStatusBadge } from '@/components/issue-status-badge';
import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

/** One ECCS support issue: what was raised, its photos, and the conversation with ECCS. */
export default function IssueScreen() {
  const theme = useTheme();
  const { t, api, user, language } = useSession();
  const { issueId } = useLocalSearchParams<{ issueId: string }>();
  const [issue, setIssue] = useState<IssueDto | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'message' | 'status' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.issues
      .get(issueId)
      .then((loaded) => !cancelled && setIssue(loaded))
      .catch((e) => !cancelled && setError(errorMessage(e, t)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, issueId]);

  if (!issue) {
    return (
      <Screen back>
        <ErrorText message={error} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  // The Owner and Manager may close an issue or reopen it; ECCS handles the stages in between.
  const mayChange = can(user?.memberships ?? [], 'issues', 'update', { outletId: issue.outletId });
  const open = isIssueOpen(issue.status);

  async function act(kind: 'message' | 'status', action: () => Promise<IssueDto>) {
    setBusy(kind);
    setError(null);
    try {
      setIssue(await action());
      if (kind === 'message') setMessage('');
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen back title={t(`category.${issue.category}`)} subtitle={`${issue.reference} · ${issue.outletName}`}>
      <IssueStatusBadge status={issue.status} />
      <ThemedText type="default">{issue.description}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('support.raisedBy', { name: issue.raisedByName, when: formatDateTime(issue.createdAt, language) })}
      </ThemedText>

      {issue.photoPaths.map((path) => (
        <ProofPhoto key={path} uri={api.fileUrl(path)} label={issue.description} />
      ))}

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('support.messages')}
      </ThemedText>
      {issue.comments.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('support.noMessages')}
        </ThemedText>
      )}
      {issue.comments.map((comment) => (
        <View
          key={comment.id}
          style={[
            styles.bubble,
            comment.fromEccs
              ? { backgroundColor: theme.backgroundElement, borderColor: theme.primary, alignSelf: 'flex-start' }
              : { backgroundColor: theme.background, borderColor: theme.border, alignSelf: 'flex-end' },
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

      <TextField
        value={message}
        onChangeText={setMessage}
        placeholder={t('support.reply')}
        maxLength={1000}
        multiline
        style={styles.message}
      />
      <Button
        label={t('support.sendMessage')}
        onPress={() => void act('message', () => api.issues.comment(issue.id, { body: message.trim() }))}
        loading={busy === 'message'}
        disabled={message.trim().length === 0 || busy !== null}
      />

      <ErrorText message={error} />

      {mayChange && (
        <Button
          label={open || issue.status === 'RESOLVED' ? t('support.close') : t('support.reopen')}
          variant="link"
          onPress={() =>
            void act('status', () => api.issues.setStatus(issue.id, issue.status === 'CLOSED' ? 'OPEN' : 'CLOSED'))
          }
          disabled={busy !== null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: Spacing.three },
  bubble: { maxWidth: '88%', borderWidth: 1.5, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  message: { minHeight: 88, paddingVertical: Spacing.two, fontSize: 17, textAlignVertical: 'top' },
});
