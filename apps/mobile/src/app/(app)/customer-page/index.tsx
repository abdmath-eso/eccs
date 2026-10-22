import Ionicons from '@expo/vector-icons/Ionicons';
import {
  localize,
  PUBLIC_PAGE_RULES,
  type PublicCheckResult,
  type PublicPageDto,
  type PublicPageSettingsDto,
  type PublicPageState,
  type PublicPhotoDto,
} from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Share, StyleSheet, Switch, View } from 'react-native';

import { ProofPhoto } from '@/components/proof-photo';
import { QrCode } from '@/components/qr-code';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Expandable } from '@/components/ui/expandable';
import { Notice } from '@/components/ui/notice';
import { OutletPicker } from '@/components/ui/outlet-picker';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatDayLong } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Each state has its own icon as well as its sentence, never colour alone.
const STATE_ICON: Record<PublicPageState, IconName> = {
  LIVE: 'checkmark-circle',
  OFF: 'eye-off',
  TAKEN_DOWN: 'hand-left',
  INACTIVE: 'eye-off',
};

// Yesterday's result for a checklist, with the same four pictures the customer's page draws.
const RESULT_ICON: Record<PublicCheckResult, IconName> = {
  ON_TIME: 'checkmark',
  LATE: 'time-outline',
  NOT_DONE: 'close',
  NOT_DUE: 'remove',
};

// What turning the page on publishes, in the order the customer's page shows it.
const PUBLISHED = [
  'cpage.switch.item1',
  'cpage.switch.item7',
  'cpage.switch.item8',
  'cpage.switch.item3',
  'cpage.switch.item6',
  'cpage.switch.item2',
  'cpage.switch.item4',
  'cpage.switch.item5',
] as const;

// The three sentences at the end of every customer's page. A short form of them sits under the score.
const DISCLAIMER = ['public.disclaimer.private', 'public.disclaimer.notGov', 'public.disclaimer.own'] as const;

const PART_LABEL = {
  inspection: 'score.part.inspection',
  licences: 'score.part.licences',
  checklists: 'public.score.part.checklists',
} as const;

/** Points as they are: a whole number, or one decimal place when there is one. */
const points = (value: number) => String(Math.round(value * 10) / 10);

/**
 * The restaurant's customer page: the public web page a diner opens from a QR
 * code. The Owner turns it on or off here, sees what a diner sees, shows or
 * shares the QR code, makes a new link, and removes photos. The Manager sees
 * the same but changes nothing, except that both can put forward photos from
 * the outlet's own daily checks.
 *
 * Since 13 Oct 2026 the page can be switched on before ECCS has inspected: it
 * shows yesterday's hygiene score, the daily checklists and photos, and ECCS's
 * inspection once there is one.
 *
 * The order of the screen (13 Oct 2026, after the founder found it "too much text
 * and too long", with the main part far down): where the page stands and its
 * switch, then the photos, then the QR code with its buttons. Everything that
 * only explains (what customers see, what the page shows and never shows, the
 * disclaimer) is one line each at the end that opens when tapped. Main controls
 * first and detail on request is what guidance for small screens asks for
 * (Nielsen Norman Group on progressive disclosure and on accordions on mobile;
 * Material's expansion panels).
 *
 * While the page is off, its main (filled) button is the one that turns it on,
 * and sharing and printing the code are grey until it is on (22 Oct 2026): a
 * screen's strongest button is the next step that makes sense (Material 3's
 * one filled button per screen), and a code that leads nowhere is not it.
 *
 * Other patterns kept from before: one switch that takes effect at once, with
 * what it publishes said in the question asked before it is turned on (Material's
 * guidance for switches); the QR code on white with Share under it (the "my QR
 * code" screens of payment and messaging apps); and "make a new link", which
 * kills the old one, behind a warning (WhatsApp's "Reset link" for group invites).
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
  const heading = (text: string) => (
    <ThemedText type="default" style={styles.heading}>
      {text}
    </ThemedText>
  );

  /** Whether ECCS's inspection is on the page: told as information, since the page shows without one. */
  const inspectionLine = (settings: PublicPageSettingsDto) => {
    const { state, date, shownUntil } = settings.inspection;
    if (state === 'NONE' || !date) return t('cpage.inspection.NONE');
    if (state === 'CURRENT') return t('cpage.inspection.CURRENT', { date: formatDate(date, language), until: formatDate(shownUntil ?? date, language) });
    return t('cpage.inspection.EXPIRED', { date: formatDate(date, language), days: PUBLIC_PAGE_RULES.inspectionValidDays });
  };

  /** The score exactly as a customer is given it: the day, the number, what is not in it, and the three parts. */
  const scorePreview = (preview: PublicPageDto) => {
    const score = preview.score;
    if (!score) return <ThemedText type="small">{t('public.score.none', { days: PUBLIC_PAGE_RULES.scoreWithinDays })}</ThemedText>;
    return (
      <>
        <ThemedText type="small" themeColor="textSecondary">
          {t(score.isYesterday ? 'public.score.forYesterday' : 'public.score.forEarlier', { date: formatDayLong(score.date, language) })}
        </ThemedText>
        {score.provisional && score.inspection !== 'COUNTED' && (
          <Notice tone="warning" title={`${t(`public.score.noInspection.${score.inspection}`)} ${t('public.score.onlyOwn')}`} />
        )}
        <ThemedText type="default" style={styles.score}>
          {t('public.inspection.score', { score: score.score })} · {t(`score.band.${score.band}`)}
        </ThemedText>
        {score.parts.map((part) => (
          <ThemedText key={part.key} type="small">
            {t(PART_LABEL[part.key])}: {part.measured ? t('score.points', { earned: points(part.earned), max: points(part.max) }) : t('public.score.notCounted')}
          </ThemedText>
        ))}
      </>
    );
  };

  const body = () => {
    if (!page) return null;
    const preview = page.preview;
    const live = page.state === 'LIVE';
    const stateColor = live ? theme.primary : page.state === 'TAKEN_DOWN' ? theme.warning : theme.textSecondary;
    // While the page is off, turning it on is the main step: a filled button under the switch says so in words.
    const offerOn = page.state === 'OFF' && page.canSwitch;

    return (
      <>
        {/* Where the page stands, and the switch that changes it: together, and first. */}
        <Card borderColor={stateColor}>
          <View style={styles.row}>
            <Ionicons name={STATE_ICON[page.state]} size={28} color={stateColor} />
            <ThemedText type="default" style={[styles.grow, styles.bold]}>
              {t(`cpage.state.${page.state}`)}
            </ThemedText>
            {busy === 'switch' ? (
              <ActivityIndicator color={theme.primary} />
            ) : (
              <Switch
                accessibilityLabel={t('cpage.switch.label')}
                value={page.enabled}
                disabled={!page.canSwitch || busy !== null || (page.takenDown && !page.enabled)}
                // Turning it on publishes the restaurant's score, so that way round is asked first.
                onValueChange={(next) => (next ? setAsking({ what: 'on' }) : setEnabled(false))}
                trackColor={{ true: theme.primary, false: theme.outline }}
              />
            )}
          </View>
          {offerOn && (
            <Button
              icon="eye-outline"
              label={t('cpage.switch.turnOn')}
              disabled={busy !== null}
              onPress={() => setAsking({ what: 'on' })}
            />
          )}
          <ErrorText message={errorAt('switch')} />
          {!page.canSwitch && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('cpage.switch.ownerOnly')}
            </ThemedText>
          )}
        </Card>

        {/* The photos: what the Owner comes back to most often, so they come before the code. */}
        <Card>
          {heading(t('cpage.photos.title'))}
          {/* The restaurant's own photos: chosen one by one on the next screen, never published by themselves. */}
          {page.canPropose && (
            <Button
              icon="images-outline"
              label={t('cpage.photos.add')}
              hint={t('cpage.photos.addHint', { days: PUBLIC_PAGE_RULES.checkPhotoDays })}
              variant="secondary"
              onPress={() => router.push({ pathname: '/customer-page/from-checks', params: { outletId: page.outletId } })}
            />
          )}
          {page.photosWaiting > 0 && <ThemedText type="smallBold">{t('cpage.photos.waiting', { count: page.photosWaiting })}</ThemedText>}
          {page.photos.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('cpage.photos.none')}
            </ThemedText>
          )}
          <ErrorText message={errorAt('photo')} />
          {/* One line per photo: a small picture that opens whole when tapped, and what a customer reads under it. */}
          {page.photos.map((photo) => (
            <View key={photo.id} style={styles.row}>
              <ProofPhoto uri={api.fileUrl(photo.path)} label={t(`public.photo.${photo.caption}`)} compact />
              <View style={styles.photoText}>
                <ThemedText type="smallBold">{t(`public.photo.${photo.caption}`)}</ThemedText>
                <ThemedText type="small">{t('public.photos.takenOn', { date: formatDate(photo.takenOn, language) })}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t(photo.source === 'DAILY_CHECK' ? 'public.photos.by.RESTAURANT' : 'public.photos.by.ECCS')}
                </ThemedText>
                {!photo.shown && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('cpage.photos.notShown', { count: PUBLIC_PAGE_RULES.maxPhotos })}
                  </ThemedText>
                )}
                {page.canSwitch && (
                  <View style={styles.start}>
                    <Button
                      icon="trash-outline"
                      label={t('cpage.photos.remove')}
                      variant="link"
                      disabled={busy !== null}
                      onPress={() => setAsking({ what: 'photo', photo })}
                    />
                  </View>
                )}
              </View>
            </View>
          ))}
        </Card>

        {/* The code itself: black on white whatever the theme, so it scans off this screen too. */}
        <Card>
          {heading(t('cpage.qr.title'))}
          <ThemedText type="small" themeColor="textSecondary">
            {t('cpage.qr.hint')}
          </ThemedText>
          {page.localOnly && <Notice tone="warning" text={t('cpage.local')} />}
          <View style={styles.qr}>
            <QrCode value={page.url} size={200} label={t('cpage.qr.label')} />
          </View>
          {!live && (
            <View style={styles.offNote}>
              <Ionicons name="information-circle-outline" size={20} color={theme.textSecondary} />
              <ThemedText type="smallBold" style={styles.grow}>
                {t('cpage.qr.offNote')}
              </ThemedText>
            </View>
          )}
          {/* Sharing is the main step only once the page is on; until then the code leads nowhere. */}
          <Button
            icon="share-social-outline"
            label={t('cpage.qr.share')}
            variant={live ? 'primary' : 'secondary'}
            onPress={() => void shareLink()}
          />
          <ErrorText message={errorAt('share')} />
          {/* The poster is a web page with its own Print button; the phone's browser prints or saves it. */}
          <Button icon="print-outline" label={t('cpage.qr.print')} variant="secondary" onPress={() => void Linking.openURL(`${page.url}/poster`)} />
          {live && <Button icon="open-outline" label={t('cpage.preview.open')} variant="secondary" onPress={() => void Linking.openURL(page.url)} />}

          {page.canSwitch && (
            <>
              <Button
                icon="refresh"
                label={t('cpage.newLink.button')}
                hint={t('cpage.newLink.help')}
                variant="link"
                loading={busy === 'link'}
                disabled={busy !== null && busy !== 'link'}
                onPress={() => setAsking({ what: 'link' })}
              />
              <ErrorText message={errorAt('link')} />
            </>
          )}
        </Card>

        {/* From here down, explanations: one line each that opens when tapped. */}

        {/* What a diner sees now, or would see if the page were on. */}
        <Expandable title={t('cpage.preview.title')} icon="eye-outline">
          {preview ? (
            <>
              {scorePreview(preview)}

              <ThemedText type="smallBold" style={styles.gap}>
                {t('public.checks.heading')}
              </ThemedText>
              {preview.checklists.length === 0 && <ThemedText type="small">{t('public.checks.none')}</ThemedText>}
              {preview.checklists.map((list, index) => (
                <View key={index} style={styles.result}>
                  <Ionicons name={RESULT_ICON[list.result]} size={20} color={theme.text} />
                  <ThemedText type="small" style={styles.grow}>
                    {localize(list.name, language)}: {t(`public.checks.result.${list.result}`)}
                  </ThemedText>
                </View>
              ))}
              <ThemedText type="small">
                {preview.selfChecks
                  ? t('cpage.preview.self', { done: preview.selfChecks.handedIn, days: preview.selfChecks.days })
                  : t('public.self.none')}
              </ThemedText>

              <ThemedText type="smallBold" style={styles.gap}>
                {t('public.inspection.heading')}
              </ThemedText>
              {preview.inspection && (
                <>
                  <ThemedText type="small">
                    {t('cpage.preview.score', { score: preview.inspection.score })} · {t(`public.inspection.grade.${preview.inspection.grade}`)}
                  </ThemedText>
                  <ThemedText type="small">
                    {t('cpage.preview.inspected', {
                      date: formatDate(preview.inspection.date, language),
                      number: ltrText(preview.inspection.reportNumber),
                    })}
                  </ThemedText>
                </>
              )}
              <ThemedText type="small" themeColor="textSecondary">
                {inspectionLine(page)}
              </ThemedText>

              <ThemedText type="small" style={styles.gap}>
                {t('cpage.preview.services', { count: preview.services.length })}
              </ThemedText>
              <ThemedText type="small">{t('cpage.preview.photos', { count: preview.photos.length })}</ThemedText>
            </>
          ) : (
            <ThemedText type="default" themeColor="textSecondary">
              {t('cpage.preview.none')}
            </ThemedText>
          )}
        </Expandable>

        {/* Exactly what turning the page on publishes. The question asked before it is turned on says the same in short. */}
        <Expandable title={t('cpage.shows.title')} icon="list-outline">
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
            {t('cpage.switch.lapse', { days: PUBLIC_PAGE_RULES.inspectionValidDays, photoDays: PUBLIC_PAGE_RULES.photoShownDays })}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('cpage.photos.help', { days: PUBLIC_PAGE_RULES.photoShownDays })}
          </ThemedText>
        </Expandable>

        {/* The disclaimer a customer reads with the score, shown here so the Owner knows it is on the page. */}
        <Expandable title={t('cpage.disclaimer.title')} icon="information-circle-outline">
          <ThemedText type="smallBold">{t('public.gov.heading')}</ThemedText>
          <ThemedText type="small">{t('public.disclaimer.short')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('cpage.disclaimer.help')}
          </ThemedText>
          {DISCLAIMER.map((key) => (
            <ThemedText key={key} type="small">
              {t(key)}
            </ThemedText>
          ))}
        </Expandable>
      </>
    );
  };

  return (
    <Screen back title={t('cpage.title')} about={t('cpage.help')} onRefresh={load}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  bold: { fontWeight: 700 },
  // Beside a small picture: the words, and under them the button, which starts where the words start.
  photoText: { flex: 1, gap: Spacing.half },
  start: { alignItems: 'flex-start' },
  heading: { fontWeight: 700, fontSize: 18 },
  score: { fontWeight: 700, fontSize: 22 },
  result: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  gap: { marginTop: Spacing.two },
  bullet: { flexDirection: 'row', gap: Spacing.two, paddingStart: Spacing.one },
  qr: { alignItems: 'center', paddingVertical: Spacing.two },
  // Left-aligned with a mark, like the notes elsewhere: centred, its last word sat alone on a line.
  offNote: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
});
