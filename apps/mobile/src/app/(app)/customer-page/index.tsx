import Ionicons from '@expo/vector-icons/Ionicons';
import { PUBLIC_PAGE_RULES, type PublicPageSettingsDto, type PublicPageState, type PublicPhotoDto } from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Switch, View } from 'react-native';

import { ProofPhoto } from '@/components/proof-photo';
import { QrCode } from '@/components/qr-code';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Each state has its own icon as well as its sentence, never colour alone.
const STATE_ICON: Record<PublicPageState, IconName> = {
  LIVE: 'checkmark-circle',
  OFF: 'eye-off',
  TAKEN_DOWN: 'hand-left',
  NO_INSPECTION: 'time',
  INSPECTION_EXPIRED: 'time',
  INACTIVE: 'eye-off',
};

const PUBLISHED = ['cpage.switch.item1', 'cpage.switch.item2', 'cpage.switch.item3', 'cpage.switch.item4', 'cpage.switch.item5', 'cpage.switch.item6'] as const;

/**
 * The restaurant's customer page: the public web page a diner opens from a QR
 * code. The Owner turns it on or off here, sees what a diner sees, shows or
 * shares the QR code, makes a new link, and removes photos. The Manager sees
 * the same but changes nothing.
 *
 * Built the way apps handle a shareable link: one switch that takes effect at
 * once, with what it publishes spelled out beside it (Material's guidance for
 * switches); the QR code large on white with Share under it (the "my QR code"
 * screens of payment and messaging apps); and "make a new link", which kills
 * the old one, behind a warning (WhatsApp's "Reset link" for group invites).
 */
export default function CustomerPageScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [page, setPage] = useState<PublicPageSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'switch' | 'link' | 'photo' | null>(null);
  // Where the last change went wrong, so the message sits beside its cause.
  const [failed, setFailed] = useState<{ at: 'switch' | 'link' | 'photo' | 'share'; message: string } | null>(null);
  const [asking, setAsking] = useState<{ what: 'on' | 'link' } | { what: 'photo'; photo: PublicPhotoDto } | null>(null);

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      setPage(await api.publicPage.get(outletId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  // Reloads on coming back, so a photo approved or an inspection released meanwhile is there.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Makes one change and puts the server's answer on the screen. */
  async function change(at: 'switch' | 'link' | 'photo', action: () => Promise<PublicPageSettingsDto | void>, done: string) {
    if (busy !== null) return;
    setBusy(at);
    setFailed(null);
    try {
      const next = await action();
      if (next) setPage(next);
      else await load();
      notify(done);
    } catch (e) {
      setFailed({ at, message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  function setEnabled(enabled: boolean) {
    if (!page) return;
    void change('switch', () => api.publicPage.setEnabled(page.outletId, enabled), t(enabled ? 'cpage.on.done' : 'cpage.off.done'));
  }

  async function shareLink() {
    if (!page) return;
    setFailed(null);
    try {
      await Share.share({ message: t('cpage.qr.shareText', { url: page.url }) });
    } catch (e) {
      setFailed({ at: 'share', message: errorMessage(e, t) });
    }
  }

  const errorAt = (at: 'switch' | 'link' | 'photo' | 'share') => (failed?.at === at ? failed.message : null);
  const card = [styles.card, { borderColor: theme.border }];
  const heading = (text: string) => (
    <ThemedText type="default" style={styles.heading}>
      {text}
    </ThemedText>
  );

  const body = () => {
    if (!page) return null;
    const preview = page.preview;
    const live = page.state === 'LIVE';
    const stateColor = live ? theme.primary : page.state === 'TAKEN_DOWN' || page.state === 'INSPECTION_EXPIRED' ? theme.warning : theme.textSecondary;
    const shownPhotos = page.photos.filter((photo) => photo.shown).length;

    return (
      <>
        {/* Where the page stands, first: the one thing the Owner came to check. */}
        <View style={[styles.card, styles.row, { borderColor: stateColor }]}>
          <Ionicons name={STATE_ICON[page.state]} size={28} color={stateColor} />
          <ThemedText type="default" style={styles.grow}>
            {t(`cpage.state.${page.state}`, { days: PUBLIC_PAGE_RULES.inspectionValidDays })}
          </ThemedText>
        </View>

        {page.localOnly && (
          <View style={[styles.card, styles.row, { borderColor: theme.warning }]}>
            <Ionicons name="warning" size={24} color={theme.warning} />
            <ThemedText type="default" style={styles.grow}>
              {t('cpage.local')}
            </ThemedText>
          </View>
        )}

        {/* The switch, with exactly what turning it on publishes. */}
        <View style={card}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <ThemedText type="default" style={styles.heading}>
                {t('cpage.switch.label')}
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t(page.enabled ? 'cpage.switch.on' : 'cpage.switch.off')}
              </ThemedText>
            </View>
            {busy === 'switch' ? (
              <ActivityIndicator color={theme.primary} />
            ) : (
              <Switch
                accessibilityLabel={t('cpage.switch.label')}
                value={page.enabled}
                disabled={!page.canSwitch || busy !== null || (page.takenDown && !page.enabled)}
                // Turning it on publishes the restaurant's result, so that way round is asked first.
                onValueChange={(next) => (next ? setAsking({ what: 'on' }) : setEnabled(false))}
                trackColor={{ true: theme.primary, false: theme.outline }}
              />
            )}
          </View>
          <ErrorText message={errorAt('switch')} />
          {!page.canSwitch && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('cpage.switch.ownerOnly')}
            </ThemedText>
          )}
          <ThemedText type="small">{t('cpage.switch.publishes')}</ThemedText>
          {PUBLISHED.map((key) => (
            <View key={key} style={styles.bullet}>
              <ThemedText type="small">•</ThemedText>
              <ThemedText type="small" style={styles.grow}>
                {t(key)}
              </ThemedText>
            </View>
          ))}
          <ThemedText type="smallBold">{t('cpage.switch.never')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('cpage.switch.lapse', { days: PUBLIC_PAGE_RULES.inspectionValidDays })}
          </ThemedText>
        </View>

        {/* What a diner sees now, or would see if the page were on. */}
        <View style={card}>
          {heading(t('cpage.preview.title'))}
          {preview ? (
            <>
              <ThemedText type="default" style={styles.score}>
                {t('cpage.preview.score', { score: preview.inspection.score })}
              </ThemedText>
              <ThemedText type="smallBold">{t(`public.inspection.grade.${preview.inspection.grade}`)}</ThemedText>
              <ThemedText type="small">
                {t('cpage.preview.inspected', {
                  date: formatDate(preview.inspection.date, language),
                  number: ltrText(preview.inspection.reportNumber),
                })}
              </ThemedText>
              <ThemedText type="small">
                {preview.selfChecks
                  ? t('cpage.preview.self', { done: preview.selfChecks.handedIn, days: preview.selfChecks.days })
                  : t('public.self.none')}
              </ThemedText>
              <ThemedText type="small">{t('cpage.preview.services', { count: preview.services.length })}</ThemedText>
              <ThemedText type="small">{t('cpage.preview.photos', { count: preview.photos.length })}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('public.inspection.until', { date: formatDate(preview.inspection.shownUntil, language) })}
              </ThemedText>
              {live && (
                <Button icon="open-outline" label={t('cpage.preview.open')} variant="secondary" onPress={() => void Linking.openURL(page.url)} />
              )}
            </>
          ) : (
            <ThemedText type="default" themeColor="textSecondary">
              {t('cpage.preview.none')}
            </ThemedText>
          )}
        </View>

        {/* The code itself: black on white whatever the theme, so it scans off this screen too. */}
        <View style={card}>
          {heading(t('cpage.qr.title'))}
          <ThemedText type="small" themeColor="textSecondary">
            {t('cpage.qr.hint')}
          </ThemedText>
          <View style={styles.qr}>
            <QrCode value={page.url} size={248} label={t('cpage.qr.label')} />
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centred}>
            {ltrText(page.url)}
          </ThemedText>
          {!live && (
            <ThemedText type="smallBold" style={styles.centred}>
              {t('cpage.qr.offNote')}
            </ThemedText>
          )}
          <Button icon="share-social-outline" label={t('cpage.qr.share')} onPress={() => void shareLink()} />
          <ErrorText message={errorAt('share')} />
          {/* The poster is a web page with its own Print button; the phone's browser prints or saves it. */}
          <Button icon="print-outline" label={t('cpage.qr.print')} variant="secondary" onPress={() => void Linking.openURL(`${page.url}/poster`)} />

          {page.canSwitch && (
            <>
              <Button
                icon="refresh"
                label={t('cpage.newLink.button')}
                hint={t('cpage.newLink.help')}
                variant="secondary"
                loading={busy === 'link'}
                disabled={busy !== null && busy !== 'link'}
                onPress={() => setAsking({ what: 'link' })}
              />
              <ErrorText message={errorAt('link')} />
            </>
          )}
        </View>

        {/* The photos on the page. The Owner can take any of them off at any time. */}
        <View style={card}>
          {heading(t('cpage.photos.title'))}
          <ThemedText type="small" themeColor="textSecondary">
            {t('cpage.photos.help')}
          </ThemedText>
          {page.photosWaiting > 0 && <ThemedText type="smallBold">{t('cpage.photos.waiting', { count: page.photosWaiting })}</ThemedText>}
          {page.photos.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('cpage.photos.none')}
            </ThemedText>
          )}
          <ErrorText message={errorAt('photo')} />
          {page.photos.map((photo) => (
            <View key={photo.id} style={styles.photo}>
              <ProofPhoto uri={api.fileUrl(photo.path)} label={t(`public.photo.${photo.caption}`)} />
              <ThemedText type="smallBold">{t(`public.photo.${photo.caption}`)}</ThemedText>
              {!photo.shown && (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('cpage.photos.notShown', { count: PUBLIC_PAGE_RULES.maxPhotos })}
                </ThemedText>
              )}
              {page.canSwitch && (
                <Button
                  icon="trash-outline"
                  label={t('cpage.photos.remove')}
                  variant="secondary"
                  disabled={busy !== null}
                  onPress={() => setAsking({ what: 'photo', photo })}
                />
              )}
            </View>
          ))}
          {shownPhotos > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('cpage.preview.photos', { count: shownPhotos })}
            </ThemedText>
          )}
        </View>

        <ThemedText type="small" themeColor="textSecondary">
          {t('public.private')}
        </ThemedText>
      </>
    );
  };

  return (
    <Screen back title={t('cpage.title')} subtitle={t('cpage.help')} onRefresh={load}>
      <OutletPicker
        outlets={outlets}
        outletId={outletId}
        onChoose={(nextOutletId) => {
          setPage(null);
          setError(null);
          setFailed(null);
          choose(nextOutletId);
        }}
      />

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (page === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}
      {body()}

      <ConfirmDialog
        visible={asking?.what === 'on'}
        message={t('cpage.on.confirm')}
        confirmLabel={t('cpage.switch.turnOn')}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          setEnabled(true);
        }}
      />
      <ConfirmDialog
        visible={asking?.what === 'link'}
        message={t('cpage.newLink.confirm')}
        confirmLabel={t('cpage.newLink.button')}
        danger
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          setAsking(null);
          if (page) void change('link', () => api.publicPage.newLink(page.outletId), t('cpage.newLink.done'));
        }}
      />
      <ConfirmDialog
        visible={asking?.what === 'photo'}
        message={t('cpage.photos.remove.confirm')}
        confirmLabel={t('cpage.photos.remove')}
        danger
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const photo = asking?.what === 'photo' ? asking.photo : null;
          setAsking(null);
          if (photo) void change('photo', () => api.publicPage.removePhoto(photo.id), t('cpage.photos.removed'));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  heading: { fontWeight: 700, fontSize: 18 },
  score: { fontWeight: 700, fontSize: 22 },
  bullet: { flexDirection: 'row', gap: Spacing.two, paddingStart: Spacing.one },
  qr: { alignItems: 'center', paddingVertical: Spacing.two },
  centred: { textAlign: 'center' },
  photo: { gap: Spacing.two, marginTop: Spacing.two },
});
