import Ionicons from '@expo/vector-icons/Ionicons';
import {
  can,
  cyclePeriod,
  localize,
  SUBSCRIPTION_FIRST_VISIT_LEAD_DAYS,
  type OutletSubscriptionDto,
  type PlanOfferDto,
  type PlanPriceDto,
  type PlanServiceDto,
  type SubscriptionDto,
} from '@eccs/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DirectionView } from '@/components/direction-view';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { addDays, formatDate, formatDayShort, formatRupees, indiaToday } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOutlet } from '@/lib/use-outlet';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** What the person is being asked to confirm. Nothing is sent until they say yes. */
type Asking =
  | { kind: 'subscribe'; plan: PlanOfferDto }
  | { kind: 'change'; plan: PlanOfferDto }
  | { kind: 'cancel' };

/**
 * The outlet's plan: choosing one, and looking after the one it has.
 *
 * With no plan, the plans on offer are cards, each saying in plain words what
 * is included, what it costs with GST and how often it is invoiced, with one
 * button to subscribe. With a plan, the screen says what the outlet has, what
 * it pays, the cycle it is in, when the next invoice comes and where the plan
 * stands, and offers Change plan and Cancel plan.
 *
 * The Owner manages; the Manager can read everything and is told who can
 * change it. The Head Chef has no way here.
 *
 * Built to the common pattern for subscription screens (the App Store's and
 * Google Play's subscription pages, Stripe's customer portal, and the
 * guidance against dark patterns in cancelling): the present plan is marked,
 * a change takes effect at the next cycle and says the date, cancelling takes
 * the same number of taps as subscribing, the confirmation says exactly what
 * happens and when, and until that day one tap undoes it.
 */
export default function PlanScreen() {
  const theme = useTheme();
  const { t, api, language, user } = useSession();
  const notify = useSnackbar();
  const { outletId, outlets, loading: outletLoading, choose } = useOutlet();

  const [data, setData] = useState<OutletSubscriptionDto | null>(null);
  const [plans, setPlans] = useState<PlanOfferDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True while the other plans are listed under the present one.
  const [choosing, setChoosing] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  /** What went wrong with the last change, shown beside the buttons. */
  const [actionError, setActionError] = useState<string | null>(null);

  const memberships = user?.memberships ?? [];
  const mayRead = can(memberships, 'subscriptions', 'read');
  // Only the Owner (and ECCS, in the console) may start, change or cancel.
  const mayManage = can(memberships, 'subscriptions', 'create');

  const load = useCallback(async () => {
    if (!outletId || !mayRead) return;
    try {
      const [found, offered] = await Promise.all([api.subscriptions.forOutlet(outletId), api.subscriptionPlans.offered()]);
      setData(found);
      setPlans(offered);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, outletId, mayRead]);

  // Reloads on coming back, so a change ECCS made meanwhile shows.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const subscription = data?.subscription ?? null;
  const day = (date: string) => formatDate(date, language);
  const money = (paise: number) => formatRupees(paise, language);
  const perCycle = (price: PlanPriceDto) => t(`plan.price.${price.billingCycle}`, { price: money(price.totalPaise) });
  const lineText = (service: PlanServiceDto) =>
    service.intervalDays === 1
      ? t('plan.lineDaily', { service: localize(service.serviceName, language) })
      : t('plan.lineEvery', { service: localize(service.serviceName, language), count: service.intervalDays });

  /** Sends one change, puts the answer on the screen and says briefly that it worked. */
  async function act(action: () => Promise<OutletSubscriptionDto>, done: (next: OutletSubscriptionDto) => string) {
    setAsking(null);
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      setData(next);
      setChoosing(false);
      notify(done(next));
    } catch (e) {
      setActionError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  function confirmed() {
    if (!asking || !outletId) return;
    if (asking.kind === 'subscribe') {
      const name = localize(asking.plan.name, language);
      void act(
        () => api.subscriptions.start(outletId, { planCode: asking.plan.code }),
        () => t('plan.subscribed', { plan: name }),
      );
    } else if (asking.kind === 'change') {
      const name = localize(asking.plan.name, language);
      void act(
        () => api.subscriptions.changePlan(outletId, asking.plan.code),
        (next) => t('plan.changeSaved', { plan: name, date: day(next.subscription?.renewal?.date ?? indiaToday()) }),
      );
    } else {
      void act(
        () => api.subscriptions.cancel(outletId, 'PERIOD_END'),
        (next) =>
          next.subscription?.endsOn ? t('plan.cancelSaved', { date: day(next.subscription.endsOn) }) : t('plan.cancelledNow'),
      );
    }
  }

  // ───────────────────────── Pieces ─────────────────────────

  /** The price as the restaurant pays it, large, with the before-GST amount and the GST under it. */
  const priceBlock = (price: PlanPriceDto) => (
    <View style={styles.priceBlock}>
      <ThemedText type="default" style={styles.price}>
        {perCycle(price)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('plan.priceSplit', { price: money(price.pricePaise), gst: money(price.gstPaise), rate: price.gstRatePercent })}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t(`plan.billed.${price.billingCycle}`)}
      </ThemedText>
    </View>
  );

  /** "Pest control every 15 days", one line each with a tick, and under it whatever `extra` gives for that service. */
  const included = (services: PlanServiceDto[], extra?: (service: PlanServiceDto) => string) => (
    <View style={styles.lines}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('plan.includes')}
      </ThemedText>
      {services.map((service) => (
        <View key={service.serviceCode} style={styles.line}>
          <Ionicons name="checkmark" size={20} color={theme.primary} style={styles.lineIcon} />
          <View style={styles.lineText}>
            <ThemedText type="default">{lineText(service)}</ThemedText>
            {extra && (
              <ThemedText type="small" themeColor="textSecondary">
                {extra(service)}
              </ThemedText>
            )}
          </View>
        </View>
      ))}
    </View>
  );

  /** A plan on offer. `action` is the one button under it, if the person may press one. */
  const offerCard = (plan: PlanOfferDto, action: ReactNode) => (
    <View key={plan.code} style={[styles.card, { borderColor: theme.outline }]}>
      <ThemedText type="default" style={styles.cardTitle}>
        {localize(plan.name, language)}
      </ThemedText>
      {plan.description && (
        <ThemedText type="default" themeColor="textSecondary">
          {localize(plan.description, language)}
        </ThemedText>
      )}
      {priceBlock(plan)}
      {included(plan.services)}
      {action}
    </View>
  );

  /** One fact about the subscription: what it is, then what it says. */
  const fact = (label: string, value: string) => (
    <View style={[styles.fact, { borderColor: theme.border }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="default">{value}</ThemedText>
    </View>
  );

  /** Where the plan stands: an icon, the words, and a sentence saying what that means. Never colour alone. */
  function standing(current: SubscriptionDto): { icon: IconName; color: string; text: string; help: string | null } {
    const planName = localize(current.plan.name, language);
    if (current.status === 'PAUSED') {
      return { icon: 'pause-circle', color: theme.warning, text: t('plan.state.PAUSED'), help: t('plan.pausedHelp') };
    }
    if (current.endsOn) {
      const date = day(current.endsOn);
      return { icon: 'time', color: theme.warning, text: t('plan.state.ENDING', { date }), help: t('plan.endingHelp', { date }) };
    }
    if (current.pendingPlan && current.renewal) {
      const date = day(current.renewal.date);
      const next = localize(current.pendingPlan.name, language);
      return {
        icon: 'swap-horizontal',
        color: theme.primary,
        text: t('plan.state.CHANGING', { plan: next, date }),
        help: t('plan.changingHelp', { current: planName, next, date, price: perCycle(current.renewal) }),
      };
    }
    // ECCS edited the plan since this cycle began: say what the next invoice will be for.
    const edited =
      current.renewal?.changes === true
        ? t('plan.edited', { date: day(current.renewal.date), price: perCycle(current.renewal) })
        : null;
    if (current.currentPeriodStart > indiaToday()) {
      return { icon: 'calendar', color: theme.primary, text: t('plan.state.STARTS', { date: day(current.currentPeriodStart) }), help: edited };
    }
    return { icon: 'checkmark-circle', color: theme.primary, text: t('plan.state.ACTIVE'), help: edited };
  }

  const subscriptionCard = (current: SubscriptionDto) => {
    const planName = localize(current.plan.name, language);
    const state = standing(current);
    const nextInvoice = current.renewal
      ? t('plan.nextInvoiceOn', { date: day(current.renewal.date), price: money(current.renewal.totalPaise) })
      : current.endsOn
        ? t('plan.nextInvoiceEnding', { date: day(current.endsOn) })
        : t('plan.nextInvoicePaused');
    const others = (plans ?? []).filter((plan) => plan.code !== current.plan.code);
    // A plan that is ending, or already changing, is first kept or undone; then it can be changed.
    const settled = !current.endsOn && !current.pendingPlan;

    return (
      <>
        <View style={[styles.card, styles.currentCard, { borderColor: theme.primary }]}>
          <View style={styles.tagRow}>
            <ThemedText type="smallBold" themeColor="primary">
              {t('plan.currentTag')}
            </ThemedText>
          </View>
          <ThemedText type="default" style={styles.cardTitle}>
            {planName}
          </ThemedText>
          <View style={styles.state}>
            <Ionicons name={state.icon} size={24} color={state.color} />
            <ThemedText type="default" style={[styles.stateText, { color: state.color }]}>
              {state.text}
            </ThemedText>
          </View>
          {state.help && <ThemedText type="default">{state.help}</ThemedText>}

          {priceBlock(current)}
          {included(current.services, (service) => {
            const next = current.services.find((entry) => entry.serviceCode === service.serviceCode)?.nextDate;
            return next ? t('plan.nextVisit', { date: formatDayShort(next, language) }) : t('plan.noVisit');
          })}
          {fact(t('plan.cycle'), t('plan.cycleDates', { from: day(current.currentPeriodStart), until: day(current.currentPeriodEnd) }))}
          {fact(t('plan.nextInvoice'), nextInvoice)}
        </View>

        {/* Each button on its own row: two side by side do not fit a narrow phone. */}
        {mayManage ? (
          <View style={styles.actions}>
            {current.endsOn && (
              <Button
                icon="refresh"
                label={t('plan.keep')}
                loading={busy}
                onPress={() => void act(() => api.subscriptions.keep(outletId!), () => t('plan.kept'))}
              />
            )}
            {current.pendingPlan && (
              <Button
                icon="arrow-undo"
                label={t('plan.undoChange', { plan: planName })}
                variant="secondary"
                loading={busy}
                onPress={() =>
                  void act(() => api.subscriptions.undoChangePlan(outletId!), () => t('plan.changeUndone', { plan: planName }))
                }
              />
            )}
            {settled && !choosing && (
              <Button icon="swap-horizontal" label={t('plan.change')} variant="secondary" disabled={busy} onPress={() => setChoosing(true)} />
            )}
            {!current.endsOn && (
              <Button label={t('plan.cancel')} variant="danger" disabled={busy} onPress={() => setAsking({ kind: 'cancel' })} />
            )}
            <ErrorText message={actionError} />
          </View>
        ) : (
          <ThemedText type="default" themeColor="textSecondary">
            {t('plan.ownerOnly')}
          </ThemedText>
        )}

        {mayManage && settled && choosing && (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionGap}>
              {t('plan.changeTitle')}
            </ThemedText>
            <ThemedText type="default">
              {t('plan.changeHelp', { date: day(current.renewal?.date ?? addDays(current.currentPeriodEnd, 1)) })}
            </ThemedText>
            {others.length === 0 && (
              <ThemedText type="default" themeColor="textSecondary">
                {t('plan.noOther')}
              </ThemedText>
            )}
            {others.map((plan) =>
              offerCard(
                plan,
                <Button
                  label={t('plan.changeTo', { plan: localize(plan.name, language) })}
                  disabled={busy}
                  onPress={() => setAsking({ kind: 'change', plan })}
                />,
              ),
            )}
            <Button label={t('plan.closeChange')} variant="link" onPress={() => setChoosing(false)} />
          </>
        )}
      </>
    );
  };

  // ───────────────────────── The question before a change ─────────────────────────

  function question(): { message: string; yes: string; no: string; danger: boolean } | null {
    if (!asking) return null;
    const today = indiaToday();
    if (asking.kind === 'subscribe') {
      const period = cyclePeriod(today, asking.plan.billingCycle);
      return {
        message: t('plan.subscribeConfirm', {
          plan: localize(asking.plan.name, language),
          price: perCycle(asking.plan),
          from: day(period.start),
          until: day(period.end),
          date: day(addDays(today, SUBSCRIPTION_FIRST_VISIT_LEAD_DAYS)),
        }),
        yes: t('plan.subscribeYes'),
        no: t('plan.notNow'),
        danger: false,
      };
    }
    if (!subscription) return null;
    const current = localize(subscription.plan.name, language);
    if (asking.kind === 'change') {
      return {
        message: t('plan.changeConfirm', {
          plan: localize(asking.plan.name, language),
          current,
          date: day(subscription.renewal?.date ?? addDays(subscription.currentPeriodEnd, 1)),
          price: perCycle(asking.plan),
        }),
        yes: t('plan.changeYes'),
        no: t('plan.changeNo', { plan: current }),
        danger: false,
      };
    }
    // Before its first cycle has begun, or paused past the end of its cycle, there is nothing left to run: it ends at once.
    const endsNow = subscription.currentPeriodStart > today || subscription.currentPeriodEnd < today;
    return {
      message: endsNow
        ? t('plan.cancelConfirmNow', { plan: current })
        : t('plan.cancelConfirm', { plan: current, date: day(subscription.currentPeriodEnd) }),
      yes: t('plan.cancelYes'),
      // Never a bare "Cancel" here, which would read as "cancel the plan".
      no: t('plan.keep'),
      danger: true,
    };
  }
  const asked = question();

  // ───────────────────────── The screen ─────────────────────────

  if (!mayRead) {
    return (
      <Screen back title={t('plan.title')}>
        <ThemedText type="default" themeColor="textSecondary">
          {t('plan.notForYou')}
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen back title={t('plan.title')} subtitle={t('plan.help')} onRefresh={load}>
      {outlets.length > 1 && (
        <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={t('checklists.chooseOutlet')}>
          {outlets.map((outlet) => (
            <OptionChip
              key={outlet.id}
              label={outlet.name}
              selected={outlet.id === outletId}
              onPress={() => {
                if (outlet.id === outletId) return;
                setData(null);
                setError(null);
                setActionError(null);
                setChoosing(false);
                choose(outlet.id);
              }}
            />
          ))}
        </View>
      )}

      <ErrorText message={error} onRetry={() => void load()} />
      {(outletLoading || (data === null && !error && outletId)) && <ActivityIndicator color={theme.primary} />}

      {data && subscription && subscriptionCard(subscription)}

      {data && !subscription && (
        <>
          {data.lastEnded && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('plan.lastEnded', { plan: localize(data.lastEnded.plan.name, language), date: day(data.lastEnded.endedOn) })}
            </ThemedText>
          )}
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('plan.choose')}
          </ThemedText>
          <ThemedText type="default">{t('plan.chooseHelp')}</ThemedText>
          {!mayManage && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('plan.ownerOnly')}
            </ThemedText>
          )}
          {plans?.length === 0 && (
            <ThemedText type="default" themeColor="textSecondary">
              {t('plan.noneOffered')}
            </ThemedText>
          )}
          <ErrorText message={actionError} />
          {busy && <ActivityIndicator color={theme.primary} />}
          {(plans ?? []).map((plan) =>
            offerCard(
              plan,
              mayManage ? (
                <Button
                  label={t('plan.subscribeTo', { plan: localize(plan.name, language) })}
                  disabled={busy}
                  onPress={() => setAsking({ kind: 'subscribe', plan })}
                />
              ) : null,
            ),
          )}
        </>
      )}

      {asked && (
        <Question
          message={asked.message}
          yes={asked.yes}
          no={asked.no}
          danger={asked.danger}
          onYes={confirmed}
          onNo={() => setAsking(null)}
        />
      )}
    </Screen>
  );
}

/**
 * The question asked before subscribing, changing or cancelling. The app's
 * ordinary yes/no box always calls its second button "Cancel", which next to
 * "Cancel the plan" could be read either way; here both buttons say what they
 * do. The text can be long, so it scrolls on a small phone.
 */
function Question({
  message,
  yes,
  no,
  danger,
  onYes,
  onNo,
}: {
  message: string;
  yes: string;
  no: string;
  danger: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onNo}>
      <DirectionView
        style={[styles.backdrop, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={[styles.dialog, { backgroundColor: theme.background }]} accessibilityViewIsModal>
          <ScrollView style={styles.dialogScroll} contentContainerStyle={styles.dialogText}>
            <ThemedText type="default">{message}</ThemedText>
          </ScrollView>
          <Button label={yes} variant={danger ? 'danger' : 'primary'} onPress={onYes} />
          <Button label={no} variant="secondary" onPress={onNo} />
        </View>
      </DirectionView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  sectionGap: { marginTop: Spacing.four },
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  currentCard: { borderWidth: 2 },
  cardTitle: { fontWeight: 700, fontSize: 20, lineHeight: 28 },
  tagRow: { flexDirection: 'row' },
  state: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stateText: { flex: 1, fontWeight: 700 },
  priceBlock: { gap: Spacing.half },
  price: { fontWeight: 700, fontSize: 22, lineHeight: 30 },
  lines: { gap: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  lineIcon: { marginTop: Spacing.half },
  lineText: { flex: 1, gap: Spacing.half },
  fact: { borderTopWidth: 1, paddingTop: Spacing.two, gap: Spacing.half },
  actions: { gap: Spacing.two },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  dialog: { width: '100%', maxWidth: MaxContentWidth - 64, maxHeight: '100%', borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.three },
  dialogScroll: { flexShrink: 1 },
  dialogText: { flexGrow: 1 },
});
