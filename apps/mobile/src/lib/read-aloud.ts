import { voiceFor } from '@eccs/shared';
import { useEffect, useState } from 'react';

// "Read aloud" on ECCS Buddy's answers (16 Oct 2026): the phone's own text-to-speech voice, in the
// app's language (expo-speech: Android's and iOS's built-in voices, the browser's in the preview).
// The button is hidden when the phone has no voice for the language, rather than reading Telugu
// with an English voice. expo-speech is in Expo Go; an APK built before it was added has no
// native part for it, so it is loaded only when used and the button hides there too.

type SpeechModule = typeof import('expo-speech');
let loaded: SpeechModule | null | undefined;

function speechModule(): SpeechModule | null {
  if (loaded === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require('expo-speech') as SpeechModule;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/** The phone's voice for a speech tag such as "te-IN", or null when it has none (Read aloud is then hidden). */
export function useReadAloudVoice(tag: string): { identifier: string; language: string } | null {
  const [voice, setVoice] = useState<{ identifier: string; language: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const speech = speechModule();
    if (!speech) return;
    speech
      .getAvailableVoicesAsync()
      .then((voices) => {
        if (!cancelled) setVoice(voiceFor(tag, voices) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tag]);
  return voice;
}

/** Reads the words aloud with the voice; `onDone` is called when it ends or stops. */
export function readAloud(words: string, voice: { identifier: string; language: string }, onDone: () => void): void {
  const speech = speechModule();
  if (!speech) return onDone();
  speech.stop().catch(() => undefined);
  speech.speak(words, { language: voice.language, voice: voice.identifier, onDone, onStopped: onDone, onError: onDone });
}

export function stopReading(): void {
  speechModule()
    ?.stop()
    .catch(() => undefined);
}
