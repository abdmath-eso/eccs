import { localize, type CertificateDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorText } from '@/components/ui/error-text';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { StatusChip } from '@/components/ui/status-chip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// The same marks as for licences: each state has its own label with an icon and a word, never colour alone.
const STATE_LOOK = {
  VALID: { tone: 'good', icon: 'checkmark-circle-outline' },
  EXPIRING: { tone: 'warn', icon: 'time-outline' },
  EXPIRED: { tone: 'bad', icon: 'alert-circle-outline' },
} as const;

/**
 * The certificates ECCS has issued for one outlet, for its Owner and Manager.
 * Those still valid come first, so the one an inspector asks for is at the
 * top; expired ones stay underneath as a record. Each opens as a PDF.
 *
 * With none yet, the screen says so in an empty state (a picture, one line,
 * one sentence and a way on to the services), not a grey paragraph under a
 * grey introduction (Nielsen Norman Group and SAP Fiori on empty states, 22 Oct
 * 2026). What the screen is for is folded under "About this screen".
 */
export default function CertificatesScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [certificates, setCertificates] = useState<CertificateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which certificate's PDF is being fetched, and the one whose PDF could not be opened.
  const [opening, setOpening] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      setCertificates(await api.certificates.list({ outletId }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  // Reloads on coming back, so a certificate issued meanwhile is there.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Opens the certificate as a PDF in the phone's viewer. The first time, the server makes it, which takes a few seconds. */
  async function openPdf(certificate: CertificateDto) {
    if (opening !== null) return;
    setOpening(certificate.id);
    setFailed(null);
    try {
      const { path } = await api.certificates.pdf(certificate.id);
      await Linking.openURL(api.fileUrl(path));
    } catch (e) {
      setFailed({ id: certificate.id, message: errorMessage(e, t) });
    } finally {
      setOpening(null);
    }
  }

  // "160 days left", "1 day left", "3 days overdue": the number first, as people say it.
  const countdown = (daysLeft: number) =>
    daysLeft < -1
      ? t('docs.expiredAgo', { count: -daysLeft })
      : daysLeft === -1
        ? t('docs.dayOverdueOne')
        : daysLeft === 0
          ? t('docs.expiresToday')
          : daysLeft === 1
            ? t('docs.dayLeftOne')
            : t('docs.daysLeft', { count: daysLeft });

  const card = (certificate: CertificateDto) => {
    const look = STATE_LOOK[certificate.state];
    return (
      <Card key={certificate.id}>
        <ThemedText type="default" style={styles.cardTitle}>
          {localize(certificate.serviceName, language)}
        </ThemedText>
        <View style={styles.stateRow}>
          <StatusChip tone={look.tone} icon={look.icon} label={t(`docs.state${certificate.state}`)} />
          <ThemedText type="small" themeColor="textSecondary">
            {countdown(certificate.daysLeft)}
          </ThemedText>
        </View>
        <ThemedText type="default">
          {t('cert.validFromTo', {
            from: formatDate(certificate.validFrom, language),
            until: formatDate(certificate.validUntil, language),
          })}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('cert.number', { number: ltrText(certificate.number) })}
        </ThemedText>

        <View style={styles.cardActions}>
          <Button
            icon="document-text-outline"
            label={t('cert.open')}
            // Soft rather than filled: with several certificates there would be a filled button on each.
            variant={certificate.state === 'EXPIRED' ? 'secondary' : 'tonal'}
            loading={opening === certificate.id}
            disabled={opening !== null && opening !== certificate.id}
            onPress={() => void openPdf(certificate)}
          />
          <ErrorText
            message={failed?.id === certificate.id ? failed.message : null}
            onRetry={() => void openPdf(certificate)}
          />
          {certificate.visitId && (
            <Button
              label={t('cert.seeVisit')}
              variant="link"
              align="start"
              onPress={() => router.push({ pathname: '/services/[visitId]', params: { visitId: certificate.visitId! } })}
            />
          )}
        </View>
      </Card>
    );
  };

  const all = certificates ?? [];
  const inDate = all.filter((certificate) => certificate.state !== 'EXPIRED');
  const expired = all.filter((certificate) => certificate.state === 'EXPIRED');

  const group = (title: string, list: CertificateDto[], gap: boolean) =>
    list.length > 0 && (
      <>
        <ThemedText type="smallBold" themeColor="textSecondary" style={gap && styles.sectionGap}>
          {title}
        </ThemedText>
        {list.map(card)}
      </>
    );

  return (
    <Screen back title={t('cert.title')} about={t('cert.help')} onRefresh={load}>
      <OutletPicker
        outlets={outlets}
        outletId={outletId}
        onChoose={(nextOutletId) => {
          setCertificates(null);
          setError(null);
          setFailed(null);
          choose(nextOutletId);
        }}
      />

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (certificates === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {certificates !== null && all.length === 0 && (
        <EmptyState
          icon="ribbon-outline"
          title={t('cert.noneTitle')}
          body={t('cert.noneBody')}
          action={{ label: t('cert.seeServices'), icon: 'construct-outline', onPress: () => router.push('/services') }}
        />
      )}

      {group(t('cert.inDate'), inDate, false)}
      {group(t('cert.expired'), expired, inDate.length > 0)}

      {all.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionGap}>
          {t('cert.ownNote')}
        </ThemedText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: Spacing.four },
  cardTitle: { fontWeight: 700, fontSize: 18 },
  // The state's label and how long is left, side by side; under each other when they do not fit.
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.two, rowGap: Spacing.one },
  cardActions: { gap: Spacing.two, marginTop: Spacing.one },
});
