import Ionicons from '@expo/vector-icons/Ionicons';
import {
  DOCUMENT_CATEGORIES,
  LICENCE_TYPES,
  type DocumentCategory,
  type DocumentDto,
  type LicenceDto,
  type LicenceType,
} from '@eccs/shared';
import { useEffect, useState } from 'react';
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
import { formatDate, parseTypedDate } from '@/lib/format';
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

  useEffect(() => {
    if (!outletId) return;
    let cancelled = false;
    (async () => {
      try {
        const [licenceList, documentList] = await Promise.all([api.licences.list({ outletId }), api.documents.list(outletId)]);
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
    setError(null);
  }

  /** Uploads the chosen file, if any, and returns its id for attaching. */
  async function uploadChosen(): Promise<string | undefined> {
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
      const [licenceList, documentList] = await Promise.all([api.licences.list({ outletId }), api.documents.list(outletId)]);
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
    void save('form', async () => api.licences.update(licenceId, { expiresOn, attachmentId: await uploadChosen() }));
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
          <View key={licence.id} style={[styles.card, { borderColor: licence.state === 'VALID' ? theme.border : color }]}>
            <View style={styles.cardHeader}>
              <ThemedText type="default" style={styles.cardTitle}>
                {licenceName(licence)}
              </ThemedText>
              <Ionicons name={stateIcon[licence.state]} size={28} color={color} accessibilityLabel={t(`docs.state${licence.state}`)} />
            </View>
            <ThemedText type="smallBold" style={{ color }}>
              {t(`docs.state${licence.state}`)} · {countdown(licence)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(licence.state === 'EXPIRED' ? 'docs.expiredOn' : 'docs.expires', { date: formatDate(licence.expiresOn, language) })}
              {licence.number ? ` · ${licence.number}` : ''}
            </ThemedText>

            {renewing ? (
              <View style={styles.form}>
                <TextField
                  label={t('docs.newExpiry')}
                  value={expiry}
                  onChangeText={setExpiry}
                  placeholder={t('docs.datePlaceholder')}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  autoFocus
                />
                <FileChooser value={file} onChange={setFile} />
                <ErrorText message={error} />
                <Button label={t('docs.save')} onPress={() => renewLicence(licence.id)} loading={busy === 'form'} disabled={!expiry.trim()} />
                <Button label={t('common.cancel')} variant="link" onPress={() => setForm(null)} />
              </View>
            ) : (
              <View style={styles.actions}>
                {licence.file ? (
                  <View style={styles.action}>
                    <Button label={t('docs.view')} variant="secondary" onPress={() => openFile(licence.file!.path)} />
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.action}>
                    {t('docs.noFile')}
                  </ThemedText>
                )}
                <Button label={t('docs.renew')} variant="secondary" onPress={() => openForm({ renew: licence.id })} />
                <Button label={t('docs.remove')} variant="danger" onPress={() => setRemoval({ kind: 'licence', licence })} />
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
            {type === 'OTHER' && <TextField label={t('docs.licenceName')} value={name} onChangeText={setName} maxLength={80} />}
            {replacing && (
              <ThemedText type="small" themeColor="warning">
                {t('docs.replaces', { name: licenceName(replacing) })}
              </ThemedText>
            )}
            <TextField label={t('docs.number')} value={number} onChangeText={setNumber} maxLength={60} autoCapitalize="characters" />
            <TextField
              label={t('docs.expiresOn')}
              value={expiry}
              onChangeText={setExpiry}
              placeholder={t('docs.datePlaceholder')}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <FileChooser value={file} onChange={setFile} />
            <ErrorText message={error} />
            <Button
              label={t('docs.save')}
              onPress={saveLicence}
              loading={busy === 'form'}
              disabled={!expiry.trim() || (type === 'OTHER' && name.trim().length < 2)}
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
            <Button label={t('docs.save')} onPress={saveDocument} loading={busy === 'form'} disabled={title.trim().length < 2} />
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
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, fontWeight: 700, fontSize: 18 },
  form: { gap: Spacing.two, marginTop: Spacing.two },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  action: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Spacing.three },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, minHeight: MinTouchSize },
  rowText: { flex: 1, gap: Spacing.half },
  rowDelete: { minWidth: MinTouchSize, minHeight: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
