import Ionicons from '@expo/vector-icons/Ionicons';
import {
  INSPECTION_SUMMARY_MAX,
  localize,
  type InspectionCheckDto,
  type InspectionDto,
  type InspectionSummaryDraftDto,
} from '@eccs/shared';
import { useState, type ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AiNote } from '@/components/ai-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAiFeatures } from '@/lib/ai';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { isNoSignal } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';

/** The summary as it is being written, before it is saved. */
interface Editing {
  text: string;
  /** "Fix these first": finding ids, in order. */
  fixFirst: string[];
  /** True when the text started from an AI draft, now or before it was last saved. */
  aiDrafted: boolean;
  /** The AI draft made in this sitting, so what the person did with it is recorded. */
  draft: InspectionSummaryDraftDto | null;
}

/**
 * "Summary for the report" (14 Oct 2026). After Finish, while ECCS has not yet
 * approved the report, the Supervisor who carried out the inspection writes a short
 * summary and the findings to fix first: by hand, or from an AI draft that fills the
 * box for them to check and edit. Nothing is kept until they press Save; once the
 * report is approved it is locked and shown read-only, to the restaurant too.
 *
 * The pattern is the AI report summary of inspection apps that the inspector reviews
 * and edits before the report is final (SafetyCulture's AI report summaries, Property
 * Inspect's InspectAI executive summary), labelled as Microsoft's HAX guidelines ask:
 * "Drafted with AI: check it" while editing (G1, G2), easy to change or throw away
 * (G9), and "Drafted with AI help and checked by the inspector" on the saved report.
 * The scores and grade are the app's; "Fix these first" lists the Supervisor's own
 * findings in their own words.
 *
 * The summary is written in English, as the PDF is; it is not translated in the app.
 */
export function InspectionSummarySection({
  inspection,
  editable,
  online,
  onSaved,
}: {
  inspection: InspectionDto;
  /** The person may write it now (InspectionDto.canWriteUp, and the Finish has reached the server). */
  editable: boolean;
  online: boolean;
  onSaved: (inspection: InspectionDto) => void;
}) {
  const { t, api } = useSession();
  const notify = useSnackbar();
  const features = useAiFeatures();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState<'draft' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const writeUp = inspection.writeUp ?? null;
  const open = editable ? editing : null;
  if (!open && !writeUp && !editable) return null;

  const aiOn = features['inspection-summary'] === true;
  const findings = new Map(
    inspection.sections
      .flatMap((section) => section.checks)
      .flatMap((check) => (check.answer === 'NON_COMPLIANT' && check.findingId ? [[check.findingId, check] as const] : [])),
  );

  /** A draft the person threw away (cancelled, or replaced by their own words) is recorded as such. */
  const discard = (draft: InspectionSummaryDraftDto | null) => {
    if (draft) void api.ai.outcome(draft.aiRequestId, 'DISCARDED').catch(() => undefined);
  };

  const startWriting = () => {
    setError(null);
    setEditing({ text: writeUp?.summary ?? '', fixFirst: writeUp?.fixFirst ?? [], aiDrafted: writeUp?.aiDrafted ?? false, draft: null });
  };

  async function draftWithAi() {
    setBusy('draft');
    setError(null);
    try {
      const draft = await api.inspections.draftSummary(inspection.id);
      discard(open?.draft ?? null);
      setEditing({ text: draft.summary, fixFirst: draft.fixFirst, aiDrafted: true, draft });
    } catch (e) {
      setError(isNoSignal(e) ? t('ai.needsSignal') : t('ai.summary.draftFailed'));
    } finally {
      setBusy(null);
    }
  }

  function writeOwn() {
    if (!open) return;
    discard(open.draft);
    setEditing({ text: '', fixFirst: [], aiDrafted: false, draft: null });
  }

  async function save() {
    if (!open) return;
    const text = open.text.trim();
    const draft = open.draft;
    const edited = draft ? text !== draft.summary.trim() || open.fixFirst.join(' ') !== draft.fixFirst.join(' ') : false;
    setBusy('save');
    setError(null);
    try {
      const next = await api.inspections.saveSummary(inspection.id, {
        summary: text,
        fixFirst: open.fixFirst,
        aiDrafted: open.aiDrafted,
        draft: draft ? { requestId: draft.aiRequestId, edited } : null,
      });
      onSaved(next);
      setEditing(null);
      notify(t('ai.summary.saved'));
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  const fixList = (ids: readonly string[], onRemove?: (id: string) => void) => {
    const rows = ids.flatMap((id) => {
      const check = findings.get(id);
      return check ? [{ id, check }] : [];
    });
    if (rows.length === 0) return null;
    return (
      <View style={styles.list}>
        <ThemedText type="smallBold">{t('ai.summary.fixFirst')}</ThemedText>
        {rows.map(({ id, check }) => (
          <FixRow key={id} check={check} onRemove={onRemove && (() => onRemove(id))} />
        ))}
      </View>
    );
  };

  const draftButton = aiOn && (
    <Button
      variant={open ? 'link' : 'primary'}
      icon="sparkles-outline"
      label={t('ai.summary.draft')}
      hint={!online ? t('ai.needsSignal') : undefined}
      disabled={!online || busy === 'save'}
      loading={busy === 'draft'}
      onPress={() => void draftWithAi()}
    />
  );

  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('ai.summary.title')}
      </ThemedText>

      {open ? (
        <>
          {open.aiDrafted && <AiNote text={t('ai.summary.draftNote')} />}
          {/* No label over the box: the heading above says what it is; screen readers still hear "Summary". */}
          <GrowingField
            // A new draft, or "Write my own instead", starts a fresh box, so it is measured afresh.
            key={open.draft?.aiRequestId ?? 'own'}
            accessibilityLabel={t('ai.summary.label')}
            hint={t('ai.summary.hint')}
            value={open.text}
            onChangeText={(text) => setEditing({ ...open, text })}
            maxLength={INSPECTION_SUMMARY_MAX}
          />
          {fixList(open.fixFirst, (id) => setEditing({ ...open, fixFirst: open.fixFirst.filter((entry) => entry !== id) }))}
          {open.draft ? <Button variant="link" label={t('ai.summary.writeOwn')} onPress={writeOwn} disabled={busy !== null} /> : draftButton}
          <ErrorText message={error} />
          <Button label={t('ai.summary.save')} loading={busy === 'save'} disabled={busy === 'draft'} onPress={() => void save()} />
          <Button
            variant="link"
            label={t('common.cancel')}
            disabled={busy !== null}
            onPress={() => {
              discard(open.draft);
              setEditing(null);
              setError(null);
            }}
          />
        </>
      ) : writeUp ? (
        <>
          <ThemedText type="default">{writeUp.summary}</ThemedText>
          {fixList(writeUp.fixFirst)}
          {writeUp.aiDrafted && <AiNote text={t('ai.summary.checkedNote')} />}
          {editable && <Button variant="link" icon="create-outline" label={t('ai.summary.edit')} onPress={startWriting} />}
        </>
      ) : (
        <>
          {draftButton}
          <Button variant={aiOn ? 'link' : 'secondary'} label={t('ai.summary.write')} onPress={startWriting} disabled={busy !== null} />
          <ErrorText message={error} />
        </>
      )}
    </View>
  );
}

/**
 * A text box that grows with its text (at least four lines), so the Supervisor reads the
 * whole draft without scrolling inside the box, as auto-sizing text areas do (Wikimedia
 * Codex's text area, for one). On a phone a multiline box with no fixed height already
 * grows; the browser's text area does not, so there its height follows the content's.
 */
function GrowingField(props: Omit<ComponentProps<typeof TextField>, 'multiline' | 'style' | 'onContentSizeChange'>) {
  const [contentHeight, setContentHeight] = useState(0);
  return (
    <TextField
      {...props}
      multiline
      scrollEnabled={false}
      onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
      // The box's edge (1 point each side) is outside the measured content; the thicker
      // edge while typing would leave a 2-point scroll bar, so nothing scrolls inside it.
      style={[
        styles.multiline,
        Platform.OS === 'web' && contentHeight > 0 && { height: Math.max(MIN_SUMMARY_HEIGHT, contentHeight + 2), overflow: 'hidden' },
      ]}
    />
  );
}

/**
 * One finding to fix first, in the Supervisor's own words: the check (with its own
 * number), what was found and the date to fix it by. The list's order is the order to
 * fix them in. Its full details and photos are with the findings below.
 */
function FixRow({ check, onRemove }: { check: InspectionCheckDto; onRemove?: (() => void) | undefined }) {
  const theme = useTheme();
  const { t, language } = useSession();
  const label = localize(check.label, language);
  return (
    <View style={[styles.fixRow, { borderColor: theme.border }]}>
      <View style={styles.flex}>
        <ThemedText type="small" style={styles.bold}>
          {check.number}. {label}
        </ThemedText>
        {check.note && (
          <ThemedText type="small" numberOfLines={2}>
            {check.note}
          </ThemedText>
        )}
        {check.dueDate && (
          <ThemedText type="small" themeColor="textSecondary">
            {t('insp.fixBy', { date: formatDate(check.dueDate, language) })}
          </ThemedText>
        )}
      </View>
      {onRemove && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('ai.summary.removeItem', { check: label })}
          hitSlop={8}
          onPress={onRemove}
          style={styles.remove}>
          <Ionicons name="close" size={22} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

/** Four lines of the box's text, with its padding: the least it shows. */
const MIN_SUMMARY_HEIGHT = 140;

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, marginTop: Spacing.two },
  multiline: { minHeight: MIN_SUMMARY_HEIGHT, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  list: { gap: Spacing.one },
  fixRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, borderBottomWidth: 1, paddingVertical: Spacing.one },
  flex: { flex: 1, gap: Spacing.half },
  bold: { fontWeight: 700 },
  remove: { minWidth: MinTouchSize, minHeight: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
