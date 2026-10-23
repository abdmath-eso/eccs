import { ApiError } from '@eccs/api-client';
import { USAGE_RULES, usageScreenFromSegments, type UsageViewsInput } from '@eccs/shared';
import { useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSession } from './session';

// The phone app's part of the console's Usage page (23 Oct 2026): notes each screen a
// logged-in person opens, by its route ("/team/[staffId]", never the id), and sends the notes
// every half minute and when the app goes to the background. Nothing is noted while nobody is
// logged in (the PIN pad, Clock in). What the server keeps is in packages/shared/src/usage.ts.

type View = UsageViewsInput['views'][number];

let waiting: View[] = [];
let sending = false;
let record: ((input: UsageViewsInput) => Promise<void>) | null = null;

async function send() {
  if (sending || waiting.length === 0 || !record) return;
  sending = true;
  const batch = waiting.slice(0, USAGE_RULES.maxBatch);
  try {
    await record({ app: 'APP', views: batch });
    waiting = waiting.slice(batch.length);
  } catch (error) {
    // Kept for the next try without signal (up to a limit); a note the server refused is dropped.
    const unreachable = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
    waiting = unreachable ? waiting.slice(-USAGE_RULES.maxWaiting) : waiting.slice(batch.length);
  } finally {
    sending = false;
  }
}

/** Counts the screens this person opens. Draws nothing. */
export function UsageCounter({ userId }: { userId: string }) {
  const { api } = useSession();
  const screen = usageScreenFromSegments(useSegments());

  useEffect(() => {
    record = (input) => api.usage.record(input);
    return () => {
      record = null;
    };
  }, [api]);

  // Another person's notes are never sent under this login (a phone the restaurant shares).
  useEffect(() => {
    waiting = [];
    return () => {
      waiting = [];
    };
  }, [userId]);

  useEffect(() => {
    waiting.push({ screen, at: new Date().toISOString() });
    if (waiting.length >= 10) void send();
  }, [screen]);

  useEffect(() => {
    const timer = setInterval(() => void send(), USAGE_RULES.sendEveryMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void send();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return null;
}
