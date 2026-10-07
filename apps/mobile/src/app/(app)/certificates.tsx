import Ionicons from '@expo/vector-icons/Ionicons';
import { localize, type CertificateDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

// The same three marks as for licences: each state has its own icon and word, never colour alone.
const STATE_ICON = { VALID: 'checkmark-circle', EXPIRING: 'time', EXPIRED: 'alert-circle' } as const;

/**
 * The certificates ECCS has issued for one outlet, for its Owner and Manager.
 * Those still valid come first, so the one an inspector asks for is at the
 * top; expired ones stay underneath as a record. Each opens as a PDF.
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

  const stateColor = { VALID: theme.primary, EXPIRING: theme.warning, EXPIRED: theme.danger } as const;
  const countdown = (certificate: CertificateDto) =>
    certificate.daysLeft < 0
      ? t('docs.expiredAgo', { count: -certificate.daysLeft })
      : certificate.daysLeft === 0
        ? t('docs.expiresToday')
        : t('docs.daysLeft', { count: certificate.daysLeft });

  const card = (certificate: CertificateDto) => {
    const color = stateColor[certificate.state];
    return (
      <View
        key={certificate.id}
        style={[styles.card, { borderColor: certificate.state === 'VALID' ? theme.border : color }]}>
        <View style={styles.cardHeader}>
          <ThemedText type="default" style={styles.cardTitle}>
            {localize(certificate.serviceName, language)}
          </ThemedText>
          <Ionicons
            name={STATE_ICON[certificate.state]}
            size={28}
            color={color}
            accessibilityLabel={t(`docs.state${certificate.state}`)}
          />
        </View>
        <ThemedText type="smallBold" style={{ color }}>
          {t(`docs.state${certificate.state}`)} · {countdown(certificate)}
        </ThemedText>
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
            variant={certificate.state === 'EXPIRED' ? 'secondary' : 'primary'}
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
              onPress={() => router.push({ pathname: '/services/[visitId]', params: { visitId: certificate.visitId! } })}
            />
          )}
        </View>
      </View>
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
    <Screen back title={t('cert.title')} subtitle={t('cert.help')} onRefresh={load}>
      {outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setCertificates(null);
                setError(null);
                setFailed(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (certificates === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {certificates !== null && all.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('cert.none')}
        </ThemedText>
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
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  cardActions: { gap: Spacing.two, marginTop: Spacing.one },
});
