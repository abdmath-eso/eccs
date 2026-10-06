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
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate, parseTypedDate, toTypedDate } from '@/lib/format';
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
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [licences, setLicences] = useState<LicenceDto[] | null>(null);
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  // For licences the file is uploaded as soon as it is chosen, so its details can be read into the form.
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [reading, setReading] = useState<'working' | 'filled' | 'nothing' | null>(null);
  // Counts the files chosen, so a slow answer about an earlier file is ignored.
  const latestChoice = useRef(0);

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
        setError(null);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, t));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId]);

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
    setError(null);
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
    setError(null);
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
      setError(errorMessage(e, t, { 0: 'error.upload' }));
    }
  }

  /** Uploads the chosen file, if any, and returns its id for attaching. */
  async function uploadChosen(): Promise<string | undefined> {
    if (uploadedId) return uploadedId;
    if (!file || !outletId) return undefined;
    const uploaded = await api.attachments.upload({ outletId, file: file.file, kind: 'DOCUMENT', fileName: file.name });
    return uploaded.id;
  }

  /** Runs a save, then reloads both lists so licences and their documents stay in step. */
  async function save(key: string, action: () => Promise<unknown>) {
    if (!outletId) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      const [licenceList, documentList] = await Promise.all([
        api.licences.list({ outletId }),
        api.documents.list(outletId),
      ]);
      setLicences(licenceList);
      setDocuments(documentList);
      setForm(null);
    } catch (e) {
      setError(errorMessage(e, t, { 0: 'error.upload' }));
    } finally {
      setBusy(null);
    }
  }

  function saveLicence() {
    const expiresOn = parseTypedDate(expiry);
    if (!expiresOn) return setError(t('error.date'));
    if (!outletId) return;
    void save('form', async () =>
      api.licences.create({
        outletId,
        type,
        name: type === 'OTHER' ? name.trim() : undefined,
        number: number.trim() || undefined,
        expiresOn,
        attachmentId: await uploadChosen(),
      }),
    );
  }

  function renewLicence(licenceId: string) {
    const expiresOn = parseTypedDate(expiry);
    if (!expiresOn) return setError(t('error.date'));
    void save('form', async () =>
      api.licences.update(licenceId, {
        expiresOn,
        number: number.trim() || undefined,
        attachmentId: await uploadChosen(),
      }),
    );
  }

  function saveDocument() {
    if (!file) return setError(t('docs.fileNeeded'));
    if (!outletId) return;
    void save('form', async () => {
      const attachmentId = await uploadChosen();
      if (attachmentId) await api.documents.create({ outletId, category, title: title.trim(), attachmentId });
    });
  }

  function confirmRemoval() {
    if (!removal) return;
    const target = removal;
    setRemoval(null);
    void save('remove', () =>
      target.kind === 'licence' ? api.licences.remove(target.licence.id) : api.documents.remove(target.document.id),
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

  const openFile = (path: string) => void Linking.openURL(api.fileUrl(path));
  const option = (selected: boolean) => [
    styles.option,
    { borderColor: selected ? theme.primary : theme.border },
    selected && { backgroundColor: theme.backgroundElement },
  ];
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
    <Screen back title={t('docs.title')} subtitle={t('docs.help')}>
      {outlets.length > 1 && (
        <View style={styles.options} accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <Pressable
              key={outlet.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: outlet.id === outletId }}
              onPress={() => {
                setLicences(null);
                setDocuments(null);
                setForm(null);
                choose(outlet.id);
              }}
              style={option(outlet.id === outletId)}>
              <ThemedText type="small" themeColor={outlet.id === outletId ? 'primary' : 'text'}>
                {outlet.name}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {form === null && <ErrorText message={error} />}
      {(outletLoading || (licences === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

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
                <TextField
                  label={t('docs.newExpiry')}
                  value={expiry}
                  onChangeText={setExpiry}
                  placeholder={t('docs.datePlaceholder')}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
                <ErrorText message={error} />
                <Button
                  label={t('docs.save')}
                  onPress={() => renewLicence(licence.id)}
                  loading={busy === 'form'}
                  disabled={!expiry.trim() || reading === 'working'}
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
                      onPress={() => setRemoval({ kind: 'licence', licence })}
                    />
                  </View>
                </View>
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
            <View style={styles.options}>
              {LICENCE_TYPES.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: type === value }}
                  onPress={() => setType(value)}
                  style={option(type === value)}>
                  <ThemedText type="default" themeColor={type === value ? 'primary' : 'text'}>
                    {t(`licenceType.${value}`)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            {type === 'OTHER' && (
              <TextField label={t('docs.licenceName')} value={name} onChangeText={setName} maxLength={80} />
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
            <TextField
              label={t('docs.expiresOn')}
              value={expiry}
              onChangeText={setExpiry}
              placeholder={t('docs.datePlaceholder')}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <ErrorText message={error} />
            <Button
              label={t('docs.save')}
              onPress={saveLicence}
              loading={busy === 'form'}
              disabled={!expiry.trim() || reading === 'working' || (type === 'OTHER' && name.trim().length < 2)}
            />
            <Button label={t('common.cancel')} variant="link" onPress={() => setForm(null)} />
          </View>
        ) : (
          <Button label={`+  ${t('docs.addLicence')}`} variant="secondary" onPress={() => openForm('licence')} />
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
        <View key={document.id} style={[styles.row, { borderColor: theme.border }]}>
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
            onPress={() => setRemoval({ kind: 'document', document })}
            style={styles.rowDelete}>
            <Ionicons name="trash-outline" size={24} color={theme.danger} />
          </Pressable>
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
            />
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('docs.documentCategory')}
            </ThemedText>
            <View style={styles.options}>
              {VAULT_CATEGORIES.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: category === value }}
                  onPress={() => setCategory(value)}
                  style={option(category === value)}>
                  <ThemedText type="default" themeColor={category === value ? 'primary' : 'text'}>
                    {t(`docCategory.${value}`)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <FileChooser value={file} onChange={setFile} />
            <ErrorText message={error} />
            <Button
              label={t('docs.save')}
              onPress={saveDocument}
              loading={busy === 'form'}
              disabled={title.trim().length < 2}
            />
            <Button label={t('common.cancel')} variant="link" onPress={() => setForm(null)} />
          </View>
        ) : (
          <Button label={`+  ${t('docs.addDocument')}`} variant="secondary" onPress={() => openForm('document')} />
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
  option: {
    minHeight: MinTouchSize,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  sectionGap: { marginTop: Spacing.four },
  reading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  form: { gap: Spacing.two, marginTop: Spacing.two },
  cardActions: { gap: Spacing.two, marginTop: Spacing.one },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
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
