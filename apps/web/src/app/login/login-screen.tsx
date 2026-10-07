"use client";

import { normalizePhone } from "@eccs/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, ErrorMessage, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";
import { useSession } from "@/lib/session";

/** ECCS staff log in with their mobile number and a one-time code. */
export default function LoginScreen() {
  const router = useRouter();
  const { status, signIn } = useSession();
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  // `fieldError` is a mistake in what was typed, shown at the field; `error` is anything else that went wrong.
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signedIn") router.replace("/");
  }, [status, router]);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setFieldError("Enter a 10-digit mobile number.");
      event.currentTarget.querySelector("input")?.focus();
      return;
    }
    setBusy(true);
    setFieldError(undefined);
    setError(null);
    try {
      await api.auth.requestOtp(normalized);
      setSentTo(normalized);
    } catch (e) {
      setError(describe(e, "Could not send the code. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sentTo) return;
    if (code.length < 6) {
      setFieldError("Enter all 6 digits of the code.");
      event.currentTarget.querySelector("input")?.focus();
      return;
    }
    setBusy(true);
    setFieldError(undefined);
    setError(null);
    try {
      const session = await api.auth.verifyOtp({ phone: sentTo, code, deviceName: "ECCS console" });
      if (!(await signIn(session))) {
        setError("This console is for ECCS staff. Restaurant owners and staff use the ECCS mobile app.");
        setSentTo(null);
        setCode("");
      }
    } catch (e) {
      setCode("");
      setError(describe(e, "That code is wrong or has expired."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-primary">ECCS Console</h1>
        <p className="mt-1 text-sm text-muted">For ECCS staff. Log in with your mobile number.</p>

        {sentTo ? (
          <form onSubmit={verify} noValidate className="mt-6 flex flex-col gap-4">
            <Field
              label="6-digit code"
              name="code"
              hint={`Sent to ${sentTo}`}
              error={fieldError}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <ErrorMessage message={error} />
            <Button type="submit" loading={busy}>
              Log in
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setSentTo(null);
                setCode("");
                setFieldError(undefined);
                setError(null);
              }}
            >
              Use a different number
            </Button>
          </form>
        ) : (
          <form onSubmit={sendCode} noValidate className="mt-6 flex flex-col gap-4">
            <Field
              label="Mobile number"
              name="phone"
              hint="10 digits."
              error={fieldError}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              autoFocus
              required
            />
            <ErrorMessage message={error} />
            <Button type="submit" loading={busy}>
              Send code
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
