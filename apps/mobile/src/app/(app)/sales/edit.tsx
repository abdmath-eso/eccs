import type { LeadDetailDto, LeadUpdateInput } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { LeadForm, leadFormProblems, phoneInput, type LeadFormValues } from '@/components/lead-form';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { useTheme } from '@/hooks/use-theme';
import { queueUpdate } from '@/lib/sales';
import { useSession } from '@/lib/session';
import { useLead } from '@/lib/use-leads';

const valuesOf = (lead: LeadDetailDto): LeadFormValues => ({
  businessName: lead.businessName,
  area: lead.area ?? '',
  address: lead.address ?? '',
  contactName: lead.contactName ?? '',
  phone: lead.contactPhone ? lead.contactPhone.replace(/^\+91/, '') : '',
  kitchens: lead.kitchens,
  source: lead.source,
  referrerName: lead.referrerName ?? '',
});

/** Change a lead's details (B2). Only what changed is sent, through the outbox, so it works without signal. */
export default function EditLeadScreen() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>();
  const theme = useTheme();
  const { t } = useSession();
  const { view, error, load } = useLead(leadId);
  if (!view) {
    return (
      <Screen back title={t('bde.step.edit')}>
        <ErrorText message={error} onRetry={() => void load()} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }
  return <EditForm lead={view.lead} />;
}

function EditForm({ lead }: { lead: LeadDetailDto }) {
  const { t } = useSession();
  const notify = useSnackbar();
  const [before] = useState(() => valuesOf(lead));
  const [values, setValues] = useState(before);
  const [showMissing, setShowMissing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    const problems = leadFormProblems(values);
    if (problems.businessName || problems.phone) return setShowMissing(true);
    const changes: LeadUpdateInput = {};
    const text = (value: string) => value.trim() || null;
    if (values.businessName.trim() !== before.businessName) changes.businessName = values.businessName.trim();
    if (values.area !== before.area) changes.area = text(values.area);
    if (values.address !== before.address) changes.address = text(values.address);
    if (values.contactName !== before.contactName) changes.contactName = text(values.contactName);
    if (values.phone !== before.phone) changes.contactPhone = phoneInput(values.phone);
    if (values.kitchens !== before.kitchens) changes.kitchens = values.kitchens;
    if (values.source !== before.source) changes.source = values.source;
    // A referrer goes with a referral only: changing away from one clears it.
    if (values.referrerName !== before.referrerName || values.source !== before.source) {
      changes.referrerName = values.source === 'CHEF_REFERRAL' || values.source === 'PARTNER_REFERRAL' ? text(values.referrerName) : null;
    }
    if (Object.keys(changes).length > 0) {
      try {
        await queueUpdate(lead.id, changes);
      } catch {
        return setProblem(t('bde.form.notStored'));
      }
      notify(t('common.saved'));
    }
    router.back();
  }

  return (
    <Screen
      back
      title={t('bde.step.edit')}
      subtitle={lead.businessName}
      footer={
        <>
          <ErrorText message={problem} />
          <Button label={t('bde.form.saveChanges')} icon="checkmark" onPress={() => void save()} />
        </>
      }>
      <LeadForm values={values} onChange={setValues} showMissing={showMissing} />
    </Screen>
  );
}
