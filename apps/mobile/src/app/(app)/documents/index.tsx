import Ionicons from '@expo/vector-icons/Ionicons';
import {
  DOCUMENT_CATEGORIES,
  LICENCE_TYPES,
  type DocumentCategory,
  type DocumentDto,
  type LicenceDto,
  type LicenceType,
} from '@eccs/shared';
import { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { FileChooser } from '@/components/file-chooser';
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
import { formatDate, indiaToday, maskTypedDate, parseTypedDate, toTypedDate } from '@/lib/format';
import type { ChosenFile } from '@/lib/pick-file';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type VaultCategory = Exclude<DocumentCategory, 'licence'>;
const VAULT_CATEGORIES = DOCUMENT_CATEGORIES.filter((category): category is VaultCategory => category !== 'licence');

type Removal = { kind: 'licence'; licence: LicenceDto } | { kind: 'document'; document: DocumentDto };

/** Licences with their expiry dates, and the document vault, for one outlet. */
export default function DocumentsScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [licences, setLicences] = useState<LicenceDto[] | null>(null);
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  // Three places an error can belong: the lists failing to load (top of the screen),
  // the open form (beside its Save button), and one row that could not be removed.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);

  // Which form is open: adding a licence, renewing one (by id), adding a document, or none.
  const [form, setForm] = useState<'licence' | 'document' | { renew: string } | null>(null);
  const [type, setType] = useState<LicenceType>('FSSAI');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [category, setCategory] = useState<VaultCategory>('certificate');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<ChosenFile | null>(null);
  // Set once Save has been pressed, so the fields still empty say so.
  const [showMissing, setShowMissing] = useState(false);
  // For licences the file is uploaded as soon as it is chosen, so its details can be read into the form.
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [reading, setReading] = useState<'working' | 'filled' | 'nothing' | null>(null);
  // Counts the files chosen, so a slow answer about an earlier file is ignored.
  const latestChoice = useRef(0);

  const fetchLists = (forOutlet: string) =>
    Promise.all([api.licences.list({ outletId: forOutlet }), api.documents.list(forOutlet)]);

  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    (async () => {
      try {
        const [licenceList, documentList] = await Promise.all([
          api.licences.list({ outletId }),
          api.documents.list(outletId),
        ]);
        if (cancelled) return;
        setLicences(licenceList);
        setDocuments(documentList);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e, t));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

  /** Loads both lists again: for pulling down to refresh and for "Try again". */
  async function reload() {
    if (!outletId) return;
    setLoadError(null);
    try {
      const [licenceList, documentList] = await fetchLists(outletId);
      setLicences(licenceList);
      setDocuments(documentList);
    } catch (e) {
      setLoadError(errorMessage(e, t));
    }
  }

  function openForm(next: typeof form) {
    setForm(next);
    setType('FSSAI');
    setName('');
    setNumber('');
    setExpiry('');
    setCategory('certificate');
    setTitle('');
    setFile(null);
    setUploadedId(null);
    setReading(null);
    setFormError(null);
    setRowError(null);
    setShowMissing(false);
    latestChoice.current += 1;
  }

  /**
   * A licence document was chosen: upload it, then ask the server to read the
   * number and dates off it and put them in the form for the person to check.
   * Anything already typed is left alone.
   */
  async function licenceFileChosen(chosen: ChosenFile | null) {
    const choice = ++latestChoice.current;
    setFile(chosen);
    setUploadedId(null);
    setReading(null);
    if (!chosen || !outletId) return;

    setReading('working');
    setFormError(null);
    try {
      const uploaded = await api.attachments.upload({
        outletId,
        file: chosen.file,
        kind: 'DOCUMENT',
        fileName: chosen.name,
      });
      if (choice !== latestChoice.current) return;
      setUploadedId(uploaded.id);
      const details = await api.licences.read(uploaded.id);
      if (choice !== latestChoice.current) return;

      const found = details.expiresOn !== null || details.number !== null;
      if (details.expiresOn) setExpiry((current) => current.trim() || toTypedDate(details.expiresOn!));
      // When renewing, the number shown is the old licence's, so the one on the new document wins.
      if (details.number) setNumber((current) => (form === 'licence' && current.trim()) || details.number!);
      if (form === 'licence' && details.type && details.type !== 'OTHER') setType(details.type);
      setReading(found ? 'filled' : 'nothing');
    } catch (e) {
      if (choice !== latestChoice.current) return;
      setFile(null);
      setReading(null);
      setFormError(errorMessage(e, t, { 0: 'error.upload' }));
    }
  }

  /** Uploads the chosen file, if any, and returns its id for attaching. */
  async function uploadChosen(): Promise<string | undefined> {
    if (uploadedId) return uploadedId;
    if (!file || !outletId) return undefined;
    const uploaded = await api.attachments.upload({ outletId, file: file.file, kind: 'DOCUMENT', fileName: file.name });
    return uploaded.id;
  }

  /**
   * Runs a save, then reloads both lists so licences and their documents stay in step.
   * `done` is the short message shown when it worked; `failed` puts the error where it belongs.
   */
  async function save(key: string, action: () => Promise<unknown>, done: string, failed: (message: string) => void) {
    if (!outletId) return;
    setBusy(key);
    setFormError(null);
    setRowError(null);
    try {
      await action();
    } catch (e) {
      failed(errorMessage(e, t, { 0: 'error.upload' }));
      setBusy(null);
      return;
    }
    setForm(null);
    notify(done);
    // The save itself worked, so a failure from here on is a failed load, not a failed save.
    await reload();
    setBusy(null);
  }

  // The expiry date as typed. It is only read once all eight digits are there, so a
  // half-typed year ("20") is never mistaken for a two-digit one.
  const expiryDigits = expiry.replace(/\D/g, '').length;
  const parsedExpiry = expiryDigits === 8 ? parseTypedDate(expiry) : null;
  const expiresOn = parsedExpiry && parsedExpiry >= '2000-01-01' && parsedExpiry <= '2100-12-31' ? parsedExpiry : null;
  const expiryError =
    expiryDigits === 8 && !expiresOn ? t('docs.dateNotReal') : showMissing && !expiresOn ? t('error.date') : null;
  // The date said back in words, so a slip between day and month is caught before saving.
  const expiryReadBack = expiresOn
    ? `✓ ${formatDate(expiresOn, language)}${expiresOn < indiaToday() ? ` · ${t('docs.datePast')}` : ''}`
    : null;
  const nameMissing = type === 'OTHER' && name.trim().length < 2;
  const titleMissing = title.trim().length < 2;

  function saveLicence() {
    if (!expiresOn || nameMissing) return setShowMissing(true);
    if (!outletId) return;
    void save(
      'form',
      async () =>
        api.licences.create({
          outletId,
          type,
          name: type === 'OTHER' ? name.trim() : undefined,
          number: number.trim() || undefined,
          expiresOn,
          attachmentId: await uploadChosen(),
        }),
      t('common.saved'),
      setFormError,
    );
  }

  function renewLicence(licenceId: string) {
    if (!expiresOn) return setShowMissing(true);
    void save(
      'form',
      async () =>
        api.licences.update(licenceId, {
          expiresOn,
          number: number.trim() || undefined,
          attachmentId: await uploadChosen(),
        }),
      t('common.saved'),
      setFormError,
    );
  }

  function saveDocument() {
    if (!file || titleMissing) return setShowMissing(true);
    if (!outletId) return;
    void save(
      'form',
      async () => {
        const attachmentId = await uploadChosen();
        if (attachmentId) await api.documents.create({ outletId, category, title: title.trim(), attachmentId });
      },
      t('common.saved'),
      setFormError,
    );
  }

  function confirmRemoval() {
    if (!removal) return;
    const target = removal;
    const id = target.kind === 'licence' ? target.licence.id : target.document.id;
    setRemoval(null);
    void save(
      `remove-${id}`,
      () => (target.kind === 'licence' ? api.licences.remove(id) : api.documents.remove(id)),
      t('docs.removed'),
      (message) => setRowError({ id, message }),
    );
  }

  // An outlet holds one licence of each kind, so adding the same kind again replaces the current one.
  const replacing =
    form === 'licence'
      ? (licences?.find((licence) =>
          type === 'OTHER'
            ? licence.type === 'OTHER' && licence.name?.trim().toLowerCase() === name.trim().toLowerCase()
            : licence.type === type,
        ) ?? null)
      : null;

  const readingNote =
    reading === 'working' ? (
      <View style={styles.reading}>
        <ActivityIndicator color={theme.primary} />
        <ThemedText type="small" themeColor="textSecondary">
          {t('docs.reading')}
        </ThemedText>
      </View>
    ) : reading ? (
      <ThemedText type="small" themeColor={reading === 'filled' ? 'primary' : 'textSecondary'}>
        {reading === 'filled' ? `✓ ${t('docs.readFilled')}` : t('docs.readNothing')}
      </ThemedText>
    ) : null;

  /** The expiry date field: a number pad, the slashes put in as it is typed, the date said back underneath. */
  const expiryField = (label: string) => (
    <TextField
      label={label}
      value={expiry}
      onChangeText={(next) => setExpiry((current) => maskTypedDate(next, current))}
      placeholder={t('docs.datePlaceholder')}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={10}
      hint={expiryReadBack}
      error={expiryError}
    />
  );

  const openFile = (path: string) => void Linking.openURL(api.fileUrl(path));
  const stateColor = { VALID: theme.primary, EXPIRING: theme.warning, EXPIRED: theme.danger } as const;
  const stateIcon = { VALID: 'checkmark-circle', EXPIRING: 'time', EXPIRED: 'alert-circle' } as const;

  const licenceName = (licence: LicenceDto) => licence.name ?? t(`licenceType.${licence.type}`);
  const countdown = (licence: LicenceDto) =>
    licence.daysLeft < 0
      ? t('docs.expiredAgo', { count: -licence.daysLeft })
      : licence.daysLeft === 0
        ? t('docs.expiresToday')
        : t('docs.daysLeft', { count: licence.daysLeft });

  return (
    <Screen back title={t('docs.title')} subtitle={t('docs.help')} onRefresh={reload}>
      {outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setLicences(null);
                setDocuments(null);
                setLoadError(null);
                setRowError(null);
                setForm(null);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      <ErrorText message={loadError} onRetry={() => void reload()} />
      {(outletLoading || (licences === null && !loadError && outletId)) && <ActivityIndicator color={theme.primary} />}

      {/* ── Licences ── */}
      {licences !== null && (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('docs.licences')}
        </ThemedText>
      )}
      {licences?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('docs.noLicences')}
        </ThemedText>
      )}
      {licences?.map((licence) => {
        const color = stateColor[licence.state];
        const renewing = typeof form === 'object' && form !== null && form.renew === licence.id;
        return (
          <View
            key={licence.id}
            style={[styles.card, { borderColor: licence.state === 'VALID' ? theme.border : color }]}>
            <View style={styles.cardHeader}>
              <ThemedText type="default" style={styles.cardTitle}>
                {licenceName(licence)}
              </ThemedText>
              <Ionicons
                name={stateIcon[licence.state]}
                size={28}
                color={color}
                accessibilityLabel={t(`docs.state${licence.state}`)}
              />
            </View>
            <ThemedText type="smallBold" style={{ color }}>
              {t(`docs.state${licence.state}`)} · {countdown(licence)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(licence.state === 'EXPIRED' ? 'docs.expiredOn' : 'docs.expires', {
                date: formatDate(licence.expiresOn, language),
              })}
              {licence.number ? ` · ${licence.number}` : ''}
            </ThemedText>

            {renewing ? (
              <View style={styles.form}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('docs.readHint')}
                </ThemedText>
                <FileChooser value={file} onChange={(chosen) => void licenceFileChosen(chosen)} />
                {readingNote}
                <TextField
                  label={t('docs.number')}
                  value={number}
                  onChangeText={setNumber}
                  maxLength={60}
                  autoCapitalize="characters"
                />
                {expiryField(t('docs.newExpiry'))}
                <ErrorText message={formError} />
                <Button
                  label={t('docs.save')}
                  hint={reading === 'working' ? t('docs.reading') : undefined}
                  onPress={() => renewLicence(licence.id)}
                  loading={busy === 'form'}
                  disabled={reading === 'working'}
                />
                <Button label={t('common.cancel')} variant="link" onPress={() => setForm(null)} />
              </View>
            ) : (
              // The document gets a row of its own: three buttons side by side do not fit a phone.
              <View style={styles.cardActions}>
                {licence.file ? (
                  <Button label={t('docs.view')} variant="secondary" onPress={() => openFile(licence.file!.path)} />
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('docs.noFile')}
                  </ThemedText>
                )}
                <View style={styles.actions}>
                  <View style={styles.action}>
                    <Button
                      fill
                      label={t('docs.renew')}
                      variant="secondary"
                      onPress={() => {
                        openForm({ renew: licence.id });
                        setNumber(licence.number ?? '');
                      }}
                    />
                  </View>
                  <View style={styles.action}>
                    <Button
                      fill
                      label={t('docs.remove')}
                      variant="danger"
                      loading={busy === `remove-${licence.id}`}
                      onPress={() => setRemoval({ kind: 'licence', licence })}
                    />
                  </View>
                </View>
                <ErrorText message={rowError?.id === licence.id ? rowError.message : null} />
              </View>
            )}
          </View>
        );
      })}

      {licences !== null &&
        (form === 'licence' ? (
          <View style={[styles.card, { borderColor: theme.primary }]}>
            <ThemedText type="default" style={styles.cardTitle}>
              {t('docs.addLicence')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('docs.readHint')}
            </ThemedText>
            <FileChooser value={file} onChange={(chosen) => void licenceFileChosen(chosen)} />
            {readingNote}
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('docs.licenceType')}
            </ThemedText>
            <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('docs.licenceType')}>
              {LICENCE_TYPES.map((value) => (
                <OptionChip
                  key={value}
                  label={t(`licenceType.${value}`)}
                  selected={type === value}
                  onPress={() => setType(value)}
                />
              ))}
            </View>
            {type === 'OTHER' && (
              <TextField
                label={t('docs.licenceName')}
                value={name}
                onChangeText={setName}
                maxLength={80}
                error={showMissing && nameMissing ? t('docs.nameNeeded') : null}
              />
            )}
            {replacing && (
              <ThemedText type="small" themeColor="warning">
                {t('docs.replaces', { name: licenceName(replacing) })}
              </ThemedText>
            )}
            <TextField
              label={t('docs.number')}
              value={number}
              onChangeText={setNumber}
              maxLength={60}
              autoCapitalize="characters"
            />
            {expiryField(t('docs.expiresOn'))}
            <ErrorText message={formError} />
            <Button
              label={t('docs.save')}
              hint={reading === 'working' ? t('docs.reading') : undefined}
              onPress={saveLicence}
              loading={busy === 'form'}
              disabled={reading === 'working'}
            />
            <Button label={t('common.cancel')} variant="link" onPress={() => setForm(null)} />
          </View>
        ) : (
          <Button icon="add" label={t('docs.addLicence')} variant="secondary" onPress={() => openForm('licence')} />
        ))}

      {/* ── Document vault ── */}
      {documents !== null && (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
          {t('docs.documents')}
        </ThemedText>
      )}
      {documents?.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('docs.noDocuments')}
        </ThemedText>
      )}
      {documents?.map((document) => (
        <View key={document.id} style={styles.rowBlock}>
          <View style={[styles.row, { borderColor: theme.border }]}>
            <Pressable accessibilityRole="button" onPress={() => openFile(document.file.path)} style={styles.rowMain}>
              <Ionicons
                name={document.file.mimeType === 'application/pdf' ? 'document-text' : 'image'}
                size={28}
                color={theme.primary}
              />
              <View style={styles.rowText}>
                <ThemedText type="default">{document.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t(`docCategory.${document.category}`)} · {formatDate(document.createdAt.slice(0, 10), language)}
                  {document.uploadedByEccs ? ` · ${t('docs.addedByEccs')}` : ''}
                </ThemedText>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('docs.remove')}
              disabled={busy === `remove-${document.id}`}
              onPress={() => setRemoval({ kind: 'document', document })}
              style={styles.rowDelete}>
              {busy === `remove-${document.id}` ? (
                <ActivityIndicator color={theme.danger} />
              ) : (
                <Ionicons name="trash-outline" size={24} color={theme.danger} />
              )}
            </Pressable>
          </View>
          <ErrorText message={rowError?.id === document.id ? rowError.message : null} />
        </View>
      ))}

      {documents !== null &&
        (form === 'document' ? (
          <View style={[styles.card, { borderColor: theme.primary }]}>
            <ThemedText type="default" style={styles.cardTitle}>
              {t('docs.addDocument')}
            </ThemedText>
            <TextField
              label={t('docs.documentTitle')}
              value={title}
              onChangeText={setTitle}
              placeholder={t('docs.documentTitlePlaceholder')}
              maxLength={100}
              error={showMissing && titleMissing ? t('docs.titleNeeded') : null}
            />
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('docs.documentCategory')}
            </ThemedText>
            <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('docs.documentCategory')}>
              {VAULT_CATEGORIES.map((value) => (
                <OptionChip
                  key={value}
                  label={t(`docCategory.${value}`)}
                  selected={category === value}
                  onPress={() => setCategory(value)}
                />
              ))}
            </View>
            <FileChooser
              value={file}
              onChange={setFile}
              error={showMissing && !file ? t('docs.fileNeeded') : null}
            />
            <ErrorText message={formError} />
            <Button label={t('docs.save')} onPress={saveDocument} loading={busy === 'form'} />
            <Button label={t('common.cancel')} variant="link" onPress={() => setForm(null)} />
          </View>
        ) : (
          <Button icon="add" label={t('docs.addDocument')} variant="secondary" onPress={() => openForm('document')} />
        ))}

      <ConfirmDialog
        visible={removal !== null}
        message={
          removal === null
            ? ''
            : removal.kind === 'licence'
              ? t('docs.removeLicenceConfirm', { name: licenceName(removal.licence) })
              : t('docs.removeDocumentConfirm', { name: removal.document.title })
        }
        confirmLabel={t('docs.remove')}
        danger
        onCancel={() => setRemoval(null)}
        onConfirm={confirmRemoval}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
  reading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  form: { gap: Spacing.two, marginTop: Spacing.two },
  cardActions: { gap: Spacing.two, marginTop: Spacing.one },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
  rowBlock: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Spacing.three },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    minHeight: MinTouchSize,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowDelete: { minWidth: MinTouchSize, minHeight: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
