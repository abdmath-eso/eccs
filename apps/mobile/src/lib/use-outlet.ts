import type { OutletSummaryDto } from '@eccs/shared';
import { useEffect, useState } from 'react';

import { useSession } from './session';
import { getItem, setItem } from './storage';

const KEY = 'eccs.outlet';

/**
 * Which outlet the person is working in. A Manager or Head Chef belongs to
 * one outlet. An Owner covers several, so they choose, and the choice is
 * remembered on the phone.
 */
export function useOutlet() {
  const { api, user } = useSession();
  const ownOutletId = user?.memberships.find((m) => m.outletId)?.outletId ?? null;
  const [outlets, setOutlets] = useState<OutletSummaryDto[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [loading, setLoading] = useState(ownOutletId === null);

  useEffect(() => {
    if (ownOutletId) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, remembered] = await Promise.all([api.outlets.list(), getItem(KEY)]);
        if (cancelled) return;
        setOutlets(list);
        setChosen(list.find((outlet) => outlet.id === remembered)?.id ?? list[0]?.id ?? null);
      } catch {
        // Leaves the list empty; the screen shows that there is nothing to pick.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, ownOutletId]);

  return {
    outletId: ownOutletId ?? chosen,
    /** Empty unless the person has more than one outlet to choose from. */
    outlets: ownOutletId ? [] : outlets,
    loading,
    choose(outletId: string) {
      setChosen(outletId);
      void setItem(KEY, outletId);
    },
  };
}
