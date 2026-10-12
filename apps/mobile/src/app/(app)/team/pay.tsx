import Ionicons from '@expo/vector-icons/Ionicons';
import {
  can,
  shiftMonth,
  type SalaryMonthDto,
  type SaveSalaryInput,
  type StaffPayEntryDto,
  type StaffPayEntryKind,
} from '@eccs/shared';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';

import { countsOf, DAY_MARK, DAY_MARK_ORDER, DayCounts, MonthStepper, parseRupees, SALARY_STATE, typedRupees, useLoaded } from '@/components/team-parts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { OptionChip } from '@/components/ui/option-chip';
import { Screen } from '@/components/ui/screen';
import { useSnackbar } from '@/components/ui/snackbar';
import { TextField } from '@/components/ui/text-field';
import { MinTouchSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/billing';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatMonth, indiaToday, maskTypedDate, parseTypedDate, toTypedDate } from '@/lib/format';
import { useSession } from '@/lib/session';

const MONTHS_BACK = 12;

/**
 * One person's pay for one month. The app works the month's pay out from the
 * attendance and says how; the Owner or Manager can put their own figure in
 * its place, add overtime, a bonus and deductions, and record each advance and
 * payment with its date. What is still owed, or overpaid, is carried into the
 * next month. The summary can be shared as text (for WhatsApp).
 */
export default function PersonPayScreen() {
  const theme = useTheme();
  const { t, api, user } = useSession();
  const params = useLocalSearchParams<{ staffId: string; month?: string }>();
  const [month, setMonth] = useState(() => params.month ?? indiaToday().slice(0, 7));

  const memberships = user?.memberships ?? [];
  const allowed = can(memberships, 'salary', 'read');
  const { data, error, reload, set } = useLoaded<SalaryMonthDto>(allowed ? `${params.staffId}|${month}` : null, () =>
    api.team.personSalary(params.staffId, month),
  );

  if (!allowed) return <Redirect href="/" />;
  const thisMonth = indiaToday().slice(0, 7);

  if (!data) {
    return (
      <Screen back title={t('team.pay.title')}>
        <MonthStepper month={month} thisMonth={thisMonth} earliest={shiftMonth(thisMonth, -MONTHS_BACK)} onChange={setMonth} />
        <ErrorText message={error} onRetry={() => void reload()} />
        {!error && <ActivityIndicator color={theme.primary} />}
      </Screen>
    );
  }
  return (
    <PayForm
      // A fresh form for each person and month, so figures typed for one never show under another.
      key={`${data.staffId}|${data.month}`}
      data={data}
      thisMonth={thisMonth}
      onMonth={setMonth}
      onChanged={set}
      onRefresh={reload}
    />
  );
}

interface PayFormProps {
  data: SalaryMonthDto;
  thisMonth: string;
  onMonth: (month: string) => void;
  onChanged: (data: SalaryMonthDto) => void;
  onRefresh: () => Promise<void>;
}

function PayForm({ data, thisMonth, onMonth, onChanged, onRefresh }: PayFormProps) {
  const theme = useTheme();
  const { t, api, language } = useSession();
  const notify = useSnackbar();
  const money = (paise: number) => formatMoney(Math.abs(paise), language);

  const [ownDue, setOwnDue] = useState(data.dueOverridePaise !== null);
  const [dueText, setDueText] = useState(typedRupees(data.dueOverridePaise ?? 0));
  const [hoursText, setHoursText] = useState(data.overtimeHours ? String(data.overtimeHours) : '');
  const [overtimeText, setOvertimeText] = useState(typedRupees(data.overtimePaise));
  const [bonusText, setBonusText] = useState(typedRupees(data.bonusPaise));
  const [deductionsText, setDeductionsText] = useState(typedRupees(data.deductionsPaise));
  const [ownCarried, setOwnCarried] = useState(data.carriedOverridePaise !== null);
  const [carriedText, setCarriedText] = useState(typedRupees(Math.abs(data.carriedOverridePaise ?? 0)));
  const [carriedOverpaid, setCarriedOverpaid] = useState((data.carriedOverridePaise ?? 0) < 0);
  const [note, setNote] = useState(data.note ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<StaffPayEntryKind | null>(null);
  const [removing, setRemoving] = useState<StaffPayEntryDto | null>(null);

  /** What is typed, as the server takes it; null if a box does not hold an amount. */
  function readForm(): SaveSalaryInput | null {
    // A box that is switched off is not read, whatever was left in it.
    const due = ownDue ? parseRupees(dueText) : 0;
    const overtime = parseRupees(overtimeText);
    const bonus = parseRupees(bonusText);
    const deductions = parseRupees(deductionsText);
    const carried = ownCarried ? parseRupees(carriedText) : 0;
    const hours = hoursText.trim() === '' ? 0 : Number(hoursText.replace(',', '.'));
    if (due === null || overtime === null || bonus === null || deductions === null || carried === null) return null;
    if (!Number.isFinite(hours) || hours < 0 || hours > 744) return null;
    return {
      overtimeHours: hours,
      overtimePaise: overtime,
      bonusPaise: bonus,
      deductionsPaise: deductions,
      dueOverridePaise: ownDue ? due : null,
      carriedOverridePaise: ownCarried ? (carriedOverpaid ? -carried : carried) : null,
      note: note.trim() || null,
    };
  }

  const typed = readForm();
  const dirty =
    typed === null ||
    typed.overtimeHours !== data.overtimeHours ||
    typed.overtimePaise !== data.overtimePaise ||
    typed.bonusPaise !== data.bonusPaise ||
    typed.deductionsPaise !== data.deductionsPaise ||
    typed.dueOverridePaise !== data.dueOverridePaise ||
    typed.carriedOverridePaise !== data.carriedOverridePaise ||
    (typed.note ?? null) !== data.note;

  // The summary follows what is typed, before it is saved, by the same sums the server does.
  const duePaise = typed ? (typed.dueOverridePaise ?? data.computedDuePaise) : data.duePaise;
  const overtimePaise = typed?.overtimePaise ?? data.overtimePaise;
  const bonusPaise = typed?.bonusPaise ?? data.bonusPaise;
  const deductionsPaise = typed?.deductionsPaise ?? data.deductionsPaise;
  const carriedPaise = typed ? (typed.carriedOverridePaise ?? data.carriedComputedPaise) : data.carriedPaise;
  const netPaise = duePaise + overtimePaise + bonusPaise - data.advancesPaise - deductionsPaise;
  const payablePaise = netPaise + carriedPaise;
  const balancePaise = payablePaise - data.paidPaise;
  const state = SALARY_STATE[balancePaise < 0 ? 'OVERPAID' : balancePaise === 0 ? 'SETTLED' : data.paidPaise > 0 ? 'PART_PAID' : 'DUE'];

  async function save(): Promise<SalaryMonthDto | null> {
    const input = readForm();
    if (!input) {
      setFormError(t('team.pay.badAmount'));
      return null;
    }
    setBusy(true);
    setFormError(null);
    try {
      const saved = await api.team.saveSalary(data.staffId, data.month, input);
      onChanged(saved);
      notify(t('common.saved'));
      return saved;
    } catch (e) {
      setFormError(errorMessage(e, t));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry() {
    if (!removing) return;
    const entry = removing;
    setRemoving(null);
    setFormError(null);
    try {
      onChanged(await api.team.removePayEntry(entry.id));
    } catch (e) {
      setFormError(errorMessage(e, t));
    }
  }

  /** The month in plain lines of text, for the phone's share sheet. Anything typed is saved first. */
  async function share() {
    const record = dirty ? await save() : data;
    if (!record) return;
    const counts = countsOf(record.totals);
    const entryLines = (kind: StaffPayEntryKind) =>
      record.entries
        .filter((entry) => entry.kind === kind)
        .map((entry) => `   ${formatDate(entry.date, language)}: ${money(entry.amountPaise)}${entry.note ? ` (${entry.note})` : ''}`);
    const lines = [
      `${record.organizationName} · ${record.outletName}`,
      t('team.share.heading', { name: record.name, month: formatMonth(record.month, language) }),
      t('team.share.notPayslip'),
      '',
      `${t('team.att.title')}: ${DAY_MARK_ORDER.filter((mark) => counts[mark] > 0)
        .map((mark) => `${t(DAY_MARK[mark].label)} ${counts[mark]}`)
        .join(', ')}`,
      `${t('team.pay.forMonth')}: ${money(record.duePaise)}`,
      ...(record.overtimePaise ? [`${t('team.pay.overtime')}: + ${money(record.overtimePaise)}`] : []),
      ...(record.bonusPaise ? [`${t('team.pay.bonus')}: + ${money(record.bonusPaise)}`] : []),
      ...(record.advancesPaise ? [`${t('team.pay.advances')}: − ${money(record.advancesPaise)}`, ...entryLines('ADVANCE')] : []),
      ...(record.deductionsPaise ? [`${t('team.pay.deductions')}: − ${money(record.deductionsPaise)}`] : []),
      ...(record.carriedPaise
        ? [`${t(record.carriedPaise < 0 ? 'team.pay.carriedOverpaid' : 'team.pay.carriedOwed')}: ${money(record.carriedPaise)}`]
        : []),
      `${t('team.pay.toPay')}: ${money(Math.max(record.payablePaise, 0))}`,
      `${t('team.pay.paid')}: ${money(record.paidPaise)}`,
      ...entryLines('PAYMENT'),
      `${t(record.balancePaise < 0 ? 'team.pay.overpaid' : 'team.pay.stillOwed')}: ${money(record.balancePaise)}`,
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // For example the browser preview, which has no share sheet.
      setFormError(t('newPin.shareFailed'));
    }
  }

  const line = (label: string, paise: number, options: { sign?: '+' | '−'; strong?: boolean } = {}) => (
    <View style={styles.line}>
      <ThemedText type="default" style={[styles.lineLabel, options.strong && styles.bold]}>
        {label}
      </ThemedText>
      <ThemedText type="default" style={options.strong && styles.bold}>
        {options.sign ? `${options.sign} ` : ''}
        {money(paise)}
      </ThemedText>
    </View>
  );

  const entryList = (kind: StaffPayEntryKind) =>
    data.entries
      .filter((entry) => entry.kind === kind)
      .map((entry) => (
        <View key={entry.id} style={[styles.entry, { borderColor: theme.border }]}>
          <View style={styles.entryText}>
            <ThemedText type="default" style={styles.bold}>
              {money(entry.amountPaise)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[formatDate(entry.date, language), entry.note].filter(Boolean).join(' · ')}
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('team.pay.removeEntry')}
            onPress={() => setRemoving(entry)}
            style={styles.entryRemove}>
            <Ionicons name="trash-outline" size={22} color={theme.danger} />
          </Pressable>
        </View>
      ));

  const amount = formatMoney(data.ratePaise, language);
  // For the "how this is worked out" lines of someone paid by the month.
  const divisor = data.divisor ?? data.totals.daysInMonth;
  // Part of the month only: joined or left part-way, or the month is still running.
  const partMonth = data.totals.countedDays > 0 && data.totals.countedDays < data.totals.daysInMonth;
  // The share of the salary for the days counted, before anything is taken off for absences.
  const sharePaise = Math.round((data.ratePaise * data.totals.countedDays) / data.totals.daysInMonth);
  return (
    <Screen
      back
      title={data.name}
      subtitle={t('team.pay.notPayroll')}
      onRefresh={onRefresh}
      footer={
        <>
          <ErrorText message={formError} />
          {dirty && <Button label={t('team.save')} loading={busy} onPress={() => void save()} />}
          <Button variant={dirty ? 'secondary' : 'primary'} icon="share-social-outline" label={t('team.pay.share')} disabled={busy} onPress={() => void share()} />
        </>
      }>
      <MonthStepper month={data.month} thisMonth={thisMonth} earliest={shiftMonth(thisMonth, -MONTHS_BACK)} onChange={onMonth} />

      {data.beforeRecords && (
        <ThemedText type="default" themeColor="textSecondary">
          {t('team.pay.beforeRecords')}
        </ThemedText>
      )}

      {/* ── What the month's pay comes to, and how ── */}
      <View style={[styles.card, { borderColor: theme.border }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('team.att.title')}
          {data.totals.upTo && data.month === thisMonth ? ` · ${t('team.pay.upTo', { date: formatDate(data.totals.upTo, language) })}` : ''}
        </ThemedText>
        <DayCounts counts={countsOf(data.totals)} />
        {/* The first month: pay starts on the day the person joined, and the screen says so plainly. */}
        {data.countedFrom.slice(0, 7) === data.month && (
          <ThemedText type="small" style={styles.bold}>
            {t(data.joinedOn ? 'team.pay.startJoined' : 'team.pay.startAdded', {
              date: formatDate(data.countedFrom, language),
              month: formatMonth(data.month, language),
            })}
          </ThemedText>
        )}
        {data.payType === 'DAILY' ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('team.pay.ruleDaily', { amount })}
          </ThemedText>
        ) : (
          // How the month's pay is worked out, step by step in rupees, with the day rate.
          <View style={styles.how}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('team.pay.how')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(divisor === data.totals.daysInMonth ? 'team.pay.howRateMonth' : 'team.pay.howRateFixed', {
                amount,
                days: divisor,
                rate: formatMoney(data.dayRatePaise, language),
              })}
            </ThemedText>
            {data.divisorKept && (
              <ThemedText type="small" themeColor="textSecondary">
                {t('team.pay.howKept', { days: divisor })}
              </ThemedText>
            )}
            {partMonth && (
              <ThemedText type="small" themeColor="textSecondary">
                {t('team.pay.howShare', {
                  counted: data.totals.countedDays,
                  monthDays: data.totals.daysInMonth,
                  amount,
                  share: formatMoney(sharePaise, language),
                })}
              </ThemedText>
            )}
            {data.lostDays > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {t('team.pay.howLost', {
                  days: data.lostDays,
                  rate: formatMoney(data.dayRatePaise, language),
                  amount: formatMoney(Math.max(sharePaise - data.computedDuePaise, 0), language),
                })}
              </ThemedText>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {t('team.pay.ruleMonthly')}
            </ThemedText>
          </View>
        )}
        {line(t('team.pay.worked', { days: data.paidDays }), data.computedDuePaise, { strong: !ownDue })}
        {ownDue ? (
          <>
            <TextField
              label={t('team.pay.ownFigure')}
              value={dueText}
              onChangeText={setDueText}
              keyboardType="decimal-pad"
              hint={t('team.pay.ownFigureHint')}
            />
            <Button variant="link" label={t('team.pay.useApps')} onPress={() => setOwnDue(false)} />
          </>
        ) : (
          <Button variant="link" label={t('team.pay.useOwn')} onPress={() => setOwnDue(true)} />
        )}
      </View>

      {/* ── Typed by hand ── */}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label={t('team.pay.overtimeHours')} value={hoursText} onChangeText={setHoursText} keyboardType="decimal-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label={t('team.pay.overtimeAmount')} value={overtimeText} onChangeText={setOvertimeText} keyboardType="decimal-pad" />
        </View>
      </View>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label={t('team.pay.bonus')} value={bonusText} onChangeText={setBonusText} keyboardType="decimal-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label={t('team.pay.deductions')} value={deductionsText} onChangeText={setDeductionsText} keyboardType="decimal-pad" />
        </View>
      </View>

      {/* ── Advances ── */}
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('team.pay.advances')}
      </ThemedText>
      {entryList('ADVANCE')}
      {adding === 'ADVANCE' ? (
        <EntryForm kind="ADVANCE" data={data} suggested={0} onDone={() => setAdding(null)} onChanged={onChanged} />
      ) : (
        <Button variant="secondary" icon="add" label={t('team.pay.addAdvance')} onPress={() => setAdding('ADVANCE')} />
      )}

      {/* ── What came from the months before ── */}
      <View style={[styles.card, { borderColor: theme.border }]}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('team.pay.carried')}
        </ThemedText>
        {line(
          t(
            data.carriedComputedPaise < 0
              ? 'team.pay.carriedOverpaid'
              : data.carriedComputedPaise > 0
                ? 'team.pay.carriedOwed'
                : 'team.pay.carriedNothing',
          ),
          data.carriedComputedPaise,
          { strong: !ownCarried },
        )}
        {ownCarried ? (
          <>
            <View style={styles.options} accessibilityRole="radiogroup">
              <OptionChip label={t('team.pay.carriedOwed')} selected={!carriedOverpaid} onPress={() => setCarriedOverpaid(false)} />
              <OptionChip label={t('team.pay.carriedOverpaid')} selected={carriedOverpaid} onPress={() => setCarriedOverpaid(true)} />
            </View>
            <TextField
              label={t('team.pay.ownFigure')}
              value={carriedText}
              onChangeText={setCarriedText}
              keyboardType="decimal-pad"
              hint={t('team.pay.ownFigureHint')}
            />
            <Button variant="link" label={t('team.pay.useApps')} onPress={() => setOwnCarried(false)} />
          </>
        ) : (
          <Button variant="link" label={t('team.pay.useOwn')} onPress={() => setOwnCarried(true)} />
        )}
      </View>

      {/* ── The month added up ── */}
      <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
        {line(ownDue ? t('team.pay.forMonthOwn') : t('team.pay.forMonth'), duePaise)}
        {overtimePaise > 0 && line(t('team.pay.overtime'), overtimePaise, { sign: '+' })}
        {bonusPaise > 0 && line(t('team.pay.bonus'), bonusPaise, { sign: '+' })}
        {data.advancesPaise > 0 && line(t('team.pay.advances'), data.advancesPaise, { sign: '−' })}
        {deductionsPaise > 0 && line(t('team.pay.deductions'), deductionsPaise, { sign: '−' })}
        {carriedPaise !== 0 &&
          line(t(carriedPaise < 0 ? 'team.pay.carriedOverpaid' : 'team.pay.carriedOwed'), carriedPaise, { sign: carriedPaise < 0 ? '−' : '+' })}
        <View style={[styles.rule, { backgroundColor: theme.outline }]} />
        {line(t('team.pay.toPay'), Math.max(payablePaise, 0), { strong: true })}
        {line(t('team.pay.paid'), data.paidPaise)}
        {line(t(balancePaise < 0 ? 'team.pay.overpaid' : 'team.pay.stillOwed'), balancePaise, { strong: true })}
        <View style={styles.state}>
          <Ionicons name={state.icon} size={20} color={theme[state.tone]} />
          <ThemedText type="smallBold" style={{ color: theme[state.tone] }}>
            {t(state.label)}
          </ThemedText>
        </View>
      </View>

      {/* ── Payments ── */}
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('team.pay.payments')}
      </ThemedText>
      {entryList('PAYMENT')}
      {adding === 'PAYMENT' ? (
        <EntryForm kind="PAYMENT" data={data} suggested={Math.max(balancePaise, 0)} onDone={() => setAdding(null)} onChanged={onChanged} />
      ) : (
        <Button variant="secondary" icon="cash-outline" label={t('team.pay.addPayment')} onPress={() => setAdding('PAYMENT')} />
      )}

      <TextField label={t('team.pay.note')} value={note} onChangeText={setNote} maxLength={300} multiline />

      <ConfirmDialog
        visible={removing !== null}
        message={removing ? t('team.pay.removeConfirm', { amount: money(removing.amountPaise) }) : ''}
        confirmLabel={t('team.pay.removeEntry')}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => void removeEntry()}
      />
    </Screen>
  );
}

interface EntryFormProps {
  kind: StaffPayEntryKind;
  data: SalaryMonthDto;
  /** The amount offered to start with, in paise: what is still owed, for a payment. */
  suggested: number;
  onDone: () => void;
  onChanged: (data: SalaryMonthDto) => void;
}

/** The few boxes for one advance or one payment: how much, on which day, and a note. */
function EntryForm({ kind, data, suggested, onDone, onChanged }: EntryFormProps) {
  const theme = useTheme();
  const { t, api } = useSession();
  const [amountText, setAmountText] = useState(typedRupees(suggested));
  const [dateText, setDateText] = useState(toTypedDate(indiaToday()));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; date?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    const amountPaise = parseRupees(amountText);
    const date = parseTypedDate(dateText);
    const found = {
      ...((amountPaise === null || amountPaise <= 0) && { amount: t('team.pay.badAmount') }),
      ...((!date || date > indiaToday()) && { date: t('team.pay.badDate') }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0 || !amountPaise || !date) return;
    setBusy(true);
    setFailure(null);
    try {
      onChanged(await api.team.addPayEntry(data.staffId, { kind, month: data.month, date, amountPaise, note: note.trim() || null }));
      onDone();
    } catch (e) {
      setFailure(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, { borderColor: theme.primary }]}>
      <TextField
        label={t('team.pay.amount')}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        autoFocus
        error={errors.amount}
      />
      <TextField
        label={t(kind === 'ADVANCE' ? 'team.pay.givenOn' : 'team.pay.paidOn')}
        value={dateText}
        onChangeText={(text) => setDateText(maskTypedDate(text, dateText))}
        keyboardType="number-pad"
        placeholder="DD/MM/YYYY"
        error={errors.date}
      />
      <TextField label={t('team.pay.entryNote')} value={note} onChangeText={setNote} maxLength={120} hint={t('team.person.optional')} />
      <ErrorText message={failure} />
      <Button label={t(kind === 'ADVANCE' ? 'team.pay.addAdvance' : 'team.pay.addPayment')} loading={busy} onPress={() => void add()} />
      <Button variant="secondary" label={t('common.cancel')} disabled={busy} onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  lineLabel: { flex: 1 },
  bold: { fontWeight: 700 },
  how: { gap: Spacing.one },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one },
  state: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  pair: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingStart: Spacing.three,
    minHeight: MinTouchSize,
  },
  entryText: { flex: 1, gap: Spacing.half, paddingVertical: Spacing.two },
  entryRemove: { minWidth: MinTouchSize, minHeight: MinTouchSize, alignItems: 'center', justifyContent: 'center' },
});
