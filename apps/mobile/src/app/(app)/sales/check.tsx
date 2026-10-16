import Ionicons from '@expo/vector-icons/Ionicons';
import { FREE_CHECK_POINTS, freeCheckToFix, whatsappReminderUrl, type FreeCheckAnswer, type FreeCheckPoint } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pickLeadPhoto } from '@/lib/board-photo';
import { formatDate, indiaToday } from '@/lib/format';
import { discardPhoto, keepPhoto, newId } from '@/lib/offline/files';
import { CameraPermissionError } from '@/lib/photo';
import { queueStep } from '@/lib/sales';
import { useSession } from '@/lib/session';
import { useLead } from '@/lib/use-leads';

type IconName = ComponentProps<typeof Ionicons>['name'];

const ANSWERS: { answer: FreeCheckAnswer; icon: IconName; label: 'bde.check.OK' | 'bde.check.FIX' | 'bde.check.UNSEEN' }[] = [
  { answer: 'OK', icon: 'checkmark-circle', label: 'bde.check.OK' },
  { answer: 'FIX', icon: 'construct', label: 'bde.check.FIX' },
  { answer: 'UNSEEN', icon: 'eye-off', label: 'bde.check.UNSEEN' },
];

interface Photo {
  id: string;
  uri: string;
  takenAt: string;
}

/**
 * The free-check scorecard (B2): a short check a BDE does in a prospect's kitchen to show
 * the owner what ECCS would fix. Ten points on one screen, each OK, Needs fixing or Could
 * not see, a photo on Needs fixing if wanted, and a note. Finishing logs "free check done"
 * on the lead with the number of things to fix (which Likely to close reads) and offers to
 * share the list with the owner on WhatsApp, each item with the ECCS service that fixes it.
 * It is all saved on the phone first, so it works in a kitchen with no signal.
 *
 * PATTERN FOLLOWED: SafetyCulture's inspection templates on the phone: a fixed set of
 * answers per question (Pass, Fail, N/A), a failed answer flagged, a photo and a note on
 * a flagged item, the progress shown and Finish at the bottom (help.safetyculture.com).
 */
export default function FreeCheckScreen() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  const theme = useTheme();
  const { t, language, user } = useSession();
  const { view, error, load } = useLead(leadId);
  const [answers, setAnswers] = useState<Partial<Record<FreeCheckPoint, FreeCheckAnswer>>>({});
  const [photos, setPhotos] = useState<Partial<Record<FreeCheckPoint, Photo>>>({});
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  // Photos taken here, removed from the phone if the check is left without finishing.
  const taken = useRef<{ ids: Set<string>; finished: boolean }>({ ids: new Set(), finished: false });
  useEffect(
    () => () => {
      if (!taken.current.finished) for (const id of taken.current.ids) discardPhoto(id);
    },
    [],
  );

  if (!view) {
    return (
      <Screen back title={t('bde.check.title')}>
        <ErrorText message={error} onRetry={() => void load()} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }
  const lead = view.lead;
  const done = FREE_CHECK_POINTS.filter((point) => answers[point]).length;

  function answer(point: FreeCheckPoint, value: FreeCheckAnswer) {
    setAnswers((current) => ({ ...current, [point]: value }));
    // A photo goes only with Needs fixing.
    if (value !== 'FIX' && photos[point]) {
      discardPhoto(photos[point]!.id);
      setPhotos((current) => ({ ...current, [point]: undefined }));
    }
  }

  async function addPhoto(point: FreeCheckPoint) {
    setProblem(null);
    try {
      const picked = await pickLeadPhoto('camera');
      if (!picked) return;
      const photo: Photo = { id: newId(), uri: picked.uri, takenAt: new Date().toISOString() };
      await keepPhoto(photo.id, picked);
      taken.current.ids.add(photo.id);
      if (photos[point]) discardPhoto(photos[point]!.id);
      setPhotos((current) => ({ ...current, [point]: photo }));
    } catch (e) {
      setProblem(t(e instanceof CameraPermissionError ? 'bde.photo.camera' : 'error.generic'));
    }
  }

  async function finish() {
    if (done < FREE_CHECK_POINTS.length) return setProblem(t('bde.check.answerAll', { count: FREE_CHECK_POINTS.length - done }));
    setSaving(true);
    setProblem(null);
    const card = FREE_CHECK_POINTS.map((point) => ({ point, answer: answers[point]!, ...(photos[point] && { photoId: photos[point]!.id }) }));
    const kept = Object.values(photos).filter((photo): photo is Photo => Boolean(photo));
    try {
      await queueStep(lead.id, { kind: 'CHECK_DONE', scorecard: { answers: card }, note: note.trim() || null }, kept.map((photo) => ({ id: photo.id, capturedAt: photo.takenAt })));
      taken.current.finished = true;
      setFinished(true);
    } catch {
      setProblem(t('bde.form.notStored'));
    }
    setSaving(false);
  }

  const toFix = freeCheckToFix(FREE_CHECK_POINTS.map((point) => ({ point, answer: answers[point] ?? 'OK' })));

  /** The message for the owner, in the BDE's language: what needs fixing and which ECCS service fixes each. Text only. */
  function share() {
    const lines = toFix.map((entry) => `• ${t(`bde.check.point.${entry.point}`)}: ${t(`bde.check.fix.${entry.point}`)}`);
    const text = [
      t('bde.share.hello', { name: lead.contactName ?? lead.businessName }),
      t('bde.share.intro', { business: lead.businessName, date: formatDate(indiaToday(), language) }),
      ...(lines.length > 0 ? [t('bde.share.toFix'), ...lines, t('bde.share.restFine')] : [t('bde.share.allFine')]),
      t('bde.share.signed', { name: user?.name ?? 'ECCS' }),
    ].join('\n');
    // A sample lead's made-up number is never put in the link: WhatsApp then asks who to send it to.
    void Linking.openURL(whatsappReminderUrl(lead.isSample ? null : lead.contactPhone, text)).catch(() => undefined);
  }

  if (finished) {
    return (
      <Screen back title={t('bde.check.doneTitle')} subtitle={lead.businessName}>
        <ThemedText type="default" style={styles.bold}>
          {toFix.length > 0 ? t('bde.check.found', { count: toFix.length }) : t('bde.check.nothing')}
        </ThemedText>
        {toFix.map((entry) => (
          <View key={entry.point} style={styles.fixRow}>
            <Ionicons name="construct" size={18} color={theme.warning} />
            <ThemedText type="default" style={styles.flex}>
              {t(`bde.check.point.${entry.point}`)}
              <ThemedText type="small" themeColor="textSecondary">
                {'\n'}
                {t(`bde.check.fix.${entry.point}`)}
              </ThemedText>
            </ThemedText>
          </View>
        ))}
        <Button icon="logo-whatsapp" label={t('bde.check.share')} onPress={share} />
        {toFix.length > 0 && <Button icon="document-text-outline" label={t('bde.step.quote')} variant="secondary" onPress={() => router.replace({ pathname: '/sales/quote', params: { leadId: lead.id } })} />}
        <Button label={t('common.done')} variant="link" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t('bde.check.title')}
      subtitle={lead.businessName}
      footer={
        <>
          <ErrorText message={problem} />
          <Button
            label={t('bde.check.finish')}
            hint={t('bde.check.progress', { done, total: FREE_CHECK_POINTS.length })}
            icon="checkmark-done"
            loading={saving}
            onPress={() => void finish()}
          />
        </>
      }>
      {FREE_CHECK_POINTS.map((point, index) => (
        <View key={point} style={[styles.point, { borderColor: answers[point] ? theme.border : theme.outline }]}>
          <ThemedText type="default" style={styles.bold}>
            {index + 1}. {t(`bde.check.point.${point}`)}
          </ThemedText>
          <View style={styles.answers} accessibilityRole="radiogroup" accessibilityLabel={t(`bde.check.point.${point}`)}>
            {ANSWERS.map((option) => {
              const selected = answers[point] === option.answer;
              const color = selected ? (option.answer === 'FIX' ? theme.warning : theme.primary) : theme.textSecondary;
              return (
                <Pressable
                  key={option.answer}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, checked: selected }}
                  onPress={() => answer(point, option.answer)}
                  style={({ pressed }) => [
                    styles.answer,
                    { borderColor: selected ? color : theme.outline, backgroundColor: selected || pressed ? theme.backgroundElement : 'transparent' },
                  ]}>
                  <Ionicons name={option.icon} size={22} color={color} />
                  <ThemedText type="small" style={[styles.answerLabel, { color: selected ? color : theme.text }, selected && styles.bold]}>
                    {t(option.label)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          {answers[point] === 'FIX' &&
            (photos[point] ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: photos[point]!.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
                <Button label={t('bde.photo.retake')} variant="link" onPress={() => void addPhoto(point)} />
              </View>
            ) : (
              <Button icon="camera-outline" label={t('bde.check.addPhoto')} variant="link" onPress={() => void addPhoto(point)} />
            ))}
        </View>
      ))}
      <TextField label={t('bde.form.note')} value={note} onChangeText={setNote} maxLength={200} multiline />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: 700 },
  flex: { flex: 1 },
  point: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  answers: { flexDirection: 'row', gap: Spacing.two },
  answer: {
    flex: 1,
    minHeight: MinTouchSize + Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    gap: Spacing.half,
  },
  answerLabel: { textAlign: 'center' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumb: { width: 64, height: 64, borderRadius: Spacing.two },
  fixRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
});
