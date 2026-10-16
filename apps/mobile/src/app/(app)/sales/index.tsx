import { LEAD_STAGES, type LeadRowDto, type LeadStage } from '@eccs/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SavedCopyNote } from '@/components/field-sync-parts';
import { LeadCard } from '@/components/lead-parts';
import { ThemedText } from '@/components/themed-text';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { applyLeadRowPending, fieldSummary, newLeadsOnPhone } from '@/lib/offline/field-ops';
import { outbox, useOutbox } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';
import { useLeadList, useMe } from '@/lib/use-leads';

/** The list's filters: every open or parked lead, one stage, the parked or the lost. */
type Filter = 'ALL' | LeadStage | 'PARKED' | 'LOST';
const FILTERS: Filter[] = ['ALL', ...LEAD_STAGES, 'PARKED', 'LOST'];

function matches(lead: LeadRowDto, filter: Filter) {
  if (filter === 'ALL') return lead.status !== 'LOST';
  if (filter === 'PARKED' || filter === 'LOST') return lead.status === filter;
  return lead.status === 'OPEN' && lead.stage === filter;
}

/** Search by the name, area, contact or phone, in any order of words. */
function found(lead: LeadRowDto, words: string[]) {
  const text = [lead.businessName, lead.area, lead.contactName, lead.contactPhone].filter(Boolean).join(' ').toLowerCase();
  return words.every((word) => text.includes(word) || (/\d/.test(word) && (lead.contactPhone ?? '').includes(word.replace(/\D/g, ''))));
}

/**
 * Leads (B2): the BDE's own, newest activity first, with a row of stage chips, a search
 * box, and the waiting ones marked in words and an icon (the Sales page's "stale" rule:
 * nothing logged for five days, or the next step's date passed). The whole list is kept
 * on the phone, so filtering and searching work without signal, and leads logged or
 * moved on the phone show at once.
 *
 * PATTERN FOLLOWED: the filter-chip row over a list (Material 3's filter chips; Pipedrive's
 * and Zoho CRM's mobile lists filtered by stage), and Pipedrive's "rotting" mark on a
 * deal left too long (support.pipedrive.com/article/the-rotting-feature).
 */
export default function LeadsScreen() {
  const theme = useTheme();
  const { t } = useSession();
  const me = useMe();
  const box = useOutbox();
  const { saved, error, load } = useLeadList();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const hasSignal = box.online !== false;

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const server = saved?.data.leads ?? null;
  const known = new Set((server ?? []).map((lead) => lead.id));
  const all = server ? [...newLeadsOnPhone(box.ops, known, me), ...server.map((lead) => applyLeadRowPending(lead, box.ops, me))] : null;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (all ?? []).filter((lead) => matches(lead, filter) && found(lead, words));

  return (
    <Screen
      title={t('bde.leads.title')}
      // Logging a lead is one tap away at the top, so the list itself starts straight under the title.
      headerRight={
        <Pressable accessibilityRole="button" onPress={() => router.push('/sales/new')} style={styles.add} hitSlop={8}>
          <Ionicons name="add-circle" size={24} color={theme.primary} />
          <ThemedText type="smallBold" themeColor="primary">
            {t('bde.logLead')}
          </ThemedText>
        </Pressable>
      }
      onRefresh={async () => {
        outbox.kick();
        await load();
      }}>
      <TextField value={search} onChangeText={setSearch} placeholder={t('bde.leads.search')} accessibilityLabel={t('bde.leads.search')} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((value) => (
          <OptionChip key={value} label={t(`bde.filter.${value}`)} selected={filter === value} onPress={() => setFilter(value)} />
        ))}
      </ScrollView>

      <ErrorText message={error} onRetry={() => void load()} />
      {!hasSignal && saved && <SavedCopyNote at={saved.at} />}
      {all === null && !error && <ActivityIndicator color={theme.primary} />}

      {all && (
        <ThemedText type="small" themeColor="textSecondary">
          {t('bde.leads.count', { count: shown.length })}
        </ThemedText>
      )}
      <View style={styles.list}>
        {shown.map((lead) => {
          const summary = fieldSummary(box.ops, 'lead', lead.id);
          return (
            <LeadCard
              key={lead.id}
              lead={lead}
              unsent={summary.unsent > 0}
              sending={hasSignal}
              onPress={() => router.push({ pathname: '/sales/[leadId]', params: { leadId: lead.id } })}
            />
          );
        })}
      </View>
      {all && shown.length === 0 && (
        <ThemedText type="default" themeColor="textSecondary">
          {t(words.length > 0 ? 'bde.leads.noMatch' : 'bde.leads.none')}
        </ThemedText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: MinTouchSize },
  chips: { gap: Spacing.two, paddingVertical: Spacing.half },
  list: { gap: Spacing.two },
});
