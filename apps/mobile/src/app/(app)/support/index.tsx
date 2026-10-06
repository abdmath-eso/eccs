import Ionicons from '@expo/vector-icons/Ionicons';
import { ISSUE_CATEGORIES, type IssueCategory, type IssueSummaryDto, type SupportContactDto } from '@eccs/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { IssueStatusBadge } from '@/components/issue-status-badge';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
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
 * The one place a restaurant reaches ECCS: a form to raise an issue, buttons
 * to call or WhatsApp ECCS directly, and the issues raised recently.
 */
export default function RaiseIssueScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState<IssueCategory | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [contact, setContact] = useState<SupportContactDto | null>(null);
  const [issues, setIssues] = useState<IssueSummaryDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          setLoadError(null);
        } catch (e) {
          if (!cancelled) setLoadError(errorMessage(e, t));
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]),
  );

  async function addPhoto() {
    if (!outletId) return;
    setFormError(null);
    let photo;
    try {
      photo = await takeProofPhoto();
    } catch (e) {
      setFormError(t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic'));
      return;
    }
    if (!photo) return;

    setUploading(true);
    try {
      const uploaded = await api.attachments.upload({
        outletId,
        file: photo.file,
        capturedAt: new Date().toISOString(),
      });
      setPhotos((current) => [...current, { id: uploaded.id, uri: photo.uri }]);
    } catch (e) {
      setFormError(errorMessage(e, t, { 0: 'error.upload' }));
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    if (!outletId || !category) return;
    setSending(true);
    setFormError(null);
    try {
      const issue = await api.issues.create({
        outletId,
        category,
        description: description.trim(),
        attachmentIds: photos.map((photo) => photo.id),
      });
      // Clear and close the form, then show the new issue as confirmation. Coming back here reloads the list.
      setFormOpen(false);
      setCategory(null);
      setDescription('');
      setPhotos([]);
      router.push({
        pathname: '/support/[issueId]',
        params: { issueId: issue.id },
      });
    } catch (e) {
      setFormError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  }

  const option = (selected: boolean) => [
    styles.option,
    { borderColor: selected ? theme.primary : theme.border },
    selected && { backgroundColor: theme.backgroundElement },
  ];
  const severalOutlets = new Set(issues?.map((issue) => issue.outletId)).size > 1;

  return (
    <Screen back title={t('support.title')} subtitle={t('support.help')}>
      {/* ── The form, tucked behind a button so the page opens clean ── */}
      {!formOpen && <Button label={t('support.title')} onPress={() => setFormOpen(true)} />}

      {formOpen && (
        <View style={[styles.form, { borderColor: theme.border }]}>
          {outletLoading && <ActivityIndicator color={theme.primary} />}

          {outlets.length > 1 && (
            <>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('checklists.chooseOutlet')}
              </ThemedText>
              <View style={styles.options}>
                {outlets.map((outlet) => (
                  <Pressable
                    key={outlet.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: outlet.id === outletId }}
                    onPress={() => {
                      // Photos are stored per outlet, so changing outlet starts them again.
                      setPhotos([]);
                      choose(outlet.id);
                    }}
                    style={option(outlet.id === outletId)}>
                    <ThemedText type="default" themeColor={outlet.id === outletId ? 'primary' : 'text'}>
                      {outlet.name}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('support.category')}
          </ThemedText>
          <View style={styles.options}>
            {ISSUE_CATEGORIES.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: category === value }}
                onPress={() => setCategory(value)}
                style={option(category === value)}>
                <ThemedText type="default" themeColor={category === value ? 'primary' : 'text'}>
                  {t(`category.${value}`)}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <TextField
            label={t('support.describe')}
            value={description}
            onChangeText={setDescription}
            placeholder={t('support.describePlaceholder')}
            maxLength={1000}
            multiline
            style={styles.description}
          />

          {photos.length > 0 && (
            <View style={styles.photos}>
              {photos.map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.uri }}
                  style={[styles.photo, { backgroundColor: theme.backgroundElement }]}
                />
              ))}
            </View>
          )}
          {photos.length < MAX_PHOTOS && (
            <Button
              label={`📷  ${t('support.addPhoto')}`}
              variant="secondary"
              onPress={() => void addPhoto()}
              loading={uploading}
              disabled={!outletId}
            />
          )}

          <ErrorText message={formError} />
          <Button
            label={t('support.send')}
            onPress={() => void send()}
            loading={sending}
            disabled={!outletId || !category || description.trim().length < MIN_DESCRIPTION || uploading}
          />
          <Button label={t('common.cancel')} variant="link" onPress={() => setFormOpen(false)} disabled={sending} />
        </View>
      )}

      {/* ── Contact ECCS directly ── */}
      {contact && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
            {t('support.contactTitle')}
          </ThemedText>
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
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            {contact.phone} · {contact.hours}
          </ThemedText>
        </>
      )}

      {/* ── Recent issues ── */}
      <ErrorText message={loadError} />
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
  option: {
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  description: {
    minHeight: 120,
    paddingVertical: Spacing.two,
    fontSize: 17,
    textAlignVertical: 'top',
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photo: { width: 96, height: 96, borderRadius: Spacing.two },
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
