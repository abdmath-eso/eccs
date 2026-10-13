import Ionicons from '@expo/vector-icons/Ionicons';
import {
  formatDistance,
  localize,
  PUBLIC_PAGE_RULES,
  PUBLIC_PHOTO_CAPTIONS,
  type PublicCheckPhotoDto,
  type PublicCheckPhotosDto,
  type PublicPhotoCaption,
  type PublicPhotoDto,
} from '@eccs/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { errorMessage } from '@/lib/errors';
import { formatDayLong } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** A weak phone is shown this many photos at first, and as many again each time "Show more" is pressed. */
const PAGE = 12;

/**
 * Where the restaurant's Owner (or Manager) puts forward photos for the customer
 * page from the outlet's own daily checks: the proof photos of checks that were
 * marked OK, in checklists handed in during the last 14 days.
 *
 * Nothing here is published by itself. A person picks one photo, says what it
 * shows from a short fixed list (so nothing anyone types can appear on a public
 * page), reads the rule and that ECCS will look at it, and sends it. ECCS's
 * office then approves it or not; what became of each is listed underneath.
 *
 * Built the way apps let people choose from pictures they already have: a
 * gallery of what is eligible, newest first under a heading per day (the
 * phone's own photo gallery), one picture picked at a time with what is needed
 * to send it opening in place, and the status of each sent picture in words
 * with its own icon (the three statuses Google Business Profile gives an
 * owner's photos: "Pending", "Not approved" and "Live"). The rule and the
 * review sentence sit beside the Send button, where the decision is made, not
 * on an earlier screen.
 *
 * A photo taken far from the place saved for the outlet is still offered, with
 * the distance said beside it; ECCS sees the same distance when it decides. The
 * few kinds that are never offered (a picture used before, a phone time before
 * the day of the check, a faked location) are counted under the list with the
 * reasons. Before 13 Oct 2026 all of these were left out without a word, and
 * the founder, testing away from the sample outlet, found an empty screen.
 *
 * Opened from the customer page screen with `outletId`.
 */
export default function PhotosFromChecksScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const params = useLocalSearchParams<{ outletId?: string }>();
  const own = useOutlet();
  const outletId = params.outletId || own.outletId;

  const [photos, setPhotos] = useState<PublicCheckPhotosDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The one photo being sent, and what it has been said to show.
  const [chosen, setChosen] = useState<string | null>(null);
  const [caption, setCaption] = useState<PublicPhotoCaption | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [showing, setShowing] = useState(PAGE);

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      setPhotos(await api.publicPage.checkPhotos(outletId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function choose(photo: PublicCheckPhotoDto | null) {
    setChosen(photo?.attachmentId ?? null);
    setCaption(null);
    setFailed(null);
  }

  /** Sends the chosen photo to ECCS, then moves it from the gallery to the list underneath. */
  async function send(photo: PublicCheckPhotoDto) {
    if (!outletId || !caption || sending) return;
    setSending(true);
    setFailed(null);
    try {
      const made = await api.publicPage.proposeFromCheck(outletId, photo.attachmentId, caption);
      setPhotos((current) =>
        current && {
          ...current,
          eligible: current.eligible.filter((entry) => entry.attachmentId !== photo.attachmentId),
          proposed: [made, ...current.proposed],
        },
      );
      choose(null);
      notify(t('cpage.propose.done'));
    } catch (e) {
      setFailed(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  }

  /** Where a photo that was put forward stands, with its own icon and words, never colour alone. */
  const standing = (photo: PublicPhotoDto): { icon: IconName; color: string; text: string } => {
    if (photo.status === 'PROPOSED') return { icon: 'time', color: theme.textSecondary, text: t('cpage.propose.status.PROPOSED') };
    if (photo.status === 'REJECTED') return { icon: 'close-circle', color: theme.danger, text: t('cpage.propose.status.REJECTED') };
    if (photo.removed) return { icon: 'trash', color: theme.textSecondary, text: t('cpage.propose.removed') };
    if (photo.expired) return { icon: 'calendar', color: theme.textSecondary, text: t('cpage.checks.status.expired', { days: PUBLIC_PAGE_RULES.photoShownDays }) };
    if (photo.shown) return { icon: 'checkmark-circle', color: theme.primary, text: t('cpage.checks.status.shown') };
    return { icon: 'eye-off', color: theme.textSecondary, text: t('cpage.photos.notShown', { count: PUBLIC_PAGE_RULES.maxPhotos }) };
  };

  const card = [styles.card, { borderColor: theme.border }];
  const eligible = photos?.eligible ?? [];
  const visible = eligible.slice(0, showing);

  return (
    <Screen back title={t('cpage.checks.title')} subtitle={t('cpage.checks.help')} onRefresh={load}>
      {/* The rule comes first and stays in plain sight: it is what ECCS's office will judge each photo by. */}
      <View style={[styles.card, styles.row, { borderColor: theme.warning }]}>
        <Ionicons name="alert-circle" size={24} color={theme.warning} />
        <ThemedText type="default" style={[styles.grow, styles.bold]}>
          {t('cpage.propose.rule')}
        </ThemedText>
      </View>
      <ErrorText message={error} onRetry={() => void load()} />
      {photos === null && !error && <ActivityIndicator color={theme.primary} />}

      {photos !== null && !photos.canPropose && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('cpage.checks.ownerOnly')}
        </ThemedText>
      )}
      {photos !== null && eligible.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('cpage.checks.none')}
        </ThemedText>
      )}

      {visible.map((photo, index) => {
        const picked = chosen === photo.attachmentId;
        const checklist = localize(photo.checklist, language);
        const check = localize(photo.check, language);
        return (
          <View key={photo.attachmentId} style={styles.entry}>
            {/* One heading per day, the newest day first. */}
            {photo.date !== visible[index - 1]?.date && (
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.day}>
                {formatDayLong(photo.date, language)}
              </ThemedText>
            )}
            <View style={[styles.card, { borderColor: picked ? theme.primary : theme.border }]}>
              <View style={styles.row}>
                {/* Tapping the picture shows it whole: look for people, faces and name badges before sending. */}
                <ProofPhoto uri={api.fileUrl(photo.path)} label={`${checklist}. ${check}`} compact />
                <View style={styles.grow}>
                  <ThemedText type="smallBold">{checklist}</ThemedText>
                  <ThemedText type="small">{check}</ThemedText>
                </View>
              </View>
              {/* `typeof`, not a comparison with null: an API older than this app sends no distance at all. */}
              {typeof photo.farMetres === 'number' && (
                <View style={styles.status}>
                  <Ionicons name="location-outline" size={20} color={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                    {t('cpage.checks.far', { distance: ltrText(formatDistance(photo.farMetres)) })}
                  </ThemedText>
                </View>
              )}

              {photos?.canPropose && !picked && (
                <Button
                  icon="add-circle-outline"
                  label={t('cpage.checks.choose')}
                  variant="secondary"
                  disabled={sending}
                  onPress={() => choose(photo)}
                />
              )}

              {picked && (
                <>
                  <ThemedText type="smallBold">{t('cpage.propose.what')}</ThemedText>
                  <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('cpage.propose.what')}>
                    {PUBLIC_PHOTO_CAPTIONS.map((entry) => (
                      <OptionChip
                        key={entry}
                        label={t(`public.photo.${entry}`)}
                        selected={caption === entry}
                        disabled={sending}
                        onPress={() => setCaption(entry)}
                      />
                    ))}
                  </View>
                  {/* Said at the moment of sending: ECCS does not otherwise see a restaurant's checklist photos. */}
                  <View style={[styles.note, { borderColor: theme.warning }]}>
                    <ThemedText type="smallBold">{t('cpage.checks.review')}</ThemedText>
                    <ThemedText type="small">{t('cpage.propose.rule')}</ThemedText>
                  </View>
                  <Button icon="send" label={t('cpage.checks.send')} loading={sending} disabled={!caption} onPress={() => void send(photo)} />
                  <ErrorText message={failed} />
                  <Button label={t('common.cancel')} variant="link" disabled={sending} onPress={() => choose(null)} />
                </>
              )}
            </View>
          </View>
        );
      })}

      {eligible.length > showing && (
        <Button icon="chevron-down" label={t('cpage.checks.more')} variant="secondary" onPress={() => setShowing((current) => current + PAGE)} />
      )}

      {/* Photos that are never offered are counted here with the reasons, so a missing photo is not a mystery. */}
      {photos !== null && photos.leftOut > 0 && (
        <View style={styles.status}>
          <Ionicons name="information-circle-outline" size={20} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
            {t('cpage.checks.leftOut', { count: photos.leftOut })}
          </ThemedText>
        </View>
      )}
      {/* Which photos are listed, and that ECCS sees no others: under the photos, so the photos come first. */}
      {photos !== null && eligible.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('cpage.checks.which', { days: PUBLIC_PAGE_RULES.checkPhotoDays })} {t('cpage.checks.reviewMore')}
        </ThemedText>
      )}

      {photos !== null && photos.proposed.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('cpage.checks.sent')}
          </ThemedText>
          {photos.proposed.map((photo) => {
            const now = standing(photo);
            return (
              <View key={photo.id} style={[card, styles.row]}>
                <ProofPhoto uri={api.fileUrl(photo.path)} label={t(`public.photo.${photo.caption}`)} compact />
                <View style={styles.grow}>
                  <ThemedText type="smallBold">{t(`public.photo.${photo.caption}`)}</ThemedText>
                  <View style={styles.status}>
                    <Ionicons name={now.icon} size={20} color={now.color} />
                    <ThemedText type="small" style={[styles.grow, { color: now.color }]}>
                      {now.text}
                    </ThemedText>
                  </View>
                  {photo.rejectReason && <ThemedText type="small">{t('cpage.propose.reason', { reason: photo.rejectReason })}</ThemedText>}
                </View>
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  bold: { fontWeight: 700 },
  grow: { flex: 1 },
  entry: { gap: Spacing.two },
  day: { marginTop: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  note: { borderWidth: 2, borderRadius: Spacing.two, padding: Spacing.two, gap: Spacing.one },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  sectionGap: { marginTop: Spacing.four },
});
