import Ionicons from '@expo/vector-icons/Ionicons';
import { PUBLIC_PHOTO_CAPTIONS, type PublicPhotoCaption, type PublicPhotoDto } from '@eccs/shared';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { Notice } from '@/components/ui/notice';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { CameraPermissionError, takeEvidencePhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';

/** The photo taken specially for the page has no id yet; its caption is kept under this name. */
const NEW = 'new';

const STATUS_ICON = { PROPOSED: 'time', APPROVED: 'checkmark-circle', REJECTED: 'close-circle' } as const;

/**
 * Where the ECCS Supervisor proposes photos for a restaurant's customer page:
 * from the photos of a visit or inspection they have finished, or by taking one
 * for the purpose. Each needs a caption from a short fixed list, so nothing
 * anyone types can appear on a public page. ECCS's office then approves or
 * rejects each one in the console; what happened to each is listed underneath.
 *
 * Opened from a finished visit or inspection, with `outletId` and either
 * `visitId` or `inspectionId`.
 */
export default function ProposePhotosScreen() {
  const theme = useTheme();
  const { t, api } = useSession();
  const notify = useSnackbar();
  const params = useLocalSearchParams<{ outletId: string; visitId?: string; inspectionId?: string }>();
  const { outletId, visitId, inspectionId } = params;

  // The photos of the visit or inspection, and everything this Supervisor has proposed at the outlet.
  const [sources, setSources] = useState<{ id: string; path: string }[] | null>(null);
  const [proposed, setProposed] = useState<PublicPhotoDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Record<string, PublicPhotoCaption>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ at: string; message: string } | null>(null);

  const load = useCallback(async () => {
    if (!outletId) return;
    try {
      const [photos, mine] = await Promise.all([
        visitId
          ? api.visits.get(visitId).then((visit) => visit.photos)
          : inspectionId
            ? api.inspections
                .get(inspectionId)
                .then((inspection) => inspection.sections.flatMap((section) => section.checks.flatMap((check) => check.photos)))
            : Promise.resolve([]),
        api.publicPage.photos({ outletId }),
      ]);
      setSources(photos.map((photo) => ({ id: photo.id, path: photo.path })));
      setProposed(mine);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, visitId, inspectionId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Sends one proposal and adds the answer to the list underneath. */
  async function send(at: string, action: () => Promise<PublicPhotoDto>) {
    if (busy !== null) return;
    setBusy(at);
    setFailed(null);
    try {
      const made = await action();
      setProposed((current) => [made, ...current]);
      notify(t('cpage.propose.done'));
    } catch (e) {
      setFailed({ at, message: errorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  async function takeNew() {
    const caption = captions[NEW];
    if (!outletId || !caption || busy !== null) return;
    let photo;
    try {
      photo = await takeEvidencePhoto();
    } catch (e) {
      setFailed({ at: NEW, message: t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic') });
      return;
    }
    if (!photo) return;
    const taken = photo;
    await send(NEW, () => api.publicPage.proposeNew(outletId, caption, taken.file, { capturedAt: new Date().toISOString(), facts: taken.facts }));
  }

  /** The six things a photo can show, as one-tap choices. */
  const captionChoice = (key: string) => (
    <View style={styles.choice}>
      <ThemedText type="smallBold">{t('cpage.propose.what')}</ThemedText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('cpage.propose.what')}>
        {PUBLIC_PHOTO_CAPTIONS.map((caption) => (
          <OptionChip
            key={caption}
            label={t(`public.photo.${caption}`)}
            selected={captions[key] === caption}
            disabled={busy !== null}
            onPress={() => setCaptions((current) => ({ ...current, [key]: caption }))}
          />
        ))}
      </View>
    </View>
  );

  /** Where a proposal stands, with its own icon and word, never colour alone. */
  const status = (photo: PublicPhotoDto) => {
    const color = photo.status === 'APPROVED' && !photo.removed ? theme.primary : photo.status === 'REJECTED' ? theme.danger : theme.textSecondary;
    return (
      <View style={styles.status}>
        <Ionicons name={STATUS_ICON[photo.status]} size={22} color={color} />
        <View style={styles.grow}>
          <ThemedText type="smallBold" style={{ color }}>
            {t(`public.photo.${photo.caption}`)} · {t(photo.removed ? 'cpage.propose.removed' : `cpage.propose.status.${photo.status}`)}
          </ThemedText>
          {photo.rejectReason && <ThemedText type="small">{t('cpage.propose.reason', { reason: photo.rejectReason })}</ThemedText>}
        </View>
      </View>
    );
  };

  const bySource = new Map(proposed.filter((photo) => photo.sourcePhotoId).map((photo) => [photo.sourcePhotoId!, photo]));
  // Proposals not shown beside a photo above: those taken specially, and those from other visits.
  const others = proposed.filter((photo) => !sources?.some((source) => source.id === photo.sourcePhotoId));

  return (
    <Screen back title={t('cpage.propose.title')} about={t('cpage.propose.help')} onRefresh={load}>
      {/* The rule comes first and stays in plain sight: it is what ECCS's office will judge each photo by. */}
      <Notice tone="warning" title={t('cpage.propose.rule')} />

      <ErrorText message={error} onRetry={() => void load()} />
      {sources === null && !error && <ActivityIndicator color={theme.primary} />}

      {sources !== null && (visitId || inspectionId) && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t(visitId ? 'cpage.propose.fromVisit' : 'cpage.propose.fromInspection')}
          </ThemedText>
          {sources.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('cpage.propose.none')}
            </ThemedText>
          )}
          {sources.map((source, index) => {
            const already = bySource.get(source.id);
            return (
              <Card key={source.id}>
                <ProofPhoto uri={api.fileUrl(source.path)} label={t('visit.photoNumber', { title: t('cpage.propose.title'), number: index + 1, total: sources.length })} />
                {already ? (
                  status(already)
                ) : (
                  <>
                    {captionChoice(source.id)}
                    <Button
                      icon="send"
                      label={t('cpage.propose.send')}
                      loading={busy === source.id}
                      disabled={!captions[source.id] || (busy !== null && busy !== source.id)}
                      onPress={() => {
                        const caption = captions[source.id];
                        if (caption) void send(source.id, () => api.publicPage.propose(source.id, caption));
                      }}
                    />
                    <ErrorText message={failed?.at === source.id ? failed.message : null} />
                  </>
                )}
              </Card>
            );
          })}
        </>
      )}

      {sources !== null && (
        <Card>
          {captionChoice(NEW)}
          <Button
            icon="camera"
            label={t('cpage.propose.take')}
            variant="secondary"
            loading={busy === NEW}
            disabled={!captions[NEW] || (busy !== null && busy !== NEW)}
            onPress={() => void takeNew()}
          />
          <ErrorText message={failed?.at === NEW ? failed.message : null} />
        </Card>
      )}

      {others.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('cpage.propose.mine')}
          </ThemedText>
          {others.map((photo) => (
            <Card key={photo.id}>
              <ProofPhoto uri={api.fileUrl(photo.path)} label={t(`public.photo.${photo.caption}`)} compact />
              {status(photo)}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  choice: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
});
