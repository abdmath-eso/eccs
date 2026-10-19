"use client";

import {
  AI_HELPER_ORDER,
  AI_HELPERS,
  AI_MODEL_LABELS,
  AI_MODELS,
  AI_PRICES,
  AI_SETTINGS_SECTION_LABELS,
  aiSettingChangeLine,
  aiSettingsSchema,
  applyAiSettingsPatch,
  BUDDY_EFFORTS,
  LICENCE_SECOND_MODELS,
  type AiFeature,
  type AiModelKey,
  type AiSettings,
  type AiSettingsDto,
  type AiSettingsPatch,
  type AiSettingsSection,
} from "@eccs/shared";
import { ApiError } from "@eccs/api-client";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button, CONTROL_STYLE, ErrorMessage, Field, SelectField, Switch } from "@/components/ui";
import { describe, when } from "@/lib/format";

import { Panel } from "../finance/finance-parts";
import { inr } from "./ai-usage-parts";

// The AI usage page's Settings (19 Oct 2026): every AI setting in groups, each with one line
// saying what it does and who last changed it. Switches take effect the moment they are
// pressed (NN/g's guidance on toggle switches); amounts and choices are typed and saved with
// the group's Save button (the console's own form pieces), checked against the same rules
// the server checks (aiSettingsSchema), with a confirmation once saved. A helper's model is
// offered with its price per million tokens beside it. The Ops Manager sees it all read-only.

/** Saves a change; resolves to what went wrong (by setting) or null when it was saved. */
export type SaveChange = (change: AiSettingsPatch, done: string) => Promise<Record<string, string> | null>;

const price = (key: AiModelKey) => {
  const base = AI_PRICES[AI_MODELS[key]].base;
  return `US$${base.input.toFixed(2)}, US$${base.output.toFixed(2)}`;
};

/** A model with its price per million tokens (in, out) beside it: "Haiku 5.5 · US$0.10, US$0.50". */
function ModelChoice<K extends AiModelKey>({ label, value, choices, disabled, onChange }: { label: string; value: K; choices: readonly K[]; disabled: boolean; onChange: (key: K) => void }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as K)} className={`${CONTROL_STYLE} w-full min-w-0 disabled:opacity-60`}>
      {choices.map((key) => (
        <option key={key} value={key}>
          {AI_MODEL_LABELS[key]} · {price(key)}
        </option>
      ))}
    </select>
  );
}

/** The settings with a change laid over them, checked as the server checks them: what is wrong, by setting ("limits.dailyUsd"). */
function check(current: AiSettings, change: AiSettingsPatch): Record<string, string> {
  const result = aiSettingsSchema.safeParse(applyAiSettingsPatch(current, change as never));
  const errors: Record<string, string> = {};
  if (!result.success) for (const issue of result.error.issues) errors[issue.path.join(".")] ??= issue.message;
  return errors;
}

/** A typed amount: a number, null for an empty optional one, or undefined when it is not a number. */
function amount(text: string, optional = false): number | null | undefined {
  const cleaned = text.replace(/[₹$,\s]|US/g, "");
  if (cleaned === "") return optional ? null : undefined;
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : undefined;
}

export function SettingsForm({ dto, save }: { dto: AiSettingsDto; save: SaveChange }) {
  const { settings, server, canChange } = dto;
  return (
    <div className="flex flex-col gap-6">
      {!canChange && <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">Only the Super Admin can change these. You can see them all.</p>}
      {server.fromEnv && (
        <ErrorMessage message="This copy of the server takes its limits and Buddy settings from its own .env (AI_SETTINGS_FROM_ENV), so nothing can be saved here." />
      )}
      <AllSection dto={dto} save={save} />
      <HelpersSection key={`helpers-${JSON.stringify(settings.helpers)}-${JSON.stringify(settings.licenceReader)}`} dto={dto} save={save} />
      <div className="grid gap-6 lg:grid-cols-2">
        <LimitsSection key={`limits-${JSON.stringify(settings.limits)}`} dto={dto} save={save} />
        <WarningsSection key={`warnings-${JSON.stringify(settings.warnings)}`} dto={dto} save={save} />
        <BuddySection key={`buddy-${JSON.stringify(settings.buddy)}`} dto={dto} save={save} />
        <KeySection key={`key-${JSON.stringify(settings.key)}`} dto={dto} save={save} />
      </div>
      <History dto={dto} />
    </div>
  );
}

/** "Last changed by Abdul, 19 Oct, 2:30 pm", or that it is as it came. */
function LastChanged({ dto, section }: { dto: AiSettingsDto; section: AiSettingsSection }) {
  const last = dto.sections[section];
  return <p className="text-xs text-muted">{last ? `Last changed by ${last.by}, ${when(last.at)}` : "Not changed yet: the server's defaults."}</p>;
}

/** A group's frame: its title, its one line, its fields, who last changed it and its Save button. */
function Group({
  title,
  line,
  section,
  dto,
  children,
  onSubmit,
  dirty,
  busy,
  error,
}: {
  title: string;
  line: ReactNode;
  section: AiSettingsSection;
  dto: AiSettingsDto;
  children: ReactNode;
  onSubmit?: () => void;
  dirty?: boolean;
  busy?: boolean;
  error?: string | null;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };
  return (
    <Panel title={title} description={line}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {children}
        <ErrorMessage message={error ?? null} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <LastChanged dto={dto} section={section} />
          {onSubmit && dto.canChange && !dto.server.fromEnv && (
            <Button type="submit" size="sm" disabled={!dirty} loading={busy}>
              Save
            </Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

/** Switches save the moment they change; this keeps the one being saved waiting. */
function useSwitchSave(save: SaveChange) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flip = async (key: string, change: AiSettingsPatch, done: string) => {
    setBusy(key);
    setError(null);
    const problems = await save(change, done);
    if (problems) setError(Object.values(problems)[0] ?? "Could not save that.");
    setBusy(null);
  };
  return { busy, error, flip };
}

// ───────────────────────── All helpers ─────────────────────────

function AllSection({ dto, save }: { dto: AiSettingsDto; save: SaveChange }) {
  const { busy, error, flip } = useSwitchSave(save);
  const { settings, server, canChange } = dto;
  const locked = !canChange || server.fromEnv;
  return (
    <Group title="All helpers" line="The console's main switch. Off, no helper calls the AI and the apps work as they did before AI." section="all" dto={dto} error={error}>
      <Switch
        label="All AI helpers"
        checked={settings.allOn}
        disabled={locked || busy !== null}
        onChange={(on) => void flip("all", { allOn: on }, on ? "All AI helpers switched on" : "All AI helpers switched off")}
      />
      {!server.aiOn && <p className="text-sm font-semibold text-danger">AI is off on the server (AI_FEATURES=off in its .env), above this switch: it cannot be switched on from here.</p>}
      {server.aiOn && !server.keySet && <p className="text-sm font-semibold text-danger">The server has no Anthropic API key, so no helper can run.</p>}
    </Group>
  );
}

// ───────────────────────── Each helper ─────────────────────────

function HelpersSection({ dto, save }: { dto: AiSettingsDto; save: SaveChange }) {
  const { settings, server, canChange } = dto;
  const locked = !canChange || server.fromEnv;
  const switches = useSwitchSave(save);
  const [models, setModels] = useState<Record<AiFeature, AiModelKey>>(() => Object.fromEntries(AI_HELPER_ORDER.map((feature) => [feature, settings.helpers[feature].model])) as Record<AiFeature, AiModelKey>);
  const [secondTry, setSecondTry] = useState(settings.licenceReader.secondTry);
  const [secondModel, setSecondModel] = useState<(typeof LICENCE_SECOND_MODELS)[number]>(settings.licenceReader.secondModel);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const changedModels = AI_HELPER_ORDER.filter((feature) => models[feature] !== settings.helpers[feature].model);
  const change: AiSettingsPatch = {
    ...(changedModels.length > 0 && { helpers: Object.fromEntries(changedModels.map((feature) => [feature, { model: models[feature] }])) }),
    ...((secondTry !== settings.licenceReader.secondTry || secondModel !== settings.licenceReader.secondModel) && { licenceReader: { secondTry, secondModel } }),
  };
  const dirty = Object.keys(change).length > 0;

  async function submit() {
    const problems = check(settings, change);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    const saved = await save(change, "Models saved. They apply from each helper's next request.");
    if (saved) setErrors(saved);
    setBusy(false);
  }

  return (
    <Group
      title="Each helper"
      line="Switch a helper off on its own, or choose its model. Dearer models are slower and cost more per request."
      section="helpers"
      dto={dto}
      onSubmit={() => void submit()}
      dirty={dirty}
      busy={busy}
      error={switches.error ?? errors.form ?? null}
    >
      {/* A computer: one header for the three columns; a phone stacks each helper. */}
      <div className="hidden grid-cols-[minmax(0,1fr)_6rem_minmax(0,18.5rem)] gap-3 border-b border-border pb-2 text-sm text-muted md:grid">
        <span>Helper</span>
        <span>Switch</span>
        <span>Model · US$ per million tokens in, out</span>
      </div>
      <p className="text-sm text-muted md:hidden">Beside each model: US$ per million tokens in, out.</p>
      <ul className="flex flex-col divide-y divide-border md:-mt-4">
        {AI_HELPER_ORDER.map((feature) => {
          const info = AI_HELPERS[feature];
          const offOnServer = server.disabled.includes(feature);
          const error = errors[`helpers.${feature}.model`];
          return (
            <li key={feature} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_6rem_minmax(0,18.5rem)] md:items-center md:gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{info.name}</p>
                <p className="text-sm text-muted">
                  {info.about} · {info.where}
                </p>
                {offOnServer && <p className="text-sm font-semibold text-danger">Off on the server (AI_DISABLED_FEATURES): cannot be switched on here.</p>}
              </div>
              <Switch
                label={info.name}
                hideLabel
                checked={settings.helpers[feature].on}
                disabled={locked || switches.busy !== null}
                onChange={(on) => void switches.flip(feature, { helpers: { [feature]: { on } } }, `${info.name} switched ${on ? "on" : "off"}. It applies from the next request.`)}
              />
              <div className="min-w-0">
                {error && <p className="mb-1 text-sm font-semibold text-danger">{error}</p>}
                <ModelChoice label={`${info.name}'s model`} value={models[feature]} choices={info.models} disabled={locked || info.models.length < 2} onChange={(key) => setModels((now) => ({ ...now, [feature]: key }))} />
              </div>
              {feature === "licence-reader" && (
                <div className="grid gap-2 md:col-span-3 md:grid-cols-[minmax(0,1fr)_minmax(0,18.5rem)] md:gap-3 md:pl-5">
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={secondTry} disabled={locked} onChange={(event) => setSecondTry(event.target.checked)} />
                    <span>
                      <span className="font-semibold">Try twice</span>
                      <span className="block text-muted">When the first model cannot read the number or the expiry date, the second tries once.</span>
                    </span>
                  </label>
                  <div className="min-w-0">
                    {errors["licenceReader.secondModel"] && <p className="mb-1 text-sm font-semibold text-danger">{errors["licenceReader.secondModel"]}</p>}
                    <ModelChoice label="The second try's model" value={secondModel} choices={LICENCE_SECOND_MODELS} disabled={locked || !secondTry} onChange={setSecondModel} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

// ───────────────────────── Limits ─────────────────────────

/** A group of typed amounts: the text in each box, what is wrong with it, and saving it. */
function useAmounts<K extends string>(initial: Record<K, string>) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = (Object.keys(initial) as K[]).some((key) => values[key] !== initial[key]);
  const set = (key: K) => (event: { target: { value: string } }) => setValues((now) => ({ ...now, [key]: event.target.value }));
  return { values, set, errors, setErrors, busy, setBusy, dirty };
}

const typed = (value: number | null) => (value === null ? "" : String(value));

function LimitsSection({ dto, save }: { dto: AiSettingsDto; save: SaveChange }) {
  const { settings } = dto;
  const locked = !dto.canChange || dto.server.fromEnv;
  const form = useAmounts({ dailyUsd: typed(settings.limits.dailyUsd), monthlyUsd: typed(settings.limits.monthlyUsd), outletDailyUsd: typed(settings.limits.outletDailyUsd) });
  const rate = settings.key.rupeeRate;
  const rupees = (text: string) => {
    const value = amount(text);
    return typeof value === "number" ? `≈ ${inr(value, rate)}` : undefined;
  };

  async function submit() {
    const daily = amount(form.values.dailyUsd);
    const monthly = amount(form.values.monthlyUsd, true);
    const outlet = amount(form.values.outletDailyUsd);
    const typing: Record<string, string> = {};
    if (daily === undefined) typing["limits.dailyUsd"] = "Enter the daily limit in US dollars, e.g. 2";
    if (monthly === undefined) typing["limits.monthlyUsd"] = "Enter the monthly limit in US dollars, or leave it empty";
    if (outlet === undefined) typing["limits.outletDailyUsd"] = "Enter the per-outlet limit in US dollars, e.g. 0.25";
    const change: AiSettingsPatch = { limits: { dailyUsd: daily ?? undefined, monthlyUsd: monthly, outletDailyUsd: outlet ?? undefined } };
    const problems = Object.keys(typing).length > 0 ? typing : check(settings, change);
    form.setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    form.setBusy(true);
    const saved = await save(change, "Limits saved. They apply from the next request.");
    if (saved) form.setErrors(saved);
    form.setBusy(false);
  }

  return (
    <Group
      title="Limits"
      line="Hard limits: over one, requests are refused and the apps carry on without AI until the day (or month) turns, India time."
      section="limits"
      dto={dto}
      onSubmit={() => void submit()}
      dirty={form.dirty}
      busy={form.busy}
      error={form.errors.form ?? null}
    >
      <Field label="A day, everything (US$)" plainLabel inputMode="decimal" name="dailyUsd" value={form.values.dailyUsd} onChange={form.set("dailyUsd")} disabled={locked} hint={rupees(form.values.dailyUsd)} error={form.errors["limits.dailyUsd"]} />
      <Field
        label="A month, everything (US$)"
        inputMode="decimal"
        name="monthlyUsd"
        value={form.values.monthlyUsd}
        onChange={form.set("monthlyUsd")}
        disabled={locked}
        hint={form.values.monthlyUsd.trim() ? rupees(form.values.monthlyUsd) : "Empty: no monthly limit. Counted from the 1st, India time."}
        error={form.errors["limits.monthlyUsd"]}
      />
      <Field
        label="A day, each outlet (US$)"
        plainLabel
        inputMode="decimal"
        name="outletDailyUsd"
        value={form.values.outletDailyUsd}
        onChange={form.set("outletDailyUsd")}
        disabled={locked}
        hint={[rupees(form.values.outletDailyUsd), "ECCS's own work (digest, write-ups, shop boards) does not count here."].filter(Boolean).join(" · ")}
        error={form.errors["limits.outletDailyUsd"]}
      />
    </Group>
  );
}

// ───────────────────────── Warnings ─────────────────────────

function WarningsSection({ dto, save }: { dto: AiSettingsDto; save: SaveChange }) {
  const { settings } = dto;
  const locked = !dto.canChange || dto.server.fromEnv;
  const form = useAmounts({ dayPercent: String(settings.warnings.dayPercent), monthPercent: String(settings.warnings.monthPercent), creditUnderUsd: String(settings.warnings.creditUnderUsd) });

  async function submit() {
    const day = amount(form.values.dayPercent);
    const month = amount(form.values.monthPercent);
    const credit = amount(form.values.creditUnderUsd);
    const typing: Record<string, string> = {};
    if (day === undefined) typing["warnings.dayPercent"] = "Enter a share from 10 to 100";
    if (month === undefined) typing["warnings.monthPercent"] = "Enter a share from 10 to 100";
    if (credit === undefined) typing["warnings.creditUnderUsd"] = "Enter an amount in US dollars, e.g. 20";
    const change: AiSettingsPatch = { warnings: { dayPercent: day ?? undefined, monthPercent: month ?? undefined, creditUnderUsd: credit ?? undefined } };
    const problems = Object.keys(typing).length > 0 ? typing : check(settings, change);
    form.setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    form.setBusy(true);
    const saved = await save(change, "Warnings saved.");
    if (saved) form.setErrors(saved);
    form.setBusy(false);
  }

  return (
    <Group title="Warnings" line="Soft: nothing is refused. Each shows at the top of this page while it is true." section="warnings" dto={dto} onSubmit={() => void submit()} dirty={form.dirty} busy={form.busy} error={form.errors.form ?? null}>
      <Field label="When a day passes this share of its limit (%)" plainLabel inputMode="numeric" name="dayPercent" value={form.values.dayPercent} onChange={form.set("dayPercent")} disabled={locked} error={form.errors["warnings.dayPercent"]} />
      <Field
        label="When the month passes this share of its limit (%)"
        plainLabel
        inputMode="numeric"
        name="monthPercent"
        value={form.values.monthPercent}
        onChange={form.set("monthPercent")}
        disabled={locked}
        hint={settings.limits.monthlyUsd === null ? "Only once a monthly limit is set." : undefined}
        error={form.errors["warnings.monthPercent"]}
      />
      <Field label="When the credit left falls under (US$)" plainLabel inputMode="decimal" name="creditUnderUsd" value={form.values.creditUnderUsd} onChange={form.set("creditUnderUsd")} disabled={locked} error={form.errors["warnings.creditUnderUsd"]} />
    </Group>
  );
}

// ───────────────────────── ECCS Buddy ─────────────────────────

function BuddySection({ dto, save }: { dto: AiSettingsDto; save: SaveChange }) {
  const { settings } = dto;
  const locked = !dto.canChange || dto.server.fromEnv;
  const form = useAmounts({
    effort: settings.buddy.effort,
    thinking: settings.buddy.thinking,
    dailyMessages: String(settings.buddy.dailyMessages),
    perMinute: String(settings.buddy.perMinute),
    blocksBeforePause: String(settings.buddy.blocksBeforePause),
  });

  async function submit() {
    const numbers = { dailyMessages: amount(form.values.dailyMessages), perMinute: amount(form.values.perMinute), blocksBeforePause: amount(form.values.blocksBeforePause) };
    const typing: Record<string, string> = {};
    for (const [key, value] of Object.entries(numbers)) if (value === undefined) typing[`buddy.${key}`] = "Enter a whole number";
    const change: AiSettingsPatch = {
      buddy: {
        effort: form.values.effort as AiSettings["buddy"]["effort"],
        thinking: form.values.thinking as AiSettings["buddy"]["thinking"],
        dailyMessages: numbers.dailyMessages ?? undefined,
        perMinute: numbers.perMinute ?? undefined,
        blocksBeforePause: numbers.blocksBeforePause ?? undefined,
      },
    };
    const problems = Object.keys(typing).length > 0 ? typing : check(settings, change);
    form.setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    form.setBusy(true);
    const saved = await save(change, "Buddy's settings saved. They apply from the next message.");
    if (saved) form.setErrors(saved);
    form.setBusy(false);
  }

  return (
    <Group
      title="ECCS Buddy"
      line="The helper in the restaurant app: how hard it thinks and each person's limits. Its model, and its scope check's switch, are under Each helper."
      section="buddy"
      dto={dto}
      onSubmit={() => void submit()}
      dirty={form.dirty}
      busy={form.busy}
      error={form.errors.form ?? null}
    >
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <SelectField label="Effort" value={form.values.effort} onChange={form.set("effort")} disabled={locked} hint="Medium was measured best for the cost">
          {BUDDY_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {effort[0]!.toUpperCase() + effort.slice(1)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Thinking" value={form.values.thinking} onChange={form.set("thinking")} disabled={locked} hint="Thinking is billed as output">
          <option value="adaptive">When needed</option>
          <option value="off">Off</option>
        </SelectField>
      </div>
      <div className="grid items-end gap-4 sm:grid-cols-3">
        <Field label="Messages a day, per person" plainLabel inputMode="numeric" name="dailyMessages" value={form.values.dailyMessages} onChange={form.set("dailyMessages")} disabled={locked} error={form.errors["buddy.dailyMessages"]} />
        <Field label="Messages a minute, per person" plainLabel inputMode="numeric" name="perMinute" value={form.values.perMinute} onChange={form.set("perMinute")} disabled={locked} error={form.errors["buddy.perMinute"]} />
        <Field label="Refusals before a pause" plainLabel inputMode="numeric" name="blocksBeforePause" value={form.values.blocksBeforePause} onChange={form.set("blocksBeforePause")} disabled={locked} error={form.errors["buddy.blocksBeforePause"]} />
      </div>
    </Group>
  );
}

// ───────────────────────── About the key ─────────────────────────

function KeySection({ dto, save }: { dto: AiSettingsDto; save: SaveChange }) {
  const { settings } = dto;
  const locked = !dto.canChange || dto.server.fromEnv;
  const form = useAmounts({ creditUsd: String(settings.key.creditUsd), loadedOn: settings.key.loadedOn, monthlyCapUsd: typed(settings.key.monthlyCapUsd), rupeeRate: String(settings.key.rupeeRate) });

  async function submit() {
    const credit = amount(form.values.creditUsd);
    const cap = amount(form.values.monthlyCapUsd, true);
    const rate = amount(form.values.rupeeRate);
    const typing: Record<string, string> = {};
    if (credit === undefined) typing["key.creditUsd"] = "Enter the credit in US dollars, e.g. 100";
    if (cap === undefined) typing["key.monthlyCapUsd"] = "Enter the cap in US dollars, or leave it empty";
    if (rate === undefined) typing["key.rupeeRate"] = "Enter the rupees to one dollar, e.g. 84";
    const change: AiSettingsPatch = { key: { creditUsd: credit ?? undefined, loadedOn: form.values.loadedOn, monthlyCapUsd: cap, rupeeRate: rate ?? undefined } };
    const problems = Object.keys(typing).length > 0 ? typing : check(settings, change);
    form.setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    form.setBusy(true);
    const saved = await save(change, "Saved.");
    if (saved) form.setErrors(saved);
    form.setBusy(false);
  }

  return (
    <Group
      title="About the key"
      line="Facts you type from Anthropic's console, for the cards: nothing here is sent anywhere or enforced."
      section="key"
      dto={dto}
      onSubmit={() => void submit()}
      dirty={form.dirty}
      busy={form.busy}
      error={form.errors.form ?? null}
    >
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field label="Credit loaded (US$)" plainLabel inputMode="decimal" name="creditUsd" value={form.values.creditUsd} onChange={form.set("creditUsd")} disabled={locked} error={form.errors["key.creditUsd"]} />
        <Field label="Loaded on" plainLabel type="date" name="loadedOn" value={form.values.loadedOn} onChange={form.set("loadedOn")} disabled={locked} error={form.errors["key.loadedOn"]} />
        <Field
          label="Monthly cap in Anthropic's console (US$)"
          inputMode="decimal"
          name="monthlyCapUsd"
          value={form.values.monthlyCapUsd}
          onChange={form.set("monthlyCapUsd")}
          disabled={locked}
          hint="Anthropic enforces it; it is shown here only"
          error={form.errors["key.monthlyCapUsd"]}
        />
        <Field label="Rupees to one US dollar" plainLabel inputMode="decimal" name="rupeeRate" value={form.values.rupeeRate} onChange={form.set("rupeeRate")} disabled={locked} error={form.errors["key.rupeeRate"]} />
      </div>
    </Group>
  );
}

// ───────────────────────── Latest changes ─────────────────────────

function History({ dto }: { dto: AiSettingsDto }) {
  return (
    <Panel title="Latest changes" description="Who changed what, newest first. Every change is also in the Logs page.">
      {dto.history.length === 0 ? (
        <p className="text-sm text-muted">Nothing changed yet: every setting is at the server&apos;s defaults.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {dto.history.map((entry) => (
            <li key={entry.at} className="flex flex-col gap-0.5 py-2.5">
              <p>
                <strong>{entry.by}</strong>
                {entry.role && <span className="text-muted"> · {entry.role}</span>}
                <span className="text-muted"> · {when(entry.at)}</span>
              </p>
              <ul className="text-muted">
                {entry.changes.map((change) => (
                  <li key={`${change.label}-${change.to}`}>
                    <span className="sr-only">{AI_SETTINGS_SECTION_LABELS[change.section]}: </span>
                    {aiSettingChangeLine(change)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The problems a failed save came back with, by setting ("limits.dailyUsd"), or one line under "form". */
export function problemsOf(error: unknown): Record<string, string> {
  if (error instanceof ApiError) {
    const issues = (error.details?.issues as { path: string; message: string }[] | undefined) ?? [];
    const byPath = Object.fromEntries(issues.filter((issue) => issue.path).map((issue) => [issue.path, issue.message]));
    return Object.keys(byPath).length > 0 ? byPath : { form: error.message };
  }
  return { form: describe(error) };
}
