import {
  INSPECTION_ANSWERS,
  INSPECTION_MAX_PHOTOS,
  INSPECTION_NOTE_MAX,
  INSPECTION_SEVERITIES,
  isEccsRole,
  localize,
  type InspectionAnswer,
  type InspectionCheckDto,
  type InspectionDto,
  type InspectionPhotoDto,
  type InspectionSectionDto,
  type InspectionSeverity,
} from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { InspectionStatusBadge, ScoreSummary, SectionScoreRow } from '@/components/inspection-parts';
import { ProofPhoto } from '@/components/proof-photo';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate, indiaToday, maskTypedDate, parseTypedDate, toTypedDate } from '@/lib/format';
import { CameraPermissionError, takeProofPhoto } from '@/lib/photo';
import { scrollToY } from '@/lib/scroll';
import { useSession } from '@/lib/session';

type IconName = ComponentProps<typeof Ionicons>['name'];

// How each answer looks: an outline until chosen, filled once chosen, so the
// choice never depends on colour alone.
const ANSWER_ICON: Record<InspectionAnswer, [IconName, IconName]> = {
  COMPLIANT: ['checkmark-circle-outline', 'checkmark-circle'],
  NON_COMPLIANT: ['close-circle-outline', 'close-circle'],
  NOT_APPLICABLE: ['remove-circle-outline', 'remove-circle'],
};

// Long enough for a section to open or close before its place on the page is read.
const AFTER_LAYOUT_MS = 150;

// One-tap dates for putting a non-compliance right, in days from today.
const DUE_IN_DAYS = [1, 3, 7, 15, 30] as const;

/** The details of a non-compliance as they are being typed, before they are saved. */
interface Draft {
  note: string;
  severity: InspectionSeverity | null;
  action: string;
  /** YYYY-MM-DD once a real date is chosen or typed. */
  dueDate: string | null;
  /** The date field as typed (DD/MM/YYYY). */
  typedDate: string;
}

const draftOf = (check: InspectionCheckDto): Draft => ({
  note: check.note ?? '',
  severity: check.severity,
  action: check.correctiveAction ?? '',
  dueDate: check.dueDate,
  typedDate: check.dueDate ? toTypedDate(check.dueDate) : '',
});

const flat = (inspection: InspectionDto) => inspection.sections.flatMap((section) => section.checks);
const sectionDone = (section: InspectionSectionDto) => section.checks.every((check) => check.complete);

/**
 * One inspection. While it is being carried out this is where the Supervisor
 * answers the checks, section by section; each answer is sent as it is given.
 * Once finished it is the inspection report: the score and grade, the section
 * scores and the non-compliances with their photos.
 */
export default function InspectionScreen() {
  const theme = useTheme();
  const { inspectionId } = useLocalSearchParams<{ inspectionId: string }>();
  const { t, api, language, user } = useSession();
  const notify = useSnackbar();

  const [inspection, setInspection] = useState<InspectionDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The section whose checks are showing. One at a time keeps a 92-check list short. */
  const [openSection, setOpenSection] = useState<string | null>(null);
  /** An answered check opened again to change it. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Answers tapped but not yet confirmed by the server, shown straight away. */
  const [pending, setPending] = useState<Record<string, InspectionAnswer>>({});
  /** What went wrong and at which check (or `finish`), so the message shows beside it. */
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** The check whose details were saved with something missing: its fields show what. */
  const [checked, setChecked] = useState<string | null>(null);
  /** What is being sent that should show as busy: `details-<id>`, `photo-<id>`, `finish`, `pdf`. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The check Finish found unanswered or incomplete. */
  const [missing, setMissing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState<InspectionPhotoDto | null>(null);
  /** A non-compliance about to be changed to another answer, which would remove its note and photos. */
  const [changing, setChanging] = useState<{ check: InspectionCheckDto; value: InspectionAnswer } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** How far down the page each section sits, and each check inside its section. */
  const sectionY = useRef<Record<string, number>>({});
  const checkY = useRef<Record<string, number>>({});
  /** The inspection as last shown, for answers that come back while others are still on their way. */
  const latest = useRef<InspectionDto | null>(null);

  const show = useCallback((next: InspectionDto) => {
    latest.current = next;
    setInspection(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const loaded = await api.inspections.get(inspectionId);
      show(loaded);
      // Opens at the first section with something still to do.
      const first = loaded.sections.find((section) => !sectionDone(section));
      setOpenSection((current) => current ?? first?.key ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, inspectionId, show]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!inspection) {
    return (
      <Screen back title={t('insp.title')} onRefresh={load}>
        <ErrorText message={loadError} onRetry={() => void load()} />
        {!loadError && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }

  const recording = inspection.canRecord;
  const checks = flat(inspection);
  const done = checks.filter((check) => check.complete).length;
  const viewerRole = user?.memberships[0]?.role;
  const eccs = viewerRole !== undefined && isEccsRole(viewerRole);
  const today = indiaToday();

  const clearFailure = (at: string) =>
    setFailed((current) => {
      const { [at]: _gone, ...rest } = current;
      return rest;
    });

  /** Puts one check as the server now has it into the inspection on screen. */
  function replaceCheck(check: InspectionCheckDto): InspectionDto | null {
    const current = latest.current;
    if (!current) return null;
    const next: InspectionDto = {
      ...current,
      status: current.status === 'PLANNED' ? 'IN_PROGRESS' : current.status,
      sections: current.sections.map((section) => ({
        ...section,
        checks: section.checks.map((entry) => (entry.itemId === check.itemId ? check : entry)),
      })),
    };
    show(next);
    return next;
  }

  // Opening one section closes another, which moves everything below it, so the
  // positions are read only after the screen has had time to lay itself out again.
  const scrollToCheck = (sectionKey: string, itemId?: string) => {
    setTimeout(() => {
      const top = sectionY.current[sectionKey];
      if (top === undefined) return;
      scrollToY(scrollRef, top + (itemId ? (checkY.current[itemId] ?? 0) : 0));
    }, AFTER_LAYOUT_MS);
  };

  /** Once a section is complete, moves on to the next one with something left to do. */
  function moveOn(next: InspectionDto, fromItemId: string) {
    const section = next.sections.find((entry) => entry.checks.some((check) => check.itemId === fromItemId));
    if (!section || !sectionDone(section)) return;
    const index = next.sections.indexOf(section);
    const ahead = [...next.sections.slice(index + 1), ...next.sections.slice(0, index)].find((entry) => !sectionDone(entry));
    if (!ahead) return;
    setOpenSection(ahead.key);
    scrollToCheck(ahead.key);
  }

  /**
   * Saves an answer the moment it is tapped. The choice shows at once and is
   * confirmed when the server answers; several can be on their way together,
   * so a slow connection does not hold the next check up.
   */
  function answer(check: InspectionCheckDto, value: InspectionAnswer) {
    const id = check.itemId;
    setPending((current) => ({ ...current, [id]: value }));
    clearFailure(id);
    if (missing === id) setMissing(null);
    const draft = drafts[id] ?? draftOf(check);
    // Tapping "Not compliant" again must not wipe details already given.
    const details =
      value === 'NON_COMPLIANT'
        ? { note: draft.note, severity: draft.severity, correctiveAction: draft.action, dueDate: draft.dueDate }
        : {};
    if (value === 'NON_COMPLIANT') setEditing(id);
    api.inspections
      .answer(inspectionId, id, { answer: value, ...details })
      .then((result) => {
        const next = replaceCheck(result.check);
        if (value !== 'NON_COMPLIANT') {
          setEditing((current) => (current === id ? null : current));
          if (next) moveOn(next, id);
        }
      })
      .catch((e: unknown) => setFailed((current) => ({ ...current, [id]: errorMessage(e, t) })))
      .finally(() =>
        setPending((current) => {
          const { [id]: _sent, ...rest } = current;
          return rest;
        }),
      );
  }

  const setDraft = (check: InspectionCheckDto, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [check.itemId]: { ...(current[check.itemId] ?? draftOf(check)), ...change } }));

  /** Saves what was typed about a non-compliance. Anything still missing is pointed out, but what is there is kept. */
  async function saveDetails(check: InspectionCheckDto) {
    if (busy !== null) return;
    const id = check.itemId;
    const draft = drafts[id] ?? draftOf(check);
    setBusy(`details-${id}`);
    clearFailure(id);
    try {
      const result = await api.inspections.answer(inspectionId, id, {
        answer: 'NON_COMPLIANT',
        note: draft.note.trim(),
        severity: draft.severity,
        correctiveAction: draft.action.trim(),
        dueDate: draft.dueDate,
      });
      const next = replaceCheck(result.check);
      if (result.check.complete) {
        notify(t('common.saved'));
        setChecked(null);
        setEditing(null);
        setDrafts((current) => {
          const { [id]: _saved, ...rest } = current;
          return rest;
        });
        if (next) moveOn(next, id);
      } else {
        setChecked(id);
      }
    } catch (e) {
      setFailed((current) => ({ ...current, [id]: errorMessage(e, t) }));
    } finally {
      setBusy(null);
    }
  }

  async function addPhoto(check: InspectionCheckDto) {
    if (busy !== null) return;
    const id = check.itemId;
    clearFailure(id);
    let photo;
    try {
      photo = await takeProofPhoto();
    } catch (e) {
      setFailed((current) => ({ ...current, [id]: t(e instanceof CameraPermissionError ? 'error.camera' : 'error.generic') }));
      return;
    }
    if (!photo) return;
    setBusy(`photo-${id}`);
    try {
      replaceCheck((await api.inspections.addPhoto(inspectionId, id, photo.file)).check);
    } catch (e) {
      setFailed((current) => ({ ...current, [id]: errorMessage(e, t) }));
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto(photo: InspectionPhotoDto) {
    setRemoving(null);
    const owner = checks.find((check) => check.photos.some((entry) => entry.id === photo.id));
    try {
      replaceCheck((await api.inspections.removePhoto(inspectionId, photo.id)).check);
    } catch (e) {
      if (owner) setFailed((current) => ({ ...current, [owner.itemId]: errorMessage(e, t) }));
    }
  }

  /** Finish is always pressable: if something is missing it goes there, instead of sitting greyed out. */
  function pressFinish() {
    if (busy !== null) return;
    const lacking = checks.find((check) => !check.complete);
    if (lacking) {
      const section = inspection!.sections.find((entry) => entry.checks.includes(lacking));
      setMissing(lacking.itemId);
      if (lacking.answer === 'NON_COMPLIANT') setChecked(lacking.itemId);
      if (section) {
        setOpenSection(section.key);
        scrollToCheck(section.key, lacking.itemId);
      }
      return;
    }
    setMissing(null);
    setConfirming(true);
  }

  async function finish() {
    setConfirming(false);
    setBusy('finish');
    clearFailure('finish');
    try {
      show(await api.inspections.finish(inspectionId));
      notify(t('insp.finished'));
      scrollToY(scrollRef, 0);
    } catch (e) {
      setFailed((current) => ({ ...current, finish: errorMessage(e, t) }));
    } finally {
      setBusy(null);
    }
  }

  /** Opens the approved report as a PDF in the phone's viewer. The first time, the server makes it, which takes a few seconds. */
  async function openPdf() {
    if (busy !== null) return;
    setBusy('pdf');
    clearFailure('pdf');
    try {
      const { path } = await api.inspections.reportPdf(inspectionId);
      await Linking.openURL(api.fileUrl(path));
    } catch (e) {
      setFailed((current) => ({ ...current, pdf: errorMessage(e, t) }));
    } finally {
      setBusy(null);
    }
  }

  // ───────────────────────── Carrying it out ─────────────────────────

  const answerButton = (check: InspectionCheckDto, value: InspectionAnswer, chosen: InspectionAnswer | null) => {
    const selected = chosen === value;
    const color = value === 'COMPLIANT' ? theme.primary : value === 'NON_COMPLIANT' ? theme.danger : theme.textSecondary;
    return (
      <Pressable
        key={value}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        accessibilityLabel={t(value === 'NOT_APPLICABLE' ? 'insp.notApplicable' : `insp.answer.${value}`)}
        onPress={() => {
          const recorded = check.answer === 'NON_COMPLIANT' && (check.note !== null || check.photos.length > 0);
          // One slip of a wet thumb must not throw away a note and photos.
          if (recorded && value !== 'NON_COMPLIANT') setChanging({ check, value });
          else answer(check, value);
        }}
        style={({ pressed }) => [
          styles.answer,
          { borderColor: selected ? color : theme.outline },
          selected && styles.answerSelected,
          (selected || pressed) && { backgroundColor: theme.backgroundElement },
        ]}>
        <Ionicons name={ANSWER_ICON[value][selected ? 1 : 0]} size={30} color={selected ? color : theme.textSecondary} />
        <ThemedText
          type="small"
          numberOfLines={2}
          style={[styles.answerLabel, { color: selected ? color : theme.text }, selected && styles.bold]}>
          {t(`insp.answer.${value}`)}
        </ThemedText>
      </Pressable>
    );
  };

  const detailsForm = (check: InspectionCheckDto) => {
    const id = check.itemId;
    const draft = drafts[id] ?? draftOf(check);
    // What is missing is only pointed out after a save, not while the person is still typing.
    const need = (lacking: boolean, key: 'note' | 'severity' | 'action' | 'dueDate' | 'photo') =>
      checked === id && lacking ? t(`insp.need.${key}`) : null;
    const typedIsWrong = draft.typedDate.length > 0 && parseTypedDate(draft.typedDate) === null;
    return (
      <View style={[styles.details, { borderColor: theme.border }]}>
        <TextField
          label={t('insp.found')}
          value={draft.note}
          onChangeText={(note) => setDraft(check, { note })}
          maxLength={INSPECTION_NOTE_MAX}
          multiline
          style={styles.multiline}
          error={need(check.note === null, 'note')}
        />

        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('insp.severity')}
        </ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('insp.severity')}>
          {INSPECTION_SEVERITIES.map((severity) => (
            <OptionChip
              key={severity}
              label={t(`insp.severity.${severity}`)}
              selected={draft.severity === severity}
              onPress={() => setDraft(check, { severity })}
            />
          ))}
        </View>
        <ErrorText message={need(check.severity === null, 'severity')} />

        <TextField
          label={t('insp.action')}
          value={draft.action}
          onChangeText={(action) => setDraft(check, { action })}
          maxLength={INSPECTION_NOTE_MAX}
          multiline
          style={styles.multiline}
          error={need(check.correctiveAction === null, 'action')}
        />

        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('insp.dueDate')}
        </ThemedText>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('insp.dueDate')}>
          {DUE_IN_DAYS.map((days) => {
            const date = addDays(today, days);
            return (
              <OptionChip
                key={days}
                label={days === 1 ? t('insp.dueTomorrow') : t('insp.dueIn', { count: days })}
                selected={draft.dueDate === date}
                onPress={() => setDraft(check, { dueDate: date, typedDate: toTypedDate(date) })}
              />
            );
          })}
        </View>
        <TextField
          label={t('insp.dueOther')}
          value={draft.typedDate}
          onChangeText={(text) => {
            const typedDate = maskTypedDate(text, draft.typedDate);
            setDraft(check, { typedDate, dueDate: parseTypedDate(typedDate) });
          }}
          keyboardType="number-pad"
          placeholder="DD/MM/YYYY"
          hint={draft.dueDate ? formatDate(draft.dueDate, language) : null}
          error={typedIsWrong && draft.typedDate.length >= 10 ? t('error.date') : need(check.dueDate === null, 'dueDate')}
        />

        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('insp.photos')}
        </ThemedText>
        {check.photos.length > 0 && (
          <View style={styles.photos}>
            {check.photos.map((photo, index) => (
              <ProofPhoto
                key={photo.id}
                compact
                uri={api.fileUrl(photo.path)}
                label={t('insp.photoLabel', { number: index + 1, total: check.photos.length })}
                onRemove={() => setRemoving(photo)}
              />
            ))}
          </View>
        )}
        {check.photos.length < INSPECTION_MAX_PHOTOS && (
          <Button
            icon="camera"
            label={t('insp.addPhoto')}
            variant="secondary"
            loading={busy === `photo-${id}`}
            onPress={() => void addPhoto(check)}
          />
        )}
        <ErrorText message={need(check.photos.length === 0, 'photo')} />

        <Button label={t('insp.saveDetails')} loading={busy === `details-${id}`} onPress={() => void saveDetails(check)} />
      </View>
    );
  };

  const checkRow = (check: InspectionCheckDto) => {
    const id = check.itemId;
    const label = localize(check.label, language);
    const chosen = pending[id] ?? check.answer;
    const sending = pending[id] !== undefined;
    const open = !check.complete || editing === id || sending || failed[id] !== undefined;
    const remember = (y: number) => {
      checkY.current[id] = y;
    };

    // Answered and complete: one line, so what is left to do stays in view. Tap to change.
    if (!open && check.answer) {
      const failedCheck = check.answer === 'NON_COMPLIANT';
      return (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityLabel={`${check.number}. ${label}. ${t(check.answer === 'NOT_APPLICABLE' ? 'insp.notApplicable' : `insp.answer.${check.answer}`)}`}
          accessibilityHint={t('insp.tapToChange')}
          onLayout={(event) => remember(event.nativeEvent.layout.y)}
          onPress={() => setEditing(id)}
          style={({ pressed }) => [styles.doneRow, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
          <Ionicons
            name={ANSWER_ICON[check.answer][1]}
            size={24}
            color={check.answer === 'COMPLIANT' ? theme.primary : failedCheck ? theme.danger : theme.textSecondary}
          />
          <View style={styles.flexText}>
            <ThemedText type="small" numberOfLines={failedCheck ? 3 : 1}>
              {check.number}. {label}
            </ThemedText>
            {check.answer !== 'COMPLIANT' && (
              <ThemedText type="smallBold" themeColor={failedCheck ? 'danger' : 'textSecondary'}>
                {failedCheck
                  ? [
                      t('insp.answer.NON_COMPLIANT'),
                      check.severity && t(`insp.severity.${check.severity}`),
                      check.dueDate && t('insp.fixBy', { date: formatDate(check.dueDate, language) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : t('insp.notApplicable')}
              </ThemedText>
            )}
          </View>
        </Pressable>
      );
    }

    const flagged = missing === id && !check.complete;
    return (
      <View
        key={id}
        onLayout={(event) => remember(event.nativeEvent.layout.y)}
        style={[styles.check, { borderColor: flagged ? theme.danger : theme.border }, flagged && styles.flagged]}>
        <ThemedText type="default" style={styles.checkLabel}>
          {check.number}. {label}
        </ThemedText>
        {check.critical && (
          <View style={styles.critical}>
            <Ionicons name="star" size={16} color={theme.warning} />
            <ThemedText type="smallBold" themeColor="warning">
              {t('insp.critical')}
            </ThemedText>
          </View>
        )}
        <View style={styles.answers} accessibilityRole="radiogroup" accessibilityLabel={label}>
          {INSPECTION_ANSWERS.map((value) => answerButton(check, value, chosen))}
        </View>
        {sending && <ActivityIndicator color={theme.primary} />}
        <ErrorText
          message={
            failed[id] ??
            (flagged ? t(check.answer === 'NON_COMPLIANT' ? 'insp.needDetails' : 'insp.needAnswer') : null)
          }
          // A failed answer is sent again with one tap, without choosing it a second time.
          {...(failed[id] !== undefined && chosen && !sending ? { onRetry: () => answer(check, chosen) } : {})}
        />
        {chosen === 'NON_COMPLIANT' && check.answer === 'NON_COMPLIANT' && detailsForm(check)}
      </View>
    );
  };

  const sectionBlock = (section: InspectionSectionDto) => {
    const open = openSection === section.key;
    const complete = section.checks.filter((check) => check.complete).length;
    const all = complete === section.checks.length;
    return (
      <View
        key={section.key}
        onLayout={(event) => {
          sectionY.current[section.key] = event.nativeEvent.layout.y;
        }}
        style={styles.section}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${section.key}. ${section.title}. ${t('insp.progress', { done: complete, total: section.checks.length })}`}
          onPress={() => setOpenSection(open ? null : section.key)}
          style={({ pressed }) => [
            styles.sectionHeader,
            { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <Ionicons
            name={all ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={all ? theme.primary : theme.textSecondary}
            accessibilityLabel={all ? t('insp.sectionDone') : undefined}
          />
          <ThemedText type="default" style={styles.sectionTitle}>
            {section.key}. {section.title}
          </ThemedText>
          <ThemedText type="smallBold" themeColor={all ? 'primary' : 'textSecondary'}>
            {t('insp.progressCount', { done: complete, total: section.checks.length })}
          </ThemedText>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={theme.textSecondary} />
        </Pressable>
        {open && section.checks.map(checkRow)}
      </View>
    );
  };

  // ───────────────────────── The report ─────────────────────────

  const fact = (label: string, value: string | null) =>
    value ? (
      <View style={styles.fact}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="default">{value}</ThemedText>
      </View>
    ) : null;

  const findings = checks.filter((check) => check.answer === 'NON_COMPLIANT');
  const notApplicable = checks.filter((check) => check.answer === 'NOT_APPLICABLE').length;

  const report = (
    <>
      {inspection.overallScore !== null && <ScoreSummary score={inspection.overallScore} grade={inspection.grade} />}
      {inspection.status === 'SUBMITTED' && eccs && (
        <ThemedText type="default" themeColor="warning">
          {t('insp.waitingEccs')}
        </ThemedText>
      )}
      {inspection.criticalFailed > 0 && (
        <View style={styles.warning}>
          <Ionicons name="alert-circle" size={22} color={theme.danger} />
          <ThemedText type="default" themeColor="danger" style={styles.flexText}>
            {t('insp.criticalFailed', { count: inspection.criticalFailed })}
          </ThemedText>
        </View>
      )}
      <ThemedText type="default" themeColor="textSecondary">
        {t('insp.counts', {
          compliant: checks.length - findings.length - notApplicable,
          failed: findings.length,
          na: notApplicable,
        })}
      </ThemedText>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('insp.sections')}
      </ThemedText>
      {inspection.sections.map((section) => (
        <SectionScoreRow key={section.key} section={section} />
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        {t('insp.howScored')}
      </ThemedText>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
        {t('insp.findings', { count: findings.length })}
      </ThemedText>
      {findings.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('insp.noFindings')}
        </ThemedText>
      )}
      {findings.map((check) => (
        <View key={check.itemId} style={[styles.finding, { borderColor: theme.border }]}>
          <ThemedText type="default" style={styles.checkLabel}>
            {check.number}. {localize(check.label, language)}
          </ThemedText>
          <ThemedText type="smallBold" themeColor={check.severity === 'LOW' ? 'textSecondary' : 'danger'}>
            {[check.critical && t('insp.critical'), check.severity && t(`insp.severity.${check.severity}`)]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
          {check.note && <ThemedText type="default">{check.note}</ThemedText>}
          {fact(t('insp.correctiveAction'), check.correctiveAction)}
          {check.dueDate && (
            <View style={styles.due}>
              <Ionicons name="calendar-outline" size={20} color={theme.text} />
              <ThemedText type="default" style={styles.bold}>
                {t('insp.fixBy', { date: formatDate(check.dueDate, language) })}
              </ThemedText>
            </View>
          )}
          {check.photos.length > 0 && (
            <View style={styles.photos}>
              {check.photos.map((photo, index) => (
                <ProofPhoto
                  key={photo.id}
                  compact
                  uri={api.fileUrl(photo.path)}
                  label={t('insp.photoLabel', { number: index + 1, total: check.photos.length })}
                />
              ))}
            </View>
          )}
        </View>
      ))}
    </>
  );

  // The main button stays in view at the bottom, with how far the inspection has got.
  const footer = recording ? (
    <>
      <View accessibilityLiveRegion="polite" style={styles.progress}>
        <ThemedText type="smallBold">{t('insp.progress', { done, total: checks.length })}</ThemedText>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[styles.bar, { width: `${checks.length ? (done / checks.length) * 100 : 0}%`, backgroundColor: theme.primary }]}
          />
        </View>
      </View>
      <ErrorText message={failed.finish ?? null} />
      <Button label={t('insp.finish')} loading={busy === 'finish'} onPress={pressFinish} />
    </>
  ) : undefined;

  return (
    <Screen
      back
      title={inspection.outletName}
      subtitle={recording ? (inspection.outletAddress ?? inspection.organizationName) : t('insp.report')}
      onRefresh={load}
      scrollRef={scrollRef}
      footer={footer}>
      {/* A refresh that failed: the inspection shown is the last one loaded. */}
      <ErrorText message={loadError} onRetry={() => void load()} />

      <InspectionStatusBadge status={inspection.status} />

      {recording && inspection.correctionNote && (
        <View style={[styles.correction, { borderColor: theme.warning }]}>
          <ThemedText type="smallBold" themeColor="warning">
            {t('insp.correction')}
          </ThemedText>
          <ThemedText type="default">{inspection.correctionNote}</ThemedText>
        </View>
      )}

      {recording ? (
        inspection.sections.map(sectionBlock)
      ) : (
        <>
          <View style={[styles.facts, { backgroundColor: theme.backgroundElement }]}>
            {inspection.reportNumber && (
              <ThemedText type="default" style={styles.bold}>
                {t('insp.report')} · {inspection.reportNumber}
              </ThemedText>
            )}
            {fact(t('insp.inspectedOn'), formatDate(inspection.date, language))}
            {fact(t('insp.inspectedBy'), inspection.supervisorName)}
            {inspection.grade === null && inspection.status === 'PLANNED' && (
              <ThemedText type="default" themeColor="textSecondary">
                {t('insp.plannedFor', { date: formatDate(inspection.date, language) })}
              </ThemedText>
            )}
          </View>
          {/* Only an approved report is final, so only then is there a PDF to keep or pass on. */}
          {inspection.status === 'APPROVED' && (
            <>
              <Button
                icon="document-text"
                label={t('visit.pdf')}
                variant="secondary"
                loading={busy === 'pdf'}
                onPress={() => void openPdf()}
              />
              <ErrorText message={failed.pdf ?? null} />
            </>
          )}
          {inspection.status !== 'PLANNED' && report}
        </>
      )}

      <ConfirmDialog
        visible={confirming}
        message={t('insp.finishConfirm')}
        confirmLabel={t('insp.finish')}
        onConfirm={() => void finish()}
        onCancel={() => setConfirming(false)}
      />
      <ConfirmDialog
        visible={changing !== null}
        message={t('insp.changeConfirm')}
        confirmLabel={t('insp.changeAnswer')}
        danger
        onConfirm={() => {
          if (changing) answer(changing.check, changing.value);
          setChanging(null);
        }}
        onCancel={() => setChanging(null)}
      />
      <ConfirmDialog
        visible={removing !== null}
        message={t('insp.removePhotoConfirm')}
        confirmLabel={t('insp.removePhoto')}
        danger
        onConfirm={() => removing && void removePhoto(removing)}
        onCancel={() => setRemoving(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize + Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  sectionTitle: { flex: 1, fontWeight: 700 },
  sectionGap: { marginTop: Spacing.four },
  check: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  flagged: { borderWidth: 2 },
  checkLabel: { fontWeight: 600 },
  critical: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  answers: { flexDirection: 'row', gap: Spacing.two },
  answer: {
    flex: 1,
    minHeight: MinTouchSize + Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.two,
  },
  answerSelected: { borderWidth: 2 },
  answerLabel: { textAlign: 'center' },
  bold: { fontWeight: 700 },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouchSize,
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  flexText: { flex: 1 },
  details: { borderTopWidth: 1, paddingTop: Spacing.three, gap: Spacing.two },
  multiline: { minHeight: 88, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  progress: { gap: Spacing.one },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  correction: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  facts: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  fact: { gap: Spacing.half },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  finding: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  due: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
