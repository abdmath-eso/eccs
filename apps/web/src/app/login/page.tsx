"use client";

import { ApiError } from "@eccs/api-client";
import { normalizePhone } from "@eccs/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button, Card, ErrorMessage, Field } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const describe = (error: unknown, fallback: string) =>
  error instanceof ApiError ? (error.isNetworkError ? "Could not reach the server. Is the API running?" : error.message) : fallback;

/** ECCS staff log in with their mobile number and a one-time code. */
export default function LoginPage() {
  const router = useRouter();
  const { status, signIn } = useSession();
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signedIn") router.replace("/");
  }, [status, router]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setBusy(true);
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

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!sentTo) return;
    setBusy(true);
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
          <form onSubmit={verify} className="mt-6 flex flex-col gap-4">
            <Field
              label="6-digit code"
              hint={`Sent to ${sentTo}`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <ErrorMessage message={error} />
            <Button type="submit" loading={busy} disabled={code.length < 6}>
              Log in
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setSentTo(null);
                setCode("");
                setError(null);
              }}
            >
              Use a different number
            </Button>
          </form>
        ) : (
          <form onSubmit={sendCode} className="mt-6 flex flex-col gap-4">
            <Field
              label="Mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              autoComplete="tel"
              placeholder="10-digit mobile number"
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
