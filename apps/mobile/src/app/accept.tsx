import { ApiError } from '@eccs/api-client';
import { isLegalDocumentKey, LEGAL_DOCUMENTS, type LegalPendingDto } from '@eccs/shared';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { LegalDocList, LegalDocRow } from '@/components/legal-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { CheckboxRow } from '@/components/ui/checkbox-row';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';

/**
 * "Before you start": the Terms of Service and the Privacy Policy (and, for the Owner,
 * the refund and data-processing terms), agreed to right after logging in and before
 * anything else. The root layout shows only this screen while there is something to
 * agree to, so for the Owner's first login it comes before their new PIN.
 *
 * It follows clickwrap practice for India (King Stubb & Kasiva; iPleaders; Mondaq):
 * each document can be opened and read here; one sentence says plainly that this is a
 * binding agreement; the boxes start unticked and only the person's own tap ticks
 * them; nothing is agreed until every box is ticked ("Agree and continue" stays active and,
 * tapped too early, marks the boxes still to tick and says so: 22 Oct 2026). The Privacy
 * Policy has a box of its own, apart from the terms (DPDP Rules 2025, Rule 3: notice
 * and consent kept separate and plain). The server records who, when, which version
 * and from which phone. Kept short on purpose: the founder finds long screens cluttered.
 */
export default function AcceptTermsScreen() {
  const { pendingTerms } = useSession();
  // Kept here, outside the form, so a message survives the form starting again.
  const [error, setError] = useState<string | null>(null);
  // When the documents change while this screen is open (one was updated), the form
  // starts again with every box unticked: an agreement is to the words shown now.
  const setKey = pendingTerms.map((document) => `${document.key}@${document.version}`).join('|');
  return <AcceptForm key={setKey} pending={pendingTerms} error={error} onError={setError} />;
}

/**
 * A box still to tick after "Agree and continue" was tapped: a red bar down its side and a line
 * above it saying what to do, as GOV.UK marks a question in error.
 */
function Unticked({ marked, children }: { marked: boolean; children: ReactNode }) {
  const theme = useTheme();
  const { t } = useSession();
  // Always the same wrapper, so the box is not rebuilt (and a screen reader does not lose its place)
  // when the tap that ticks it takes the mark away.
  return (
    <View style={marked && [styles.marked, { borderColor: theme.danger }]}>
      {marked && <ErrorText message={t('legal.accept.tickThis')} />}
      {children}
    </View>
  );
}

const checkboxOf = (key: string) =>
  // A document this version of the app does not know yet goes with the terms box, so it is never agreed to unseen.
  LEGAL_DOCUMENTS.find((document) => document.key === key)?.checkbox ?? 'terms';

interface AcceptFormProps {
  pending: LegalPendingDto[];
  error: string | null;
  onError: (message: string | null) => void;
}

function AcceptForm({ pending, error, onError }: AcceptFormProps) {
  const { t, user, language, acceptTerms, signOut } = useSession();
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [busy, setBusy] = useState<'agree' | 'leave' | null>(null);
  // True once "Agree and continue" was tapped with a box unticked: the unticked boxes are then marked.
  const [tried, setTried] = useState(false);

  // The Owner agrees for the restaurant as a business, and the words say so.
  const restaurant = user?.memberships.find((m) => m.role === 'OWNER')?.organizationName ?? null;
  const titleOf = (document: LegalPendingDto) =>
    isLegalDocumentKey(document.key) ? t(`legal.doc.${document.key}`) : document.title;
  const termsDocuments = pending.filter((document) => checkboxOf(document.key) === 'terms');
  const needsPrivacy = pending.some((document) => checkboxOf(document.key) === 'privacy');
  // Agreed to an earlier version of any of them: say these are updated terms.
  const updated = pending.some((document) => document.acceptedVersion !== null);
  const ready = (termsDocuments.length === 0 || agreedTerms) && (!needsPrivacy || agreedPrivacy);
  // The boxes not ticked yet: the message says "both" only while both are still to tick.
  const stillToTick = (termsDocuments.length > 0 && !agreedTerms ? 1 : 0) + (needsPrivacy && !agreedPrivacy ? 1 : 0);

  // "Terms of Service", or "Terms of Service, Refund and Cancellation Policy and Data Processing Terms".
  const names = termsDocuments.map(titleOf);
  const documents =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('legal.accept.and')} ${names[names.length - 1]}` : (names[0] ?? '');

  async function agree() {
    // Tapped before every box is ticked: say so beside the button, and mark the boxes still to tick.
    if (!ready) {
      setTried(true);
      onError(null);
      return;
    }
    setBusy('agree');
    onError(null);
    try {
      // Once saved, the app moves on by itself: to the home screen, or first to the Owner's new PIN.
      await acceptTerms();
    } catch (e) {
      onError(e instanceof ApiError && e.status === 400 ? t('legal.accept.changed') : errorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function notNow() {
    setBusy('leave');
    onError(null);
    // Back to the PIN pad (or the phone number screen): nothing in the app can be used without agreeing.
    await signOut();
  }

  return (
    <Screen
      title={t(updated ? 'legal.accept.titleUpdated' : 'legal.accept.title')}
      subtitle={restaurant ? t('legal.accept.introOwner', { restaurant }) : t('legal.accept.intro')}
      footer={
        <>
          <ErrorText message={tried && !ready ? t(stillToTick > 1 ? 'legal.accept.tickBoth' : 'legal.accept.tickOne') : error} />
          {/* Never greyed out: tapped too early it says what is missing (GOV.UK; the 7 Oct rule). */}
          <Button
            label={t('legal.accept.continue')}
            onPress={() => void agree()}
            loading={busy === 'agree'}
            disabled={busy !== null}
          />
        </>
      }>
      <LegalDocList>
        {pending.map((document, index) => (
          <LegalDocRow
            key={document.key}
            first={index === 0}
            title={titleOf(document)}
            hint={t('legal.open')}
            onPress={() => router.push({ pathname: '/legal/[key]', params: { key: document.key, version: document.version } })}
          />
        ))}
      </LegalDocList>

      {language !== 'EN' && (
        <ThemedText type="small" themeColor="textSecondary">
          {t(restaurant ? 'legal.accept.englishOnlyOwner' : 'legal.accept.englishOnly')}
        </ThemedText>
      )}

      {termsDocuments.length > 0 && (
        <Unticked marked={tried && !agreedTerms}>
          <CheckboxRow
            label={
              restaurant
                ? t('legal.accept.agreeTermsOwner', { restaurant, documents })
                : t('legal.accept.agreeTerms', { documents })
            }
            checked={agreedTerms}
            onChange={setAgreedTerms}
            disabled={busy !== null}
          />
        </Unticked>
      )}
      {needsPrivacy && (
        <Unticked marked={tried && !agreedPrivacy}>
          <CheckboxRow
            label={t('legal.accept.agreePrivacy')}
            checked={agreedPrivacy}
            onChange={setAgreedPrivacy}
            disabled={busy !== null}
          />
        </Unticked>
      )}

      <Button
        label={t('legal.accept.notNow')}
        hint={t('legal.accept.notNowNote')}
        variant="link"
        onPress={() => void notNow()}
        loading={busy === 'leave'}
        disabled={busy !== null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  marked: { borderStartWidth: 4, paddingStart: Spacing.three, gap: Spacing.two },
});
