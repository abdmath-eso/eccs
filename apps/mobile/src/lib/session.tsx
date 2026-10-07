import { ApiError, type ApiClient } from '@eccs/api-client';
import { createTranslator, LANGUAGE_CODES, type LanguageCode, type Translator } from '@eccs/i18n';
import type { CurrentUserDto, LinkedDeviceDto, SessionDto } from '@eccs/shared';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import { api, setAppLanguage, setSessionToken, setUnauthorizedHandler } from './api';
import { getItem, getJson, removeItem, setItem, setJson } from './storage';

const KEYS = {
  language: 'eccs.language',
  // Set while a language chosen on this phone has not reached the server yet.
  languageUnsaved: 'eccs.languageUnsaved',
  linkedDevice: 'eccs.linkedDevice',
  token: 'eccs.sessionToken',
  user: 'eccs.user',
} as const;

interface SessionContextValue {
  /** False until stored state has been read at startup. */
  ready: boolean;
  api: ApiClient;
  language: LanguageCode;
  t: Translator;
  setLanguage: (language: LanguageCode) => Promise<void>;
  /** The restaurant this phone is linked to, if any. */
  linkedDevice: LinkedDeviceDto | null;
  linkDevice: (device: LinkedDeviceDto) => Promise<void>;
  unlinkDevice: () => Promise<void>;
  user: CurrentUserDto | null;
  /** Reads the person's details again from the server, after they have changed them. */
  refreshUser: () => Promise<void>;
  /** A PIN that was just generated for this user and must be shown once. */
  newPin: string | null;
  dismissNewPin: () => void;
  signIn: (session: SessionDto) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [language, setLanguageValue] = useState<LanguageCode>('EN');
  const [linkedDevice, setLinkedDevice] = useState<LinkedDeviceDto | null>(null);
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [newPin, setNewPin] = useState<string | null>(null);

  /** Changes the language of the screens and of what the server sends back. */
  function setLanguageState(next: LanguageCode) {
    setAppLanguage(next);
    setLanguageValue(next);
  }

  async function clearSession() {
    setSessionToken(null);
    setUser(null);
    setNewPin(null);
    await Promise.all([removeItem(KEYS.token), removeItem(KEYS.user)]);
  }

  useEffect(() => {
    setUnauthorizedHandler(() => void clearSession());
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedLanguage, unsaved, storedDevice, storedToken, storedUser] = await Promise.all([
        getItem(KEYS.language),
        getItem(KEYS.languageUnsaved),
        getJson<LinkedDeviceDto>(KEYS.linkedDevice),
        getItem(KEYS.token),
        getJson<CurrentUserDto>(KEYS.user),
      ]);
      if (cancelled) return;

      const known = LANGUAGE_CODES.find((code) => code === storedLanguage);
      if (known) setLanguageState(known);
      setLinkedDevice(storedDevice);
      if (storedToken && storedUser) {
        // Show the last known user straight away so the app opens without
        // signal, then confirm with the server in the background.
        setSessionToken(storedToken);
        setUser(storedUser);
        if (!known) setLanguageState(storedUser.language);
      }
      setReady(true);

      if (storedToken && storedUser) {
        try {
          let fresh = await api.auth.me();
          if (known && unsaved && fresh.language !== known) {
            // A language chosen on this phone never reached the server: send it now.
            fresh = await api.auth.updateProfile({ language: known });
          } else if (fresh.language !== known && !cancelled) {
            // The person changed their language on another phone: follow it.
            setLanguageState(fresh.language);
            await setItem(KEYS.language, fresh.language);
          }
          await removeItem(KEYS.languageUnsaved);
          if (cancelled) return;
          setUser(fresh);
          await setJson(KEYS.user, fresh);
        } catch (error) {
          // A 401 is handled by onUnauthorized. Anything else (no signal) keeps the cached user.
          if (!(error instanceof ApiError)) throw error;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value: SessionContextValue = {
    ready,
    api,
    language,
    t: createTranslator(language),
    async setLanguage(next) {
      setLanguageState(next);
      await setItem(KEYS.language, next);
      if (user) {
        // Until the server has it, remember that this phone's choice is the newer one.
        await setItem(KEYS.languageUnsaved, '1');
        const updated = await api.auth.updateProfile({ language: next });
        setUser(updated);
        await Promise.all([setJson(KEYS.user, updated), removeItem(KEYS.languageUnsaved)]);
      }
    },
    linkedDevice,
    async linkDevice(device) {
      setLinkedDevice(device);
      await setJson(KEYS.linkedDevice, device);
    },
    async unlinkDevice() {
      setLinkedDevice(null);
      await removeItem(KEYS.linkedDevice);
    },
    user,
    async refreshUser() {
      const fresh = await api.auth.me();
      setUser(fresh);
      await setJson(KEYS.user, fresh);
    },
    newPin,
    dismissNewPin: () => setNewPin(null),
    async signIn(session) {
      setSessionToken(session.token);
      if (session.linkedDevice) {
        setLinkedDevice(session.linkedDevice);
        await setJson(KEYS.linkedDevice, session.linkedDevice);
      }
      setNewPin(session.generatedPin ?? null);
      setLanguageState(session.user.language);
      setUser(session.user);
      await Promise.all([
        setItem(KEYS.token, session.token),
        setJson(KEYS.user, session.user),
        setItem(KEYS.language, session.user.language),
        removeItem(KEYS.languageUnsaved),
      ]);
    },
    async signOut() {
      try {
        await api.auth.logout();
      } catch {
        // Offline or already expired: the local session is cleared either way.
      }
      await clearSession();
    },
  };

  return <SessionContext value={value}>{children}</SessionContext>;
}
