import { isLegalDocumentKey, LEGAL_DOCUMENTS, type LegalDocumentDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { LegalText } from '@/components/legal-parts';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * One legal document in full: its title, its version (the date it came into force)
 * and its words. Opened from the acceptance screen and from the profile, so it works
 * whether or not anyone is logged in. `version`, when given, is the version the
 * person is being asked to agree to.
 *
 * The words come from the server, which is what an agreement is recorded against.
 * The copy built into the app is shown straight away while they load (or when there
 * is no signal), as long as it is the version asked for.
 */
export default function LegalDocumentScreen() {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const params = useLocalSearchParams<{ key?: string; version?: string }>();
  const key = params.key ?? '';
  const [fetched, setFetched] = useState<LegalDocumentDto | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLegalDocumentKey(key)) return;
    let cancelled = false;
    api.legal.document(key).then(
      (document) => {
        if (cancelled) return;
        setFetched(document);
        setFailure(null);
      },
      (error: unknown) => {
        if (!cancelled) setFailure(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, key, attempt]);

  if (!isLegalDocumentKey(key)) {
    return (
      <Screen back>
        <ErrorText message={t('legal.notFound')} />
      </Screen>
    );
  }

  const bundled = LEGAL_DOCUMENTS.find((document) => document.key === key);
  const shown =
    fetched ?? (bundled && (!params.version || params.version === bundled.version) ? bundled : null);

  return (
    <Screen
      back
      title={t(`legal.doc.${key}`)}
      subtitle={shown ? t('legal.version', { date: formatDate(shown.version, language) }) : undefined}>
      {!shown && failure === null && <ActivityIndicator color={theme.primary} />}
      {!shown && failure !== null && (
        <ErrorText
          message={errorMessage(failure, t)}
          onRetry={() => {
            setFailure(null);
            setAttempt((count) => count + 1);
          }}
        />
      )}
      {/* The screen's title already names the document, so its own first line is left out. */}
      {shown && <LegalText markdown={shown.markdown} skipTitle />}
    </Screen>
  );
}
