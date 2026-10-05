import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "link";
  loading?: boolean;
}

export function Button({ variant = "primary", loading, disabled, className = "", children, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-primary text-white hover:bg-primary-hover px-4 py-2.5 rounded-lg font-semibold",
    secondary: "bg-surface border border-border hover:bg-background px-4 py-2.5 rounded-lg font-semibold",
    link: "text-primary hover:underline font-semibold",
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

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, className = "", ...rest }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      <span>
        {label}
        {!rest.required && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </span>
      <input
        className={`rounded-lg border border-border bg-surface px-3 py-2.5 text-base font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        {...rest}
      />
      {hint && <span className="font-normal text-muted">{hint}</span>}
    </label>
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
