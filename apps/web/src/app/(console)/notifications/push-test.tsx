"use client";

import { ApiError } from "@eccs/api-client";
import type { PushRecipientsDto, PushTestResultDto, Role } from "@eccs/shared";
import { useEffect, useState } from "react";

import { Button, Card, ErrorMessage, SelectField } from "@/components/ui";
import { api } from "@/lib/api";
import { describe } from "@/lib/format";

const ROLE_NAMES: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Operations Manager",
  SUPERVISOR: "Supervisor",
  OWNER: "Owner",
  MANAGER: "Manager",
  HEAD_CHEF: "Head Chef",
};

const MYSELF = "";
const phones = (count: number) => (count === 1 ? "1 phone" : `${count} phones`);

/** What happened to a test push, in a sentence, and whether it is good news. */
function outcome(result: PushTestResultDto): { ok: boolean; text: string } {
  if (!result.serverEnabled) {
    return { ok: false, text: "Nothing was sent: push is switched off on the server (see above)." };
  }
  if (result.devices === 0) {
    return {
      ok: false,
      text: "Nothing was sent: this person has no phone registered. They need to log in to the installed app on a phone and allow notifications.",
    };
  }
  if (result.accepted === result.devices) {
    return {
      ok: true,
      text: `Sent to ${phones(result.devices)}. It should appear within a few seconds. Accepted by the push service is not the same as delivered: if nothing arrives, check the phone is online and notifications are allowed for ECCS.`,
    };
  }
  return {
    ok: false,
    text: `${result.accepted} of ${phones(result.devices)} accepted. The push service said: ${result.errors.join("; ") || "no reason given"}.`,
  };
}

/**
 * Sends a test push notification to the admin's own phone or to a chosen
 * person's, to check that delivery to phones works without having to stage a
 * real event. Only ECCS admins see it. It writes nothing to anyone's list.
 */
export function PushTest() {
  const [info, setInfo] = useState<PushRecipientsDto | null>(null);
  // Hidden for anyone the server turns away (a Supervisor).
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [to, setTo] = useState(MYSELF);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PushTestResultDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.push
      .recipients()
      .then((loaded) => {
        if (cancelled) return;
        setInfo(loaded);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) setHidden(true);
        else setError(describe(e));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function send() {
    setSending(true);
    setResult(null);
    setError(null);
    try {
      setResult(await api.push.sendTest(to === MYSELF ? {} : { userId: to }));
      // Who has a phone registered may have changed (a phone that has gone is removed).
      setAttempt((current) => current + 1);
    } catch (e) {
      setError(describe(e));
    } finally {
      setSending(false);
    }
  }

  if (hidden) return null;
  const said = result ? outcome(result) : null;

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Push notifications to phones</h2>
        <p className="text-sm text-muted">
          Every notification is always in the list inside the app. When push is on, it is also sent to the phone of
          each person who is logged in to the installed app and has allowed notifications.
        </p>
      </div>

      {info && (
        <p className="text-sm">
          <span className="font-semibold">{info.serverEnabled ? "Push is on. " : "Push is off on the server. "}</span>
          {info.serverEnabled
            ? `People with a phone registered: ${info.recipients.length}.`
            : "To switch it on, set PUSH_NOTIFICATIONS=on in the server's .env file and restart the API (docs/APK_BUILD.md)."}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label="Send a test to"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setResult(null);
          }}
          wrapperClassName="min-w-64 flex-1"
        >
          <option value={MYSELF}>Myself</option>
          {info?.recipients.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {person.role ? ` (${ROLE_NAMES[person.role]})` : ""}, {phones(person.devices)}
            </option>
          ))}
        </SelectField>
        <Button loading={sending} onClick={() => void send()}>
          Send a test push
        </Button>
      </div>
      <p className="text-sm text-muted">
        Only people with a phone registered are listed. The test says “Test notification” in the person’s own language
        and is not added to their list.
      </p>

      {/* The result stays beside the button that caused it; it is not a passing message, because it may need acting on. */}
      {said && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${said.ok ? "border-border" : "border-danger/30 bg-danger/5"}`}>
          <span className="font-semibold">{said.ok ? "Sent. " : "Not sent. "}</span>
          {said.text}
        </p>
      )}
      <ErrorMessage message={error} />
    </Card>
  );
}
