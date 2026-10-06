import Ionicons from '@expo/vector-icons/Ionicons';
import type { IssueSummaryDto, SupportContactDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { IssueStatusBadge } from '@/components/issue-status-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

/** ECCS support: contact ECCS directly, raise an issue, and follow the ones already raised. */
export default function SupportScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const [contact, setContact] = useState<SupportContactDto | null>(null);
  const [issues, setIssues] = useState<IssueSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reloads whenever the screen comes back into view, so a newly raised issue or a reply shows.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [details, list] = await Promise.all([api.support.contact(), api.issues.list()]);
          if (cancelled) return;
          setContact(details);
          setIssues(list);
          setError(null);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]),
  );

  const severalOutlets = new Set(issues?.map((issue) => issue.outletId)).size > 1;

  return (
    <Screen back title={t('support.title')} subtitle={t('support.help')}>
      <Button label={t('support.raise')} onPress={() => router.push('/support/new')} />

      {contact && (
        <View style={styles.contact}>
          <View style={styles.contactButton}>
            <Button
              label={`📞  ${t('support.call')}`}
              variant="secondary"
              onPress={() => void Linking.openURL(`tel:${contact.phone}`)}
            />
          </View>
          <View style={styles.contactButton}>
            <Button
              label={`💬  ${t('support.whatsapp')}`}
              variant="secondary"
              onPress={() => void Linking.openURL(`https://wa.me/${contact.whatsapp}`)}
            />
          </View>
        </View>
      )}
      {contact && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {contact.phone} · {contact.hours}
        </ThemedText>
      )}

      <ErrorText message={error} />
      {issues === null && !error && <ActivityIndicator color={theme.primary} />}

      {issues !== null && (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {t('support.yourIssues')}
        </ThemedText>
      )}
      {issues?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('support.none')}
        </ThemedText>
      )}
      {issues?.map((issue) => (
        <Pressable
          key={issue.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/support/[issueId]', params: { issueId: issue.id } })}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <View style={styles.cardHeader}>
            <ThemedText type="default" style={styles.cardTitle}>
              {t(`category.${issue.category}`)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {issue.reference}
            </ThemedText>
          </View>
          <IssueStatusBadge status={issue.status} />
          <ThemedText type="default" numberOfLines={2}>
            {issue.description}
          </ThemedText>
          <View style={styles.meta}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.metaText}>
              {severalOutlets ? `${issue.outletName} · ` : ''}
              {formatDateTime(issue.createdAt, language)}
            </ThemedText>
            {issue.photoCount > 0 && <Ionicons name="camera" size={18} color={theme.textSecondary} />}
            {issue.commentCount > 0 && (
              <>
                <Ionicons name="chatbubble-ellipses" size={18} color={theme.primary} />
                <ThemedText type="small" themeColor="primary">
                  {issue.commentCount}
                </ThemedText>
              </>
            )}
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  contact: { flexDirection: 'row', gap: Spacing.two },
  contactButton: { flex: 1 },
  center: { textAlign: 'center' },
  sectionGap: { marginTop: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two, minHeight: MinTouchSize * 1.6 },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  metaText: { flex: 1 },
});
