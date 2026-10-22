import { ApiError } from '@eccs/api-client';
import { AI_ERROR, normalizePhone, type ShopBoardReadingDto } from '@eccs/shared';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AiNote } from '@/components/ai-parts';
import { DocumentPhoto } from '@/components/document-photo';
import { emptyLeadForm, LeadForm, leadFormProblems, phoneInput, type LeadFormValues } from '@/components/lead-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAiFeatures } from '@/lib/ai';
import { pickLeadPhoto } from '@/lib/board-photo';
import { CameraPermissionError } from '@/lib/photo';
import { discardPhoto, keepPhoto, newId } from '@/lib/offline/files';
import { isNoSignal, outbox } from '@/lib/offline/outbox';
import { queueNewLead } from '@/lib/sales';
import { useSession } from '@/lib/session';

/** The board photo chosen: its id (also its id on the server), where to show it, when it was taken, and whether the server has it. */
interface Board {
  id: string;
  uri: string;
  takenAt: string;
  sent: boolean;
}

type Reading = 'working' | 'read' | 'noSignal' | 'notRead' | null;

/**
 * Log a lead in 20 seconds (B2, the founder's design: "a photo of the shop board fills the
 * name and address, the phone comes from the call"). One screen: the photo of the shop
 * board first (camera or gallery); with signal AI reads the name, area, address and a
 * mobile number painted on it into the form, with a sparkle beside each field it filled
 * and "Could not read: type it in" under each it could not; then the few fields a BDE
 * needs in the street. Nothing is saved until Save. Without signal the form is typed and
 * the photo goes with the lead through the outbox.
 *
 * PATTERN FOLLOWED: business-card capture in CRM apps (HubSpot's and Zoho's card scanners,
 * LeadSquared's "Scan documents" into lead fields): photograph, the fields fill in, the
 * person checks and corrects, then saves; the app's own licence reader works the same way.
 */
export default function LogLeadScreen() {
  const theme = useTheme();
  const { t, api } = useSession();
  const notify = useSnackbar();
  const features = useAiFeatures();
  // The lead's id is chosen when the form opens, so saving twice can only ever log one lead.
  const [leadId] = useState(newId);
  const [values, setValues] = useState<LeadFormValues>(emptyLeadForm);
  const [note, setNote] = useState('');
  const [board, setBoard] = useState<Board | null>(null);
  const [reading, setReading] = useState<Reading>(null);
  const [read, setRead] = useState<ShopBoardReadingDto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Counts the photos chosen, so a slow answer about an earlier one is ignored.
  const latest = useRef(0);
  // What to tidy if the screen is left without saving: the photo kept on the phone, and the AI answer thrown away.
  const leftBehind = useRef<{ photoId: string | null; requestId: string | null; saved: boolean }>({ photoId: null, requestId: null, saved: false });

  useEffect(
    () => () => {
      const left = leftBehind.current;
      if (left.saved) return;
      if (left.photoId) discardPhoto(left.photoId);
      if (left.requestId) void api.ai.outcome(left.requestId, 'DISCARDED').catch(() => undefined);
    },
    [api],
  );

  function forgetReading() {
    if (read) void api.ai.outcome(read.aiRequestId, 'DISCARDED').catch(() => undefined);
    leftBehind.current.requestId = null;
    setRead(null);
  }

  async function choose(source: 'camera' | 'gallery') {
    setPhotoError(null);
    let picked;
    try {
      picked = await pickLeadPhoto(source);
    } catch (e) {
      setPhotoError(t(e instanceof CameraPermissionError ? 'bde.photo.camera' : 'error.generic'));
      return;
    }
    if (!picked) return;
    const choice = ++latest.current;
    forgetReading();
    if (board) discardPhoto(board.id);
    const next: Board = { id: newId(), uri: picked.uri, takenAt: new Date().toISOString(), sent: false };
    // Kept on the phone first, so it goes with the lead even if there is no signal now.
    await keepPhoto(next.id, picked).catch(() => undefined);
    leftBehind.current.photoId = next.id;
    setBoard(next);
    if (!features['shop-board']) return setReading(null);

    setReading('working');
    try {
      await api.sales.uploadPhoto(picked.file, { id: next.id, capturedAt: next.takenAt });
      if (choice !== latest.current) return;
      setBoard({ ...next, sent: true });
      outbox.noteReachable(true);
      const answer = await api.sales.readBoard({ photoId: next.id });
      if (choice !== latest.current) {
        void api.ai.outcome(answer.aiRequestId, 'DISCARDED').catch(() => undefined);
        return;
      }
      // Anything already typed is left alone.
      setValues((current) => ({
        ...current,
        businessName: current.businessName.trim() || answer.businessName || '',
        area: current.area.trim() || answer.area || '',
        address: current.address.trim() || answer.address || '',
        phone: current.phone.trim() || (answer.phone ? answer.phone.replace(/^\+91/, '') : ''),
      }));
      setRead(answer);
      leftBehind.current.requestId = answer.aiRequestId;
      setReading('read');
    } catch (e) {
      if (choice !== latest.current) return;
      if (isNoSignal(e)) {
        outbox.noteReachable(false);
        return setReading('noSignal');
      }
      // AI is off, over today's limit, or could not read it: the form is simply typed.
      const aiCode = e instanceof ApiError && (e.code === AI_ERROR.off || e.code === AI_ERROR.limit || e.code === AI_ERROR.failed);
      setReading(aiCode ? 'notRead' : null);
      if (!aiCode) setPhotoError(t('bde.photo.notSent'));
    }
  }

  /** Whether the BDE saved what AI filled in as it was, or changed some of it. */
  function aiOutcome(): 'ACCEPTED' | 'EDITED' {
    if (!read) return 'ACCEPTED';
    const same = (readValue: string | null, typed: string) => readValue === null || readValue === typed.trim();
    const phoneSame = read.phone === null || normalizePhone(values.phone) === read.phone;
    return same(read.businessName, values.businessName) && same(read.area, values.area) && same(read.address, values.address) && phoneSame ? 'ACCEPTED' : 'EDITED';
  }

  async function save() {
    const problems = leadFormProblems(values);
    if (problems.businessName || problems.phone) return setShowMissing(true);
    setSaving(true);
    setSaveError(null);
    try {
      await queueNewLead(
        {
          id: leadId,
          businessName: values.businessName.trim(),
          area: values.area.trim() || null,
          address: values.address.trim() || null,
          contactName: values.contactName.trim() || null,
          contactPhone: phoneInput(values.phone),
          kitchens: values.kitchens,
          source: values.source,
          referrerName: values.referrerName.trim() || null,
          photoId: board?.id ?? null,
        },
        { photoToSend: board && !board.sent ? { id: board.id, capturedAt: board.takenAt } : undefined, note },
      );
    } catch {
      // The phone could not store it (full, say): nothing is pretended.
      setSaving(false);
      return setSaveError(t('bde.form.notStored'));
    }
    if (read) void api.ai.outcome(read.aiRequestId, aiOutcome()).catch(() => undefined);
    // A photo the server already has is not needed on the phone; one still to send stays until it goes.
    if (board?.sent) discardPhoto(board.id);
    leftBehind.current.saved = true;
    notify(t('bde.saved'));
    router.replace({ pathname: '/sales/[leadId]', params: { leadId } });
  }

  const readingLine =
    reading === 'working' ? (
      <View style={styles.reading}>
        <ActivityIndicator color={theme.primary} />
        <ThemedText type="small" themeColor="textSecondary">
          {t('bde.photo.reading')}
        </ThemedText>
      </View>
    ) : reading === 'read' ? (
      <AiNote text={t('ai.readByAi')} />
    ) : reading === 'noSignal' ? (
      <ThemedText type="small" themeColor="warning">
        {t('bde.photo.noSignal')}
      </ThemedText>
    ) : reading === 'notRead' ? (
      <ThemedText type="small" themeColor="textSecondary">
        {t('bde.photo.notRead')}
      </ThemedText>
    ) : null;

  return (
    <Screen
      back
      title={t('bde.logLead')}
      footer={
        <>
          <ErrorText message={saveError} />
          <Button label={t('bde.form.save')} icon="checkmark" loading={saving} disabled={reading === 'working'} hint={reading === 'working' ? t('bde.photo.reading') : undefined} onPress={() => void save()} />
        </>
      }>
      {board ? (
        <View style={styles.photo}>
          <DocumentPhoto uri={board.uri} />
          {readingLine}
          {/* Small, once there is a photo: the form is what matters now. */}
          <View style={styles.buttons}>
            <Button icon="camera-outline" label={t('bde.photo.retake')} variant="link" onPress={() => void choose('camera')} />
            <Button icon="images-outline" label={t('bde.photo.galleryShort')} variant="link" onPress={() => void choose('gallery')} />
          </View>
        </View>
      ) : (
        <View style={styles.photo}>
          {/* Tonal: "Save lead", pinned at the foot, is the screen's one filled button. */}
          <Button
            icon="camera"
            label={t('bde.photo.take')}
            hint={features['shop-board'] ? t('bde.photo.takeHint') : undefined}
            variant="tonal"
            onPress={() => void choose('camera')}
          />
          <Button icon="images" label={t('bde.photo.gallery')} variant="secondary" onPress={() => void choose('gallery')} />
        </View>
      )}
      <ErrorText message={photoError} />

      <LeadForm values={values} onChange={setValues} showMissing={showMissing} read={read} />
      <TextField label={t('bde.form.note')} value={note} onChangeText={setNote} maxLength={200} multiline />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { gap: Spacing.two },
  reading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
});
