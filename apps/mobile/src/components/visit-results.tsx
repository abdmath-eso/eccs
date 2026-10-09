// The parts of a visit that came with the services of 9 Oct 2026:
// - the meter reading a task may carry instead of a tick (the frying oil test:
//   total polar compounds in percent, against FSSAI's limit of 25), with a plain
//   verdict in words, an icon and a colour;
// - for work done with an outside partner (a lab, a clinic, a training partner,
//   an audit agency): which partner it was, and the result documents they sent.
// Used by the visit screen, app/(app)/services/[visitId].tsx.

import { formatReading, isValidReading, readingVerdict, type ReadingVerdict, type VisitDto, type VisitTaskDto } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ltrText } from '@/lib/direction';
import { useSession } from '@/lib/session';

const VERDICT_ICON = { WITHIN: 'checkmark-circle', CLOSE: 'warning', OVER: 'close-circle' } as const;
const VERDICT_COLOR = { WITHIN: 'primary', CLOSE: 'warning', OVER: 'danger' } as const;

/** A typed reading as a number, or null if it is not one the server would accept. Accepts "18,5" as well as "18.5". */
export function parseReading(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return isValidReading(value) ? value : null;
}

/**
 * The reading a task recorded and how it stands against its limit, for example
 * "24.9%  ⚠ Close to the limit · Limit 25%". Nothing is shown until a reading exists.
 */
export function ReadingResult({ task }: { task: VisitTaskDto }) {
  const theme = useTheme();
  const { t } = useSession();
  const reading = task.reading;
  if (!reading || reading.value === null) return null;
  const verdict: ReadingVerdict | null = readingVerdict(reading.value, reading.limit);
  const color = verdict ? theme[VERDICT_COLOR[verdict]] : theme.text;
  return (
    <View style={styles.result}>
      <ThemedText type="default" style={[styles.value, { color }]}>
        {/* Kept left to right so the figure and its percent sign do not swap places in Urdu. */}
        {ltrText(t('visit.reading.value', { value: formatReading(reading.value) }))}
      </ThemedText>
      {verdict && (
        <View style={styles.verdict}>
          <Ionicons name={VERDICT_ICON[verdict]} size={20} color={color} />
          <ThemedText type="default" style={[styles.verdictText, { color }]}>
            {t(`visit.reading.${verdict}`)}
          </ThemedText>
        </View>
      )}
      {reading.limit !== null && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('visit.reading.limit', { limit: ltrText(formatReading(reading.limit)) })}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * The box the Supervisor types a meter reading into, with its own Save button:
 * a number is not saved on every keystroke. It takes the place of the "Done"
 * button of an ordinary task; "Not done" stays beside the task for a fryer the
 * kitchen does not have.
 */
export function ReadingInput({ task, disabled, onSave }: { task: VisitTaskDto; disabled: boolean; onSave: (value: number) => void }) {
  const { t } = useSession();
  const saved = task.reading?.value ?? null;
  /** What is in the box; null until the person types, so a saved reading shows as it was saved. */
  const [typed, setTyped] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const text = typed ?? (saved === null ? '' : formatReading(saved));
  const limit = task.reading?.limit ?? null;

  return (
    <View style={styles.input}>
      <TextField
        label={t('visit.reading.label')}
        value={text}
        onChangeText={(next) => {
          setTyped(next);
          setInvalid(false);
        }}
        keyboardType="decimal-pad"
        inputMode="decimal"
        maxLength={5}
        hint={limit === null ? null : t('visit.reading.hint', { limit: ltrText(formatReading(limit)) })}
        error={invalid ? t('visit.reading.invalid') : null}
      />
      <Button
        label={t('visit.reading.save')}
        icon="save-outline"
        variant="secondary"
        disabled={disabled}
        onPress={() => {
          const value = parseReading(text);
          if (value === null) return setInvalid(true);
          setTyped(null);
          onSave(value);
        }}
      />
    </View>
  );
}

/**
 * Which partner did the work, and the result documents attached to the visit,
 * each opened with one tap. Shown for a kind of service a partner delivers and
 * for any visit that has a document. ECCS attaches the documents from its
 * office; they are the same files as in the outlet's documents.
 */
export function VisitPartner({ visit, showName }: { visit: VisitDto; /** False while the Supervisor is typing the name in the form below. */ showName: boolean }) {
  const theme = useTheme();
  const { t, api } = useSession();
  const [failed, setFailed] = useState(false);
  const documents = visit.documents ?? [];
  if (!visit.partnerDelivered && documents.length === 0 && !visit.partnerName) return null;

  return (
    <View style={[styles.partner, { borderColor: theme.border }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('visit.partner.heading')}
      </ThemedText>
      {showName && visit.partnerName && <ThemedText type="default">{t('visit.partner.doneWith', { name: visit.partnerName })}</ThemedText>}
      {documents.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('visit.documents.none')}
        </ThemedText>
      ) : (
        <>
          {documents.map((document) => (
            <View key={document.id} style={styles.document}>
              <ThemedText type="default" style={styles.documentTitle}>
                {document.title}
              </ThemedText>
              <Button
                icon="document-attach-outline"
                label={t('visit.documents.open')}
                variant="secondary"
                onPress={() => {
                  setFailed(false);
                  Linking.openURL(api.fileUrl(document.file.path)).catch(() => setFailed(true));
                }}
              />
            </View>
          ))}
          <ErrorText message={failed ? t('visit.documents.failed') : null} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('visit.documents.inVault')}
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  result: { gap: Spacing.half },
  value: { fontSize: 24, lineHeight: 30, fontWeight: 700 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  verdictText: { flex: 1, fontWeight: 700 },
  input: { gap: Spacing.two },
  partner: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  document: { gap: Spacing.one },
  documentTitle: { fontWeight: 700 },
});
