import { ApiError, type ApiClient } from '@eccs/api-client';
import type { BdeDayDto, DoTodayItemDto, LeadListDto } from '@eccs/shared';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { errorMessage } from './errors';
import { fieldCache } from './offline/field-cache';
import { applyLeadPending, type Me } from './offline/field-ops';
import { isNoSignal, outbox, useOutbox } from './offline/outbox';
import { useReloadOnSignal } from './offline/use-signal';
import { useSession } from './session';

// Loading a BDE's day, leads and one lead (B2), the way the Supervisor's visits load: the
// server's latest copy is kept on the phone each time, so with no signal the screens show
// that copy (with the time it was saved) and everything done meanwhile laid over it.

const DAY = 'bde:day';
const LEADS = 'bde:leads';
/** How many of today's leads are fetched in full when Home loads, so they open without signal. */
const KEEP_FOR_OFFLINE = 8;
const FRESH_MS = 5 * 60_000;

/** Who is using the phone, for the steps they log on it. */
export function useMe(): Me | null {
  const { user } = useSession();
  return user ? { id: user.id, name: user.name } : null;
}

function useSavedList<T>(name: string) {
  const get = useCallback(() => fieldCache.getList<T>(name), [name]);
  return useSyncExternalStore(fieldCache.subscribe, get, get);
}

/** Loads something for a screen and keeps it on the phone; with no signal the copy on the phone stays, which is not an error. */
function useLoader<T>(name: string, fetch: (api: ApiClient) => Promise<T>, after?: (api: ApiClient, data: T) => void) {
  const { api, user, t } = useSession();
  const saved = useSavedList<T>(name);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? null;
  const load = useCallback(async () => {
    if (!userId) return;
    await fieldCache.load(userId);
    try {
      const data = await fetch(api);
      fieldCache.putList(name, data);
      outbox.noteReachable(true);
      setError(null);
      after?.(api, data);
    } catch (e) {
      const noSignal = isNoSignal(e);
      if (noSignal) outbox.noteReachable(false);
      setError(noSignal ? (fieldCache.getList(name) ? null : t('offline.listNotOnPhone')) : errorMessage(e, t));
    }
    // `t`, `fetch` and `after` are fixed for a screen; reloading for them is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, name, userId]);
  useReloadOnSignal(load);
  return { saved, error, load };
}

/** Fetches each of today's leads in full, one at a time, so they open without signal later. */
async function keepForOffline(api: ApiClient, items: readonly DoTodayItemDto[]) {
  const ids = [...new Set(items.map((item) => item.leadId))].slice(0, KEEP_FOR_OFFLINE);
  for (const id of ids) {
    if (Date.now() - (fieldCache.savedAt('lead', id) ?? 0) < FRESH_MS) continue;
    try {
      fieldCache.putLead(await api.sales.lead(id));
    } catch {
      return;
    }
  }
}

/** The BDE's day: their Do today and the week against their targets. */
export const useBdeDay = () =>
  useLoader<BdeDayDto>(
    DAY,
    (api) => api.sales.myDay(),
    (api, day) => void keepForOffline(api, day.items),
  );

/** All of the BDE's own leads, newest activity first; the screen filters and searches them on the phone. */
export const useLeadList = () => useLoader<LeadListDto>(LEADS, (api) => api.sales.leads({ state: 'all' }));

/** One lead: the server's copy (or the phone's), with what is waiting to be sent laid over it. */
export function useLead(leadId: string) {
  const { api, user, t } = useSession();
  const box = useOutbox();
  const me = useMe();
  const get = useCallback(() => fieldCache.getLead(leadId), [leadId]);
  const saved = useSyncExternalStore(fieldCache.subscribe, get, get);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id ?? null;

  // The copy kept on the phone, before the server answers (or when it cannot).
  useEffect(() => {
    if (userId) void fieldCache.load(userId).then(() => fieldCache.open('lead', leadId));
  }, [leadId, userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    await fieldCache.load(userId);
    try {
      fieldCache.putLead(await api.sales.lead(leadId));
      outbox.noteReachable(true);
      setError(null);
    } catch (e) {
      const noSignal = isNoSignal(e);
      if (noSignal) outbox.noteReachable(false);
      // A lead logged on this phone a moment ago is not on the server yet: not an error.
      const waiting = outbox.getSnapshot().ops.some((op) => 'subject' in op && op.subject === 'lead' && op.subjectId === leadId);
      if (waiting && e instanceof ApiError && e.status === 404) return setError(null);
      setError(noSignal ? (fieldCache.getLead(leadId) || waiting ? null : t('offline.listNotOnPhone')) : errorMessage(e, t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, leadId, userId]);
  useReloadOnSignal(load);

  const view = applyLeadPending(saved?.data ?? null, leadId, box.ops, me);
  return { view, saved, error, load, hasSignal: box.online !== false };
}
