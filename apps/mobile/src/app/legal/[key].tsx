import { isLegalDocumentKey, LEGAL_DOCUMENTS, type LegalDocumentDto } from '@eccs/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { legalHeadings, LegalText } from '@/components/legal-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { Expandable } from '@/components/ui/expandable';
import { Screen } from '@/components/ui/screen';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { scrollToY } from '@/lib/scroll';
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
  const scrollRef = useRef<ScrollView>(null);
  // Where the document starts in the page, and where each main heading starts in the document.
  const documentY = useRef(0);
  const headingY = useRef<number[]>([]);

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
  const headings = shown ? legalHeadings(shown.markdown) : [];

  return (
    <Screen
      back
      title={t(`legal.doc.${key}`)}
      subtitle={shown ? t('legal.version', { date: formatDate(shown.version, language) }) : undefined}
      scrollRef={scrollRef}>
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
      {/* A contents list that jumps to each section, as GOV.UK's long guidance pages have; folded,
          so the words themselves still start on the first screen. */}
      {headings.length > 2 && (
        <Expandable title={t('legal.contents')} icon="list-outline">
          {headings.map((heading, position) => (
            <Pressable
              key={position}
              accessibilityRole="link"
              onPress={() => scrollToY(scrollRef, documentY.current + (headingY.current[position] ?? 0))}
              style={({ pressed }) => [styles.contentsRow, pressed && { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="default" themeColor="primary">
                {heading}
              </ThemedText>
            </Pressable>
          ))}
        </Expandable>
      )}
      {/* The screen's title already names the document, so its own first line is left out. */}
      {shown && (
        <View onLayout={(event) => (documentY.current = event.nativeEvent.layout.y)}>
          <LegalText
            markdown={shown.markdown}
            skipTitle
            onHeading={(position, y) => {
              headingY.current[position] = y;
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  contentsRow: { minHeight: MinTouchSize, justifyContent: 'center', borderRadius: Spacing.two },
});
