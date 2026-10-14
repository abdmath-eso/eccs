import { ApiError, type ApiClient } from '@eccs/api-client';
import { createTranslator, LANGUAGE_CODES, type LanguageCode, type Translator } from '@eccs/i18n';
import type { CurrentUserDto, LegalPendingDto, LinkedDeviceDto, SessionDto } from '@eccs/shared';
import Constants from 'expo-constants';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';

import { api, setAppLanguage, setSessionToken, setTermsHandler, setUnauthorizedHandler } from './api';
import { unregisterPush } from './push';
import { getItem, getJson, removeItem, setItem, setJson } from './storage';

const KEYS = {
  language: 'eccs.language',
  // Set while a language chosen on this phone has not reached the server yet.
  languageUnsaved: 'eccs.languageUnsaved',
  linkedDevice: 'eccs.linkedDevice',
  // The documents the person must agree to before using the app, so a restart still asks.
  termsPending: 'eccs.termsPending',
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
  /**
   * The documents this person must agree to before using the app (the Terms of Service,
   * the Privacy Policy...). While it is not empty, the app shows only the acceptance screen.
   */
  pendingTerms: LegalPendingDto[];
  /** Records the person's agreement to `pendingTerms`. Throws if the server did not take it. */
  acceptTerms: () => Promise<void>;
  signIn: (session: SessionDto) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Asks the server what the logged-in person must agree to now. Null when it cannot answer. */
async function fetchPending(): Promise<LegalPendingDto[] | null> {
  try {
    return (await api.legal.status()).pending;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return null;
  }
}

/** Keeps the documents still to agree to on the phone, so that opening the app again still asks. */
const savePending = (pending: LegalPendingDto[]) =>
  pending.length > 0 ? setJson(KEYS.termsPending, pending) : removeItem(KEYS.termsPending);

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
  const [pendingTerms, setPendingTerms] = useState<LegalPendingDto[]>([]);

  /** Changes the language of the screens and of what the server sends back. */
  function setLanguageState(next: LanguageCode) {
    setAppLanguage(next);
    setLanguageValue(next);
  }

  /** Keeps the documents still to agree to, on screen and on the phone. */
  async function storePending(pending: LegalPendingDto[]) {
    setPendingTerms(pending);
    await savePending(pending);
  }

  async function recheckTerms() {
    const pending = await fetchPending();
    if (!pending) return;
    setPendingTerms(pending);
    await savePending(pending);
  }

  async function clearSession() {
    setSessionToken(null);
    setUser(null);
    setNewPin(null);
    setPendingTerms([]);
    await Promise.all([removeItem(KEYS.token), removeItem(KEYS.user), removeItem(KEYS.termsPending)]);
  }

  useEffect(() => {
    setUnauthorizedHandler(() => void clearSession());
    // The server refused a request because the person has not agreed to the current terms
    // (a new version came out while they were using the app). Asking what is pending now
    // brings up the acceptance screen in place of whatever they were doing.
    setTermsHandler(() => void recheckTerms());
    return () => {
      setUnauthorizedHandler(null);
      setTermsHandler(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedLanguage, unsaved, storedDevice, storedToken, storedUser, storedPending] = await Promise.all([
        getItem(KEYS.language),
        getItem(KEYS.languageUnsaved),
        getJson<LinkedDeviceDto>(KEYS.linkedDevice),
        getItem(KEYS.token),
        getJson<CurrentUserDto>(KEYS.user),
        getJson<LegalPendingDto[]>(KEYS.termsPending),
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
        setPendingTerms(storedPending ?? []);
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
          // Whether documents were updated since the person last opened the app.
          const pending = await fetchPending();
          if (cancelled) return;
          setUser(fresh);
          if (pending) await storePending(pending);
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
      // "Use a different restaurant": normally Lock has already taken this phone's push
      // token away; this covers a login that ended some other way.
      await unregisterPush(api);
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
    pendingTerms,
    async acceptTerms() {
      try {
        const status = await api.legal.accept({
          documents: pendingTerms.map(({ key, version }) => ({ key, version })),
          language,
          appVersion: Constants.expoConfig?.version,
        });
        await storePending(status.pending);
      } catch (error) {
        // A document was updated while the screen was open: show the new set, and let the screen say so.
        if (error instanceof ApiError && error.status === 400) await recheckTerms();
        throw error;
      }
    },
    async signIn(session) {
      setSessionToken(session.token);
      // Before anything is shown: does this person have documents to agree to first? If the
      // server cannot say just now, the app opens as usual, and the server's refusal of the
      // first request (TERMS_NOT_ACCEPTED) brings the acceptance screen up then.
      const pending = (await fetchPending()) ?? [];
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
        storePending(pending),
      ]);
    },
    async signOut() {
      // First, while still logged in: stop this person's push notifications coming to this
      // phone, so that after Lock a shared phone shows nothing meant for them.
      await unregisterPush(api);
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
