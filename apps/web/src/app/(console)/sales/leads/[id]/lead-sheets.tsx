"use client";

import {
  ASK_SIGNAL_LABELS,
  ASK_SIGNALS,
  CYCLE_WORDS,
  loseSchema,
  quoteTotals,
  STEP_KINDS,
  STEP_LABELS,
  stepSchema,
  type AskSignal,
  type LeadDetailDto,
  type OrganizationDto,
  type QuoteDto,
  type QuoteOptionDto,
  type StepInput,
  type StepKind,
} from "@eccs/shared";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Button, ErrorMessage, Field, Loading, SelectField, TextAreaField } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst, focusFirstError, hasErrors, type FieldErrors } from "@/lib/forms";
import { describe, matchesSearch } from "@/lib/format";

import { money, Segmented, Sheet } from "../../../finance/finance-parts";
import { fromLocalInput, toLocalInput } from "../../sales-parts";

// The panels on a lead's page (15 Oct 2026): log a step, make and send a quote, mark it
// lost, and "Became a client". Each opens from the right over the page, as the Finance
// page's forms do.

// ───────────────────────── Log a step ─────────────────────────

/**
 * PATTERN FOLLOWED: Pipedrive's "log an activity" (the kind of activity, a note, when it
 * happened, and the next activity scheduled in the same step) and LeadSquared's field
 * check-in. The lead moves right by itself when the step calls for it.
 */
export function StepSheet({ open, lead, onClose, onSaved }: { open: boolean; lead: LeadDetailDto; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  return (
    <Sheet open={open} title="Log a step" onClose={onClose}>
      {open && <StepForm lead={lead} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

const STEP_HINT: Record<StepKind, string> = {
  CALL: "A new lead moves to Contacted.",
  VISIT: "A new lead moves to Contacted.",
  NOTE: "Notes move nothing.",
  CHECK_BOOKED: "The lead moves to Check booked, and the check shows in Do today on its day.",
  CHECK_DONE: "The lead moves to Check done; a quote is the next step.",
  ASKED: "A buying signal for Likely to close.",
};

function StepForm({ lead, onClose, onSaved }: { lead: LeadDetailDto; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  const notify = useToast();
  const [stepId] = useState(() => crypto.randomUUID());
  // A next step still to come is kept in the form; one already due is what this step does, so it starts empty.
  const [upcoming] = useState(() => (lead.nextActionAt && Date.parse(lead.nextActionAt) > Date.now() ? { text: lead.nextAction ?? "", at: toLocalInput(lead.nextActionAt) } : { text: "", at: "" }));
  const [kind, setKind] = useState<StepKind>(lead.stage === "CHECK_BOOKED" ? "CHECK_DONE" : "CALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const findings = text("findings");
    const input: StepInput = {
      id: stepId,
      kind,
      ...(text("at") && { at: fromLocalInput(text("at"))! }),
      note: text("note") || null,
      checkAt: kind === "CHECK_BOOKED" ? fromLocalInput(text("checkAt")) : null,
      checkWith: kind === "CHECK_BOOKED" ? text("checkWith") || null : null,
      findings: kind === "CHECK_DONE" ? (findings === "" ? null : Number(findings)) : null,
      signal: kind === "ASKED" ? (text("signal") as AskSignal) : null,
      nextAction: text("nextAction") || null,
      nextActionAt: fromLocalInput(text("nextActionAt")),
    };
    const found = checkAgainst(stepSchema, input);
    if (input.at && Date.parse(input.at) > Date.now() + 60_000) found.at = "It cannot be later than now";
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      const saved = await api.sales.logStep(lead.id, input);
      notify(saved.stage !== lead.stage ? `Logged. The lead moved to ${saved.stage === "CONTACTED" ? "Contacted" : saved.stage === "CHECK_BOOKED" ? "Check booked" : saved.stage === "CHECK_DONE" ? "Check done" : "the next stage"}.` : "Logged");
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <Segmented
        label="What happened"
        showLabel={false}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setErrors({});
        }}
        options={STEP_KINDS.map((value) => ({ value, label: STEP_LABELS[value] }))}
      />
      <p className="text-sm text-muted">{STEP_HINT[kind]}</p>
      {kind === "CHECK_BOOKED" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="When is the check" name="checkAt" type="datetime-local" required error={errors.checkAt} />
          <Field label="Who goes from ECCS" name="checkWith" maxLength={40} hint="For example Naveen" error={errors.checkWith} />
        </div>
      )}
      {kind === "CHECK_DONE" && <Field label="Things it found to fix" name="findings" type="number" min={0} max={99} required defaultValue={lead.checkFindings ?? ""} error={errors.findings} />}
      {kind === "ASKED" && (
        <SelectField label="What the owner asked" name="signal" defaultValue="QUOTE" error={errors.signal}>
          {ASK_SIGNALS.map((value) => (
            <option key={value} value={value}>
              {ASK_SIGNAL_LABELS[value]}
            </option>
          ))}
        </SelectField>
      )}
      <TextAreaField label="Note" name="note" rows={2} maxLength={200} required={kind === "NOTE"} error={errors.note} />
      <Field label="When it happened" name="at" type="datetime-local" hint="Leave empty for now" error={errors.at} />
      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <Field label="Next step" name="nextAction" maxLength={80} defaultValue={upcoming.text} error={errors.nextAction} />
        <Field label="When" name="nextActionAt" type="datetime-local" defaultValue={upcoming.at} error={errors.nextActionAt} />
      </div>
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" loading={busy}>
          Log it
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Quotes ─────────────────────────

/**
 * Opens WhatsApp with the quote's message and link typed in, for the person to send from
 * their own WhatsApp. The tab is opened while the click still counts, so the browser does
 * not block it as a pop-up. Nothing is sent by the server.
 */
export async function sendOnWhatsapp(quoteId: string): Promise<{ hasPhone: boolean }> {
  const tab = window.open("", "_blank");
  try {
    const sent = await api.sales.sendQuote(quoteId);
    if (tab) {
      tab.opener = null;
      tab.location.href = sent.whatsappUrl;
    } else window.location.assign(sent.whatsappUrl);
    return { hasPhone: sent.hasPhone };
  } catch (error) {
    tab?.close();
    throw error;
  }
}

/**
 * Make a quote from the catalogue's services and the plans on offer, at their prices
 * before GST, then send it on WhatsApp.
 * PATTERN FOLLOWED: the quote builder of Zoho CRM and Pipedrive (products picked from the
 * catalogue with a quantity, the subtotal, tax and total worked out as you go) and the
 * public quote link those tools send instead of an attachment.
 */
export function QuoteSheet({ open, lead, planFirst, onClose, onSaved }: { open: boolean; lead: LeadDetailDto; planFirst: boolean; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet open={open} title={planFirst ? "Send a plan" : "Make a quote"} onClose={onClose} wide>
      {open && <QuoteForm lead={lead} planFirst={planFirst} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function QuoteForm({ lead, planFirst, onClose, onSaved }: { lead: LeadDetailDto; planFirst: boolean; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const [options, setOptions] = useState<QuoteOptionDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.sales
      .quoteOptions()
      .then((list) => {
        if (cancelled) return;
        setOptions(list);
        // "Send plan": the cheapest plan, for every kitchen, ready to send.
        const plan = list.find((option) => option.kind === "PLAN");
        if (planFirst && plan) setChosen({ [plan.refId]: lead.kitchens });
      })
      .catch((e) => !cancelled && setLoadError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, [planFirst, lead.kitchens]);

  if (loadError) return <ErrorMessage message={loadError} />;
  if (!options) return <Loading />;

  const lines = options.filter((option) => chosen[option.refId]).map((option) => ({ ...option, quantity: chosen[option.refId]!, amountPaise: option.unitPaise * chosen[option.refId]! }));
  const totals = quoteTotals(lines);

  async function make(send: boolean) {
    if (lines.length === 0) return setError("Choose at least one service or plan");
    setBusy(send ? "send" : "draft");
    setError(null);
    try {
      const quote: QuoteDto = await api.sales.addQuote(lead.id, { lines: lines.map((line) => ({ kind: line.kind, refId: line.refId, quantity: line.quantity })) });
      if (send) {
        const { hasPhone } = await sendOnWhatsapp(quote.id);
        notify(hasPhone ? `Quote ${quote.number} ready in WhatsApp: press send there` : `Quote ${quote.number} ready in WhatsApp: choose who to send it to`);
      } else notify(`Quote ${quote.number} saved as a draft`);
      onSaved();
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  const row = (option: QuoteOptionDto) => {
    const quantity = chosen[option.refId] ?? 0;
    return (
      <li key={option.refId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_6rem_5rem]">
        <input
          type="checkbox"
          id={`option-${option.refId}`}
          checked={quantity > 0}
          onChange={(event) => setChosen((current) => ({ ...current, [option.refId]: event.target.checked ? (option.kind === "PLAN" ? lead.kitchens : 1) : 0 }))}
          className="h-5 w-5"
        />
        <label htmlFor={`option-${option.refId}`} className="min-w-0 cursor-pointer">
          {option.name}
          <span className="block text-sm text-muted">
            {money(option.unitPaise)}
            {option.cycle ? ` ${CYCLE_WORDS[option.cycle]} per kitchen` : ""}, before GST
          </span>
        </label>
        <input
          type="number"
          min={1}
          max={200}
          aria-label={`How many: ${option.name}`}
          value={quantity || ""}
          disabled={quantity === 0}
          onChange={(event) => setChosen((current) => ({ ...current, [option.refId]: Math.max(1, Math.min(200, Number(event.target.value) || 1)) }))}
          className="col-start-2 w-20 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-right tabular-nums disabled:opacity-40 sm:col-start-auto"
        />
        <span className="col-start-3 text-right text-sm tabular-nums sm:col-start-auto">{quantity > 0 ? money(option.unitPaise * quantity) : ""}</span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Prices are today&apos;s catalogue and plans. The owner gets a link to a page with the quote; when they open it, it shows on this lead.</p>
      <section>
        <h3 className="font-bold">Plans</h3>
        <ul className="flex flex-col divide-y divide-border">{options.filter((option) => option.kind === "PLAN").map(row)}</ul>
      </section>
      <section>
        <h3 className="font-bold">Services</h3>
        <ul className="flex flex-col divide-y divide-border">{options.filter((option) => option.kind === "SERVICE").map(row)}</ul>
      </section>
      <dl className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between">
          <dt>Before GST</dt>
          <dd className="tabular-nums">{money(totals.subtotalPaise)}</dd>
        </div>
        <div className="flex justify-between text-muted">
          <dt>GST (CGST and SGST)</dt>
          <dd className="tabular-nums">{money(totals.gstPaise)}</dd>
        </div>
        <div className="flex justify-between text-base font-bold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(totals.totalPaise)}</dd>
        </div>
      </dl>
      <ErrorMessage message={error} />
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button onClick={() => void make(true)} loading={busy === "send"} disabled={busy !== null}>
          Make and send on WhatsApp
        </Button>
        <Button variant="secondary" onClick={() => void make(false)} loading={busy === "draft"} disabled={busy !== null}>
          Save as a draft
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ───────────────────────── Lost ─────────────────────────

export function LoseSheet({ open, lead, onClose, onSaved }: { open: boolean; lead: LeadDetailDto; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  return (
    <Sheet open={open} title="Mark as lost" onClose={onClose}>
      {open && <LoseForm lead={lead} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function LoseForm({ lead, onClose, onSaved }: { lead: LeadDetailDto; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = { reason: String(new FormData(form).get("reason") ?? "").trim() };
    const found = checkAgainst(loseSchema, input);
    setErrors(found);
    if (hasErrors(found)) return focusFirstError(form, found);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.sales.lose(lead.id, input));
      notify("Marked as lost. It can be reopened any time.");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-muted">It keeps its stage and its history, and leaves Do today and the stale list.</p>
      <Field label="Why" name="reason" required maxLength={100} hint="For example: went with another vendor" error={errors.reason} />
      <ErrorMessage message={error} />
      <div className="flex gap-2 border-t border-border pt-4">
        <Button type="submit" variant="danger" loading={busy}>
          Mark as lost
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Became a client ─────────────────────────

/**
 * Links the lead to the client it became, so its first job and plan are read from the app.
 * An existing client is picked from the list; a new one is onboarded on the Clients page,
 * which links it back to this lead when it is created.
 */
export function ClientSheet({ open, lead, onClose, onSaved }: { open: boolean; lead: LeadDetailDto; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  return (
    <Sheet open={open} title="Became a client" onClose={onClose}>
      {open && <ClientForm lead={lead} onClose={onClose} onSaved={onSaved} />}
    </Sheet>
  );
}

function ClientForm({ lead, onClose, onSaved }: { lead: LeadDetailDto; onClose: () => void; onSaved: (lead: LeadDetailDto) => void }) {
  const notify = useToast();
  const [clients, setClients] = useState<OrganizationDto[] | null>(null);
  const [search, setSearch] = useState(lead.businessName.replace(/\s*\(sample\)$/, "").split(/[,(]/)[0]!.trim());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.organizations
      .list()
      .then((list) => !cancelled && setClients(list))
      .catch((e) => !cancelled && setError(describe(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  async function link(organizationId: string | null) {
    setBusy(organizationId ?? "none");
    setError(null);
    try {
      onSaved(await api.sales.linkClient(lead.id, { organizationId }));
      notify(organizationId ? "Linked. Its first job and plan now come from the app." : "Link removed");
      onClose();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  const matching = (clients ?? []).filter((client) => matchesSearch(search, [client.name, ...client.outlets.map((outlet) => outlet.name)])).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">From then on, the client&apos;s first approved visit makes this lead a First job and an active plan puts it On a plan.</p>
      {lead.organization && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
          <span>
            Linked to <strong>{lead.organization.name}</strong>
          </span>
          <Button variant="link" className="text-sm text-danger" loading={busy === "none"} onClick={() => void link(null)}>
            Remove the link
          </Button>
        </div>
      )}
      <Link href={`/?onboard=1&lead=${encodeURIComponent(lead.id)}`} className="w-fit rounded-lg border border-border-strong px-4 py-2.5 font-semibold hover:bg-background">
        Onboard it as a new restaurant
      </Link>
      <Field label="Or find an existing client" type="search" plainLabel value={search} onChange={(event) => setSearch(event.target.value)} />
      <ErrorMessage message={error} />
      {!clients && !error && <Loading />}
      {clients && (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {matching.length === 0 && <li className="py-2 text-muted">No client matches.</li>}
          {matching.slice(0, 30).map((client) => (
            <li key={client.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{client.name}</span>
                <span className="block text-muted">{client.outlets.map((outlet) => outlet.name).join(", ")}</span>
              </span>
              <Button size="sm" variant="secondary" loading={busy === client.id} disabled={busy !== null || lead.organization?.id === client.id} onClick={() => void link(client.id)}>
                {lead.organization?.id === client.id ? "Linked" : "Link"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
