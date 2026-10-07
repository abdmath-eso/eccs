import { useEffect } from 'react';

import { outbox } from './outbox';

/**
 * Runs `load` again the moment the server can be reached after it could not,
 * so a screen showing the copy saved on the phone brings itself up to date.
 */
export function useReloadOnSignal(load: () => unknown) {
  useEffect(() => {
    let before = outbox.getSnapshot().online;
    return outbox.subscribe(() => {
      const now = outbox.getSnapshot().online;
      if (before === false && now === true) void load();
      before = now;
    });
  }, [load]);
}
