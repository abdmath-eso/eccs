import Ionicons from '@expo/vector-icons/Ionicons';
import type { UploadFile } from '@eccs/api-client';
import { ISSUE_CATEGORIES, type IssueCategory, type IssueSummaryDto, type SupportContactDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { IssueStatusBadge } from '@/components/issue-status-badge';
import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { CameraPermissionError, takeProofPhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

const MAX_PHOTOS = 4;
const MIN_DESCRIPTION = 5;

/**
 * A photo attached to the issue being written. Its file is kept until the
 * issue is sent, so a failed upload can be sent again without retaking it.
 */
interface AttachedPhoto {
  /** Tells the photos apart on this screen; not the server's id. */
  key: string;
  uri: string;
  file: UploadFile;
  capturedAt: string;
  /** The server's id for the photo, once it is stored there. */
  id?: string;
  status: 'sending' | 'sent' | 'failed';
}

/**
 * The one place a restaurant reaches ECCS: a form to raise an issue, buttons
 * to call or WhatsApp ECCS directly, and the issues raised recently.
 */
export default function RaiseIssueScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState<IssueCategory | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const [sending, setSending] = useState(false);
  // True once Send has been pressed, so what is missing is then marked on each part of the form.
  const [tried, setTried] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const [contact, setContact] = useState<SupportContactDto | null>(null);
  const [issues, setIssues] = useState<IssueSummaryDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [details, list] = await Promise.all([api.support.contact(), api.issues.list()]);
      setContact(details);
      setIssues(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
    // `t` changes with language; reloading for that is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Reloads whenever the screen comes back into view, so a newly raised issue or a reply shows.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Uploads one attached photo to the outlet's storage. Also used to send a failed one again. */
  async function upload(photo: AttachedPhoto, toOutletId: string) {
    setPhotoError(null);
    const mark = (patch: Partial<AttachedPhoto>) =>
      setPhotos((current) => current.map((other) => (other.key === photo.key ? { ...other, ...patch } : other)));
    mark({ status: 'sending', id: undefined });
    try {
      const uploaded = await api.attachments.upload({ outletId: toOutletId, file: photo.file, capturedAt: photo.capturedAt });
      mark({ status: 'sent', id: uploaded.id });
    } catch (e) {
      // The photo stays in the row, marked as not sent, so it can be sent again as it is.
      mark({ status: 'failed' });
      setPhotoError(errorMessage(e, t, { 0: 'error.upload' }));
    }
  }

  async function addPhoto() {
    if (!outletId) return;
    setPhotoError(null);
    let taken;
    try {
      taken = await takeProofPhoto();
    } catch (e) {
      setPhotoError(t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic'));
      return;
    }
    if (!taken) return;
    const capturedAt = new Date().toISOString();
    const photo: AttachedPhoto = { key: `${capturedAt}:${taken.uri}`, uri: taken.uri, file: taken.file, capturedAt, status: 'sending' };
    setPhotos((current) => [...current, photo]);
    await upload(photo, outletId);
  }

  function changeOutlet(nextOutletId: string) {
    if (nextOutletId === outletId) return;
    choose(nextOutletId);
    // Photos are stored per outlet, so the ones already attached are sent again to the new outlet.
    for (const photo of photos) void upload(photo, nextOutletId);
  }

  const photosSending = photos.some((photo) => photo.status === 'sending');
  const photosFailed = photos.filter((photo) => photo.status === 'failed').length;
  const tooShort = description.trim().length < MIN_DESCRIPTION;
  // In words, what the form still needs before it can be sent.
  const stillNeeded = [!category && t('support.neededCategory'), tooShort && t('support.neededWords')].filter(
    (part): part is string => Boolean(part),
  );

  async function send() {
    setTried(true);
    setSendError(null);
    if (!outletId || !category || tooShort || photosSending || photosFailed) return;
    setSending(true);
    try {
      const issue = await api.issues.create({
        outletId,
        category,
        description: description.trim(),
        attachmentIds: photos.flatMap((photo) => (photo.id ? [photo.id] : [])),
      });
      // Clear and close the form, then show the new issue as confirmation. Coming back here reloads the list.
      setFormOpen(false);
      setCategory(null);
      setDescription('');
      setPhotos([]);
      setTried(false);
      notify(t('support.sent'));
      router.push({
        pathname: '/support/[issueId]',
        params: { issueId: issue.id },
      });
    } catch (e) {
      setSendError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  }

  const severalOutlets = new Set(issues?.map((issue) => issue.outletId)).size > 1;

  return (
    <Screen back title={t('support.title')} subtitle={t('support.help')} onRefresh={load}>
      {/* The form, tucked behind a button so the page opens clean. */}
      {!formOpen && <Button label={t('support.title')} onPress={() => setFormOpen(true)} />}

      {formOpen && (
        <View style={[styles.form, { borderColor: theme.border }]}>
          {outletLoading && <ActivityIndicator color={theme.primary} />}

          {outlets.length > 1 && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('checklists.chooseOutlet')}
              </ThemedText>
              <View style={styles.options} accessibilityRole="radiogroup">
                {outlets.map((outlet) => (
                  <OptionChip
                    key={outlet.id}
                    label={outlet.name}
                    selected={outlet.id === outletId}
                    onPress={() => changeOutlet(outlet.id)}
                    // Not while a photo is on its way: it is being stored under the outlet chosen now.
                    disabled={sending || photosSending}
                  />
                ))}
              </View>
            </>
          )}

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('support.category')}
          </ThemedText>
          <View style={styles.options} accessibilityRole="radiogroup">
            {ISSUE_CATEGORIES.map((value) => (
              <OptionChip
                key={value}
                label={t(`category.${value}`)}
                selected={category === value}
                onPress={() => setCategory(value)}
              />
            ))}
          </View>
          {tried && !category && <ErrorText message={t('support.categoryNeeded')} />}

          <TextField
            label={t('support.describe')}
            value={description}
            onChangeText={setDescription}
            placeholder={t('support.describePlaceholder')}
            maxLength={1000}
            multiline
            style={styles.description}
            error={tried && tooShort ? t('support.describeNeeded') : null}
          />

          {photos.length > 0 && (
            <View style={styles.photos}>
              {photos.map((photo) => (
                <ProofPhoto
                  key={photo.key}
                  compact
                  uri={photo.uri}
                  label={t('support.addPhoto')}
                  state={photo.status === 'sent' ? null : photo.status}
                  onRetry={outletId ? () => void upload(photo, outletId) : undefined}
                  onRemove={() => {
                    setPhotos((current) => current.filter((other) => other.key !== photo.key));
                    setPhotoError(null);
                  }}
                />
              ))}
            </View>
          )}
          {/* Beside the photos: what went wrong, and that a tap sends the same photo again. */}
          {photosFailed > 0 && <ErrorText message={t('support.photosNotSent', { count: photosFailed })} />}
          <ErrorText message={photoError} />
          {photos.length < MAX_PHOTOS && (
            <Button
              icon="camera"
              label={t('support.addPhoto')}
              variant="secondary"
              onPress={() => void addPhoto()}
              loading={photosSending}
              disabled={!outletId}
            />
          )}

          {/* Send is never greyed out without a reason: this line says what is still needed. */}
          {stillNeeded.length > 0 && (
            <ThemedText type="small" themeColor={tried ? 'danger' : 'textSecondary'}>
              {t('support.stillNeeded', { list: stillNeeded.join(', ') })}
            </ThemedText>
          )}
          {tried && photosSending && <ErrorText message={t('support.photosSending')} />}
          <ErrorText message={sendError} />
          <Button label={t('support.send')} onPress={() => void send()} loading={sending} />
          <Button label={t('common.cancel')} variant="link" onPress={() => setFormOpen(false)} disabled={sending} />
        </View>
      )}

      {/* Contact ECCS directly. */}
      {contact && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('support.contactTitle')}
          </ThemedText>
          {/* `fill` keeps the two the same height when one label wraps onto a second line. */}
          <View style={styles.contact}>
            <View style={styles.contactButton}>
              <Button
                fill
                icon="call"
                label={t('support.call')}
                variant="secondary"
                onPress={() => void Linking.openURL(`tel:${contact.phone}`)}
              />
            </View>
            <View style={styles.contactButton}>
              <Button
                fill
                icon="logo-whatsapp"
                label={t('support.whatsapp')}
                variant="secondary"
                onPress={() => void Linking.openURL(`https://wa.me/${contact.whatsapp}`)}
              />
            </View>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {contact.phone} · {contact.hours}
          </ThemedText>
        </>
      )}

      {/* Recent issues. */}
      <ErrorText message={loadError} onRetry={() => void load()} />
      {issues === null && !loadError && <ActivityIndicator color={theme.primary} />}

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
          onPress={() =>
            router.push({
              pathname: '/support/[issueId]',
              params: { issueId: issue.id },
            })
          }
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
            },
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
  form: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  description: {
    minHeight: 120,
    paddingVertical: Spacing.two,
    fontSize: 17,
    textAlignVertical: 'top',
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  contact: { flexDirection: 'row', gap: Spacing.two },
  contactButton: { flex: 1 },
  center: { textAlign: 'center' },
  sectionGap: { marginTop: Spacing.four },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    minHeight: MinTouchSize * 1.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  metaText: { flex: 1 },
});
