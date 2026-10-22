import Ionicons from '@expo/vector-icons/Ionicons';
import { freeCheckServices, quoteTotals, type QuoteOptionDto } from '@eccs/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Stepper } from '@/components/lead-form';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { formatRupees } from '@/lib/format';
import { fieldCache } from '@/lib/offline/field-cache';
import { isNoSignal, outbox } from '@/lib/offline/outbox';
import { useSession } from '@/lib/session';
import { useLead } from '@/lib/use-leads';

const key = (option: Pick<QuoteOptionDto, 'kind' | 'refId'>) => `${option.kind}:${option.refId}`;

/**
 * Send a quote (B2): pick from ECCS's catalogue, with the prices before GST, then WhatsApp
 * opens with the message and the quote's own link typed in, from the BDE's phone. It is
 * B1's quote (the same prices, numbering, public page and the record of the owner opening
 * it); the server makes it, so it needs signal. After a free check, the services that fix
 * what it found are ticked already; for "Send plan" the plan is.
 *
 * PATTERN FOLLOWED: one plan or none as radio buttons, any number of services as checkboxes
 * (Material 3: radio buttons for one choice from a list, checkboxes for several; GOV.UK's radios
 * and checkboxes), each a plain row with a thin line between, as one list rather than a box per
 * line (Nielsen Norman Group, cards against lists), with the quantity under a chosen line.
 */
export default function SendQuoteScreen() {
  const { leadId, plan } = useLocalSearchParams<{ leadId: string; plan?: string }>();
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const { view } = useLead(leadId);
  const [options, setOptions] = useState<QuoteOptionDto[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [noSignal, setNoSignal] = useState(false);
  const lead = view?.lead ?? null;
  // The latest free check's findings, for ticking the services that fix them.
  const scorecard = lead?.activities.find((entry) => entry.kind === 'CHECK_DONE' && entry.scorecard)?.scorecard ?? null;
  const kitchens = lead?.kitchens ?? 1;
  const ready = lead !== null;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    api.sales
      .quoteOptions()
      .then((list) => {
        if (cancelled) return;
        setOptions(list);
        const pick: Record<string, number> = {};
        if (plan) {
          const cheapest = list.find((option) => option.kind === 'PLAN');
          if (cheapest) pick[key(cheapest)] = kitchens;
        } else if (scorecard) {
          for (const code of freeCheckServices(scorecard.answers)) {
            const service = list.find((option) => option.serviceCode === code);
            if (service) pick[key(service)] = 1;
          }
        }
        setChosen((current) => current ?? pick);
        outbox.noteReachable(true);
      })
      .catch((e) => {
        if (cancelled) return;
        if (isNoSignal(e)) {
          outbox.noteReachable(false);
          setNoSignal(true);
        } else setError(errorMessage(e, t));
      });
    return () => {
      cancelled = true;
    };
    // Chosen once the options arrive; the free check and plan are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ready]);

  if (!lead || (!options && !noSignal && !error)) {
    return (
      <Screen back title={t('bde.step.quote')}>
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  const picks = chosen ?? {};
  const lines = (options ?? []).filter((option) => picks[key(option)]).map((option) => ({ option, quantity: picks[key(option)]! }));
  const plans = (options ?? []).filter((option) => option.kind === 'PLAN');
  const noPlan = !plans.some((option) => picks[key(option)]);
  const totals = quoteTotals(lines.map(({ option, quantity }) => ({ amountPaise: option.unitPaise * quantity, gstRatePercent: option.gstRatePercent })));
  const suggested = new Set(scorecard ? freeCheckServices(scorecard.answers) : []);

  function toggle(option: QuoteOptionDto) {
    setError(null);
    setChosen((current) => {
      const next = { ...(current ?? {}) };
      if (next[key(option)]) delete next[key(option)];
      else next[key(option)] = option.kind === 'PLAN' ? kitchens : 1;
      return next;
    });
  }

  /** One plan at most: choosing a plan sets aside any other, keeping the kitchens already set; null is "No plan". */
  function choosePlan(option: QuoteOptionDto | null) {
    setError(null);
    setChosen((current) => {
      const next = { ...(current ?? {}) };
      const before = plans.map((plan) => next[key(plan)]).find(Boolean);
      for (const plan of plans) delete next[key(plan)];
      if (option) next[key(option)] = before ?? kitchens;
      return next;
    });
  }

  async function send() {
    if (!lead || lines.length === 0) return setError(t('bde.quote.pickOne'));
    setSending(true);
    setError(null);
    try {
      const quote = await api.sales.addQuote(lead.id, { lines: lines.map(({ option, quantity }) => ({ kind: option.kind, refId: option.refId, quantity })) });
      const sent = await api.sales.sendQuote(quote.id);
      await Linking.openURL(sent.whatsappUrl).catch(() => undefined);
      // The lead is Quoted now: keep the server's copy on the phone.
      fieldCache.putLead(await api.sales.lead(lead.id));
      notify(t(sent.hasPhone ? 'bde.quote.ready' : 'bde.quote.readyChoose'));
      router.back();
    } catch (e) {
      if (isNoSignal(e)) setNoSignal(true);
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  }

  /** A plan (a radio: one at most) or a service (a box to tick: any number), as a plain row with a thin line above all but the first. */
  const row = (option: QuoteOptionDto, index: number) => {
    const quantity = picks[key(option)];
    const plan = option.kind === 'PLAN';
    const price = `${formatRupees(option.unitPaise, language)}${option.cycle ? ` ${t(`bde.quote.cycle.${option.cycle}`)}` : ''}`;
    const mark = plan ? (quantity ? 'radio-button-on' : 'radio-button-off') : quantity ? 'checkbox' : 'square-outline';
    return (
      <View key={key(option)} style={index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
        <Pressable
          accessibilityRole={plan ? 'radio' : 'checkbox'}
          accessibilityState={{ checked: Boolean(quantity) }}
          onPress={() => (plan ? choosePlan(option) : toggle(option))}
          style={({ pressed }) => [styles.optionMain, pressed && { backgroundColor: theme.backgroundElement }]}>
          <Ionicons name={mark} size={26} color={quantity ? theme.primary : theme.textSecondary} style={styles.mark} />
          <View style={styles.flex}>
            <ThemedText type="default" style={quantity ? styles.bold : undefined}>
              {option.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {price}
            </ThemedText>
            {option.serviceCode && suggested.has(option.serviceCode) && (
              <ThemedText type="smallBold" themeColor="warning">
                {t('bde.quote.fromCheck')}
              </ThemedText>
            )}
          </View>
        </Pressable>
        {/* The quantity sits under a chosen line, so a long service name keeps the width. */}
        {quantity ? (
          <View style={styles.quantity}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
              {t(option.kind === 'PLAN' ? 'bde.quote.kitchens' : 'bde.quote.quantity')}
            </ThemedText>
            <Stepper
              value={quantity}
              min={1}
              max={200}
              label={option.name}
              less={t('bde.form.fewer')}
              more={t('bde.form.more')}
              color={theme.primary}
              background={theme.backgroundElement}
              onChange={(next) => setChosen((current) => ({ ...(current ?? {}), [key(option)]: next }))}
            />
          </View>
        ) : null}
      </View>
    );
  };

  const services = (options ?? [])
    .filter((option) => option.kind === 'SERVICE')
    .sort((a, b) => Number(Boolean(b.serviceCode && suggested.has(b.serviceCode))) - Number(Boolean(a.serviceCode && suggested.has(a.serviceCode))));

  return (
    <Screen
      back
      title={t('bde.step.quote')}
      subtitle={lead.businessName}
      footer={
        <>
          {lines.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {t('bde.quote.totals', { before: formatRupees(totals.subtotalPaise, language), gst: formatRupees(totals.gstPaise, language), total: formatRupees(totals.totalPaise, language) })}
            </ThemedText>
          )}
          <ErrorText message={error} />
          {/* Pressable with nothing chosen: it then says what is missing, rather than sitting greyed out. */}
          <Button icon="logo-whatsapp" label={t('bde.quote.send')} loading={sending} disabled={noSignal} onPress={() => void send()} />
        </>
      }
      // How the prices are given, for reading once: the total with GST shows above Send once something is chosen.
      about={options ? t('bde.quote.beforeGst') : undefined}>
      {noSignal && <Notice tone="warning" text={t('bde.quote.needsSignal')} />}
      {plans.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
            {t('bde.quote.plans')}
          </ThemedText>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('bde.quote.plans')}>
            {plans.map(row)}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: noPlan }}
              onPress={() => choosePlan(null)}
              style={({ pressed }) => [
                styles.optionMain,
                { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
                pressed && { backgroundColor: theme.backgroundElement },
              ]}>
              <Ionicons
                name={noPlan ? 'radio-button-on' : 'radio-button-off'}
                size={26}
                color={noPlan ? theme.primary : theme.textSecondary}
                style={styles.mark}
              />
              <ThemedText type="default" style={[styles.flex, noPlan && styles.bold]}>
                {t('bde.quote.noPlan')}
              </ThemedText>
            </Pressable>
          </View>
        </>
      )}
      {services.length > 0 && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap} accessibilityRole="header">
            {t('bde.quote.services')}
          </ThemedText>
          <View>{services.map(row)}</View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: 700 },
  // A plain row, tall enough for a thumb, with the radio or box beside the line's name, its first line.
  optionMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    minHeight: MinTouchSize + Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  mark: { marginTop: -1 },
  // Under the name, lined up with it: past the 26 mark and the 16 gap.
  quantity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingStart: 26 + Spacing.three, paddingBottom: Spacing.three },
  sectionGap: { marginTop: Spacing.two },
});
