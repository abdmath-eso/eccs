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
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "primary", loading, disabled, className = "", children, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-primary text-white hover:bg-primary-hover px-4 py-2.5 rounded-lg font-semibold",
    secondary: "bg-surface border border-border-strong hover:bg-background px-4 py-2.5 rounded-lg font-semibold",
    danger: "bg-danger text-white hover:bg-danger-hover px-4 py-2.5 rounded-lg font-semibold",
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
