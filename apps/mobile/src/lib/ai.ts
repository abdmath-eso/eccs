import type { ApiClient } from '@eccs/api-client';
import type { AiFeature } from '@eccs/shared';
import { useEffect, useState } from 'react';

import { useSession } from './session';

type Features = Partial<Record<AiFeature, boolean>>;

/** Asked again after this long, so switching AI off on the server reaches the app within minutes. */
const FRESH_FOR_MS = 5 * 60 * 1000;
let cache: { api: ApiClient; at: number; features: Features } | null = null;

const freshFor = (api: ApiClient) => (cache && cache.api === api && Date.now() - cache.at < FRESH_FOR_MS ? cache.features : null);

/**
 * Which AI features the server has switched on (14 Oct 2026), so a screen shows
 * an AI button or note only when it can work. Until the server has answered, and
 * whenever it cannot be reached, every feature counts as off: AI is never needed
 * for the app to work.
 */
export function useAiFeatures(): Features {
  const { api } = useSession();
  const [features, setFeatures] = useState<Features>(() => freshFor(api) ?? cache?.features ?? {});

  useEffect(() => {
    if (freshFor(api)) return;
    let cancelled = false;
    api.ai
      .status()
      .then((status) => {
        cache = { api, at: Date.now(), features: status.features };
        if (!cancelled) setFeatures(status.features);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  return features;
}
