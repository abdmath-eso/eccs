import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "link";
  /**
   * "sm" is for buttons that are not the main thing on the page: the choices
   * of a filter, the buttons of the top bar. Still 32px tall, above the 24px
   * a clickable thing needs.
   */
  size?: "md" | "sm";
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "primary", size = "md", loading, disabled, className = "", children, ...rest }: ButtonProps) {
  const box = size === "sm" ? "px-3 py-1.5 text-sm rounded-lg font-semibold" : "px-4 py-2.5 rounded-lg font-semibold";
  const styles = {
    primary: `bg-primary text-white hover:bg-primary-hover ${box}`,
    secondary: `bg-surface border border-border-strong hover:bg-background ${box}`,
    danger: `bg-danger text-white hover:bg-danger-hover ${box}`,
    // Padded so the clickable area is comfortably more than 24px tall and wide.
    link: "text-primary hover:underline font-semibold px-2 py-1 rounded-md",
  }[variant];

  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading}
      className={`${styles} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

/** The look of every box a person types or chooses in. */
export const CONTROL_STYLE = "rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-base font-normal";

interface LabelProps {
  label: string;
  /** How to fill it in, e.g. "10 digits". Shown under the label and read out with the field. */
  hint?: string;
  /** What is wrong with what was typed. Shown under the label in red and read out with the field. */
  error?: string;
}

/**
 * The label, hint and error of one form field, linked to its control so a
 * screen reader reads them together. The error sits above the control, where
 * it is still visible while the person corrects it.
 */
function FieldFrame({
  label,
  hint,
  error,
  required,
  className = "",
  children,
}: LabelProps & {
  required?: boolean;
  className?: string;
  children: (control: { id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={`flex flex-col gap-1 text-sm font-medium ${className}`}>
      <label htmlFor={id}>
        {label}
        {!required && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {hint && (
        <span id={hintId} className="font-normal text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="font-semibold text-danger">
          <span aria-hidden>! </span>
          <span className="sr-only">Error: </span>
          {error}
        </span>
      )}
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
      })}
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> &
  LabelProps & {
    wrapperClassName?: string;
    /** For a search or filter box, which is not part of a form to fill in: leaves off the "(optional)" note. */
    plainLabel?: boolean;
  };

export function Field({ label, hint, error, className = "", wrapperClassName, plainLabel, ...rest }: FieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={rest.required || plainLabel} className={wrapperClassName}>
      {(control) => <input className={`${CONTROL_STYLE} ${className}`} {...rest} {...control} />}
    </FieldFrame>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & LabelProps & { wrapperClassName?: string };

/** A drop-down list with the same label, hint and error as `Field`. A list always has a value, so it is never marked optional. */
export function SelectField({ label, hint, error, className = "", wrapperClassName, children, ...rest }: SelectFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required className={wrapperClassName}>
      {(control) => (
        <select className={`${CONTROL_STYLE} ${className}`} {...rest} {...control}>
          {children}
        </select>
      )}
    </FieldFrame>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & LabelProps & { wrapperClassName?: string };

export function TextAreaField({ label, hint, error, className = "", wrapperClassName, ...rest }: TextAreaFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={rest.required} className={wrapperClassName}>
      {(control) => <textarea className={`${CONTROL_STYLE} ${className}`} {...rest} {...control} />}
    </FieldFrame>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

/** A "Loading…" line that a screen reader announces. */
export function Loading({ children = "Loading…", className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <p role="status" className={`text-muted ${className}`}>
      {children}
    </p>
  );
}

/**
 * A row of buttons that switch a view or filter, one of them on at a time.
 * Each says whether it is on (`aria-pressed`), and the one that is on is
 * filled in, so the choice does not depend on colour alone.
 */
export function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          // Filters sit beside the content they filter and should not outweigh the page's one main button.
          size="sm"
          variant={option.value === value ? "primary" : "secondary"}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className="ml-1.5 font-normal">({option.count})</span>}
        </Button>
      ))}
    </div>
  );
}

/**
 * The top of every console page, always the same: the page's name, one short
 * line saying what the page is for, and on the right at most one main button
 * (`action`), with any lesser ones (`secondary`) before it. Anything longer
 * than one line of explanation goes in `how`, which is folded away behind
 * "How this works" so it is there for a newcomer and out of the way for
 * someone who uses the page every day.
 */
export function PageHeader({
  title,
  description,
  action,
  secondary,
  how,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  how?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="mt-0.5 text-muted">{description}</p>}
        </div>
        {(action || secondary) && (
          <div className="flex flex-wrap items-start gap-2">
            {secondary}
            {action}
          </div>
        )}
      </div>
      {how && <HowItWorks>{how}</HowItWorks>}
    </header>
  );
}

/** Explanation folded away until asked for. Each paragraph inside is a `<p>`. */
export function HowItWorks({ label = "How this works", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer rounded-md py-1 font-semibold text-primary">{label}</summary>
      <div className="mt-1 flex max-w-3xl flex-col gap-2 text-muted">{children}</div>
    </details>
  );
}

/** A failed load: what went wrong, and a way to try again, beside where the content would have been. */
export function LoadError({ message, onRetry, className = "" }: { message: string | null; onRetry: () => void; className?: string }) {
  if (!message) return null;
  return (
    <div className={`flex flex-col items-start gap-3 ${className}`}>
      <ErrorMessage message={message} />
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * What a list shows when it has nothing in it: says so, says when something
 * will appear or what to do, and can offer the one action that fills it.
 */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-xl text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Shown in place of a page to someone whose role cannot use it. The menu does not list such pages; this is for a typed or saved address. */
export function NoAccess({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <Card>
        <p className="font-semibold">This page is not part of your role.</p>
        <p className="mt-1 text-muted">{children}</p>
      </Card>
    </div>
  );
}

/**
 * An on/off switch with its label beside it. It says "On" or "Off" in words
 * and the knob moves, so its state is not shown by colour alone.
 */
export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex cursor-pointer items-center gap-3 rounded-lg py-1 text-left font-semibold disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 ${checked ? "justify-end border-primary bg-primary" : "justify-start border-border-strong bg-surface"}`}
      >
        <span className={`h-4.5 w-4.5 rounded-full ${checked ? "bg-white" : "bg-border-strong"}`} />
      </span>
      <span>
        {label}
        <span className="ml-2 font-normal text-muted">{checked ? "On" : "Off"}</span>
      </span>
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>{children}</section>;
}

/** A restaurant code or similar value, in a fixed-width face so it is easy to read out. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-primary/10 px-2 py-1 font-mono text-sm font-semibold tracking-wide text-primary select-all">
      {children}
    </code>
  );
}
