"use client";

import { ApiError } from "@eccs/api-client";
import { isEccsRole, type CurrentUserDto, type SessionDto } from "@eccs/shared";
import { createContext, use, useEffect, useState, type ReactNode } from "react";

import { api, getStoredToken, setUnauthorizedHandler, storeToken } from "./api";

type Status = "loading" | "signedOut" | "signedIn";

interface SessionContextValue {
  status: Status;
  user: CurrentUserDto | null;
  /** Starts a console session. Returns false if the person is not ECCS staff. */
  signIn: (session: SessionDto) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = use(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

/** This console is for ECCS staff. Restaurant users use the mobile app. */
export const isEccsStaff = (user: CurrentUserDto) => user.memberships.some((m) => isEccsRole(m.role));

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<CurrentUserDto | null>(null);

  useEffect(() => {
    let cancelled = false;

    setUnauthorizedHandler(() => {
      storeToken(null);
      setUser(null);
      setStatus("signedOut");
    });

    (async () => {
      if (!getStoredToken()) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      try {
        const current = await api.auth.me();
        if (cancelled) return;
        if (isEccsStaff(current)) {
          setUser(current);
          setStatus("signedIn");
        } else {
          storeToken(null);
          setStatus("signedOut");
        }
      } catch (error) {
        if (cancelled) return;
        // An expired session is handled by the handler above; anything else
        // (API not running) also lands on the login page, keeping the token.
        if (!(error instanceof ApiError) || error.status !== 401) setStatus("signedOut");
      }
    })();

    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  const value: SessionContextValue = {
    status,
    user,
    async signIn(session) {
      storeToken(session.token);
      if (!isEccsStaff(session.user)) {
        // A restaurant owner's number also passes the one-time code, but this is not their app.
        try {
          await api.auth.logout();
        } finally {
          storeToken(null);
        }
        return false;
      }
      setUser(session.user);
      setStatus("signedIn");
      return true;
    },
    async signOut() {
      try {
        await api.auth.logout();
      } catch {
        // Already expired or offline: the local session is cleared either way.
      }
      storeToken(null);
      setUser(null);
      setStatus("signedOut");
    },
  };

  return <SessionContext value={value}>{children}</SessionContext>;
}
