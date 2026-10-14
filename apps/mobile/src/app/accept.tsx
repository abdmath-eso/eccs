import { ApiError } from '@eccs/api-client';
import { isLegalDocumentKey, LEGAL_DOCUMENTS, type LegalPendingDto } from '@eccs/shared';
import { router } from 'expo-router';
import { useState } from 'react';

import { LegalDocList, LegalDocRow } from '@/components/legal-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { CheckboxRow } from '@/components/ui/checkbox-row';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
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
 * them; "Agree and continue" stays disabled until every box is ticked. The Privacy
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

  // The Owner agrees for the restaurant as a business, and the words say so.
  const restaurant = user?.memberships.find((m) => m.role === 'OWNER')?.organizationName ?? null;
  const titleOf = (document: LegalPendingDto) =>
    isLegalDocumentKey(document.key) ? t(`legal.doc.${document.key}`) : document.title;
  const termsDocuments = pending.filter((document) => checkboxOf(document.key) === 'terms');
  const needsPrivacy = pending.some((document) => checkboxOf(document.key) === 'privacy');
  // Agreed to an earlier version of any of them: say these are updated terms.
  const updated = pending.some((document) => document.acceptedVersion !== null);
  const ready = (termsDocuments.length === 0 || agreedTerms) && (!needsPrivacy || agreedPrivacy);

  // "Terms of Service", or "Terms of Service, Refund and Cancellation Policy and Data Processing Terms".
  const names = termsDocuments.map(titleOf);
  const documents =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('legal.accept.and')} ${names[names.length - 1]}` : (names[0] ?? '');

  async function agree() {
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
          <ErrorText message={error} />
          <Button
            label={t('legal.accept.continue')}
            onPress={() => void agree()}
            loading={busy === 'agree'}
            disabled={!ready || busy !== null}
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
      )}
      {needsPrivacy && (
        <CheckboxRow
          label={t('legal.accept.agreePrivacy')}
          checked={agreedPrivacy}
          onChange={setAgreedPrivacy}
          disabled={busy !== null}
        />
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
