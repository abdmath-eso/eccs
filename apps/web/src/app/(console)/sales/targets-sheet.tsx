"use client";

import { TARGET_FIGURES, TARGET_LABELS, targetFloorsSchema, type SalesOverviewDto, type TargetFigure } from "@eccs/shared";
import { useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Button, ErrorMessage } from "@/components/ui";
import { api } from "@/lib/api";
import { checkAgainst } from "@/lib/forms";
import { describe } from "@/lib/format";

import { Sheet } from "../finance/finance-parts";

// The BDEs' weekly targets (the Super Admin, 15 Oct 2026). Each Monday every target is set
// from the last two weeks (their average, rounded up, never below the floor); here the
// Super Admin sets the floors, and may set any one BDE's figure for this week by hand.
// A box left empty follows the suggestion, shown faintly in it.

const LABEL: Record<TargetFigure, string> = { leads: "Leads", checks: "Free checks", firstJobs: "First jobs", plans: "Plans" };

export function TargetsSheet({ open, onClose, overview, onSaved }: { open: boolean; onClose: () => void; overview: SalesOverviewDto; onSaved: () => void }) {
  return (
    <Sheet open={open} title="Weekly targets" onClose={onClose} wide>
      {open && <Targets overview={overview} onSaved={onSaved} />}
    </Sheet>
  );
}

const cell = "w-16 rounded-lg border border-border-strong bg-surface px-2 py-1.5 text-right tabular-nums";

function Targets({ overview, onSaved }: { overview: SalesOverviewDto; onSaved: () => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveFloors(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = Object.fromEntries(TARGET_FIGURES.map((figure) => [figure, Number(values.get(figure) || 0)])) as Record<TargetFigure, number>;
    const found = checkAgainst(targetFloorsSchema, input);
    if (Object.keys(found).length > 0) return setError(Object.values(found)[0]!);
    setBusy("floors");
    setError(null);
    try {
      await api.sales.setFloors(input);
      notify("Lowest targets saved");
      onSaved();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveWeek(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = Object.fromEntries(
      TARGET_FIGURES.map((figure) => {
        const typed = String(values.get(figure) ?? "").trim();
        return [figure, typed === "" ? null : Number(typed)];
      }),
    ) as Record<TargetFigure, number | null>;
    if (Object.values(input).some((value) => value !== null && (!Number.isInteger(value) || value < 0 || value > 500))) return setError("Enter whole numbers from 0 to 500, or leave a box empty");
    setBusy(userId);
    setError(null);
    try {
      await api.sales.setTarget(userId, { weekStart: overview.weekStart, ...input });
      notify("Targets for this week saved");
      onSaved();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Every Monday each BDE&apos;s targets are set from their last two weeks: the average, rounded up, never below the lowest targets here. Set a figure for this week by hand to replace the suggestion; leave a box empty to follow it.
      </p>
      <ErrorMessage message={error} />

      <section className="flex flex-col gap-3">
        <h3 className="font-bold">This week</h3>
        {overview.byBde.length === 0 ? (
          <p className="text-sm text-muted">No BDEs yet.</p>
        ) : (
          overview.byBde.map((row) => (
            <form key={row.userId} onSubmit={(event) => void saveWeek(event, row.userId)} className="flex flex-col gap-2 border-b border-border pb-3">
              <span className="font-semibold">{row.name}</span>
              <div className="flex flex-wrap items-end gap-3">
                {TARGET_FIGURES.map((figure) => (
                  <label key={figure} className="flex flex-col gap-1 text-sm">
                    <span className="text-muted">{LABEL[figure]}</span>
                    <input
                      name={figure}
                      inputMode="numeric"
                      className={cell}
                      defaultValue={row.overridden.includes(figure) ? String(row.targets[figure]) : ""}
                      placeholder={String(row.overridden.includes(figure) ? "" : row.targets[figure])}
                      aria-label={`${row.name}: ${TARGET_LABELS[figure][1]} target this week`}
                    />
                  </label>
                ))}
                <Button type="submit" size="sm" variant="secondary" loading={busy === row.userId}>
                  Save
                </Button>
              </div>
              <span className="text-xs text-muted">
                Last week {TARGET_FIGURES.map((figure) => `${row.lastWeek[figure]} ${TARGET_LABELS[figure][row.lastWeek[figure] === 1 ? 0 : 1]}`).join(" · ")}
              </span>
            </form>
          ))
        )}
      </section>

      <form onSubmit={(event) => void saveFloors(event)} className="flex flex-col gap-3">
        <h3 className="font-bold">Lowest targets</h3>
        <div className="flex flex-wrap items-end gap-3">
          {TARGET_FIGURES.map((figure) => (
            <label key={figure} className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{LABEL[figure]}</span>
              <input name={figure} inputMode="numeric" className={cell} defaultValue={String(overview.floors[figure])} aria-label={`Lowest weekly ${TARGET_LABELS[figure][1]} target`} />
            </label>
          ))}
          <Button type="submit" size="sm" loading={busy === "floors"}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
