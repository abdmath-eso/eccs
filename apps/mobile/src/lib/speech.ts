import type { ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';
import { isRunningInExpoGo } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// Speaking to ECCS Buddy instead of typing (16 Oct 2026). Dictation into the text box, the way
// ChatGPT's and Gemini's dictation work: tap the mic, speak, see the words appear in the box as
// they are heard, tap to stop (it also stops by itself after a pause), fix anything and tap Send.
// It never sends by itself. The phone's own speech recognition does the work, in the person's
// language as spoken in India ("te-IN"): Android's SpeechRecognizer, iOS's SFSpeechRecognizer, the
// browser's Web Speech API in the preview. No speech service of our own.
//
// The package (expo-speech-recognition) has native parts that are only in the installed app, not
// in Expo Go. As with the face camera (components/face-capture.tsx), it is loaded only when asked
// for: in Expo Go the screen shows one line saying to use the keyboard's own mic instead.

type SpeechModule = typeof import('expo-speech-recognition');
// Undefined: not looked for yet. Null: this app has no speech recognition.
let loaded: SpeechModule | null | undefined;

function speechModule(): SpeechModule | null {
  if (loaded === undefined) {
    if (Platform.OS !== 'web' && isRunningInExpoGo()) loaded = null;
    else {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        loaded = require('expo-speech-recognition') as SpeechModule;
      } catch {
        loaded = null;
      }
    }
  }
  return loaded;
}

/**
 * Whether the mic can be offered here: "ready" in the installed app and in a browser with speech
 * recognition; "expo-go" (use the keyboard's mic); "none" (this phone or browser has none).
 */
export function speechAvailability(): 'ready' | 'expo-go' | 'none' {
  if (Platform.OS !== 'web' && isRunningInExpoGo()) return 'expo-go';
  const speech = speechModule();
  if (!speech) return 'none';
  try {
    return speech.ExpoSpeechRecognitionModule.isRecognitionAvailable() ? 'ready' : 'none';
  } catch {
    return 'none';
  }
}

/** The languages the phone says it can recognise, or an empty list when it does not say (older Android, the browser). */
export async function supportedSpeechLocales(): Promise<string[]> {
  const speech = speechModule();
  if (!speech || Platform.OS === 'web') return [];
  try {
    return (await speech.ExpoSpeechRecognitionModule.getSupportedLocales({})).locales;
  } catch {
    return [];
  }
}

/** Whether the mic is allowed already, without asking. */
export async function micAllowed(): Promise<boolean> {
  const speech = speechModule();
  if (!speech) return false;
  // The browser asks by itself the first time listening starts.
  if (Platform.OS === 'web') return true;
  try {
    return (await speech.ExpoSpeechRecognitionModule.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Asks for the mic (and, on an iPhone, speech recognition). True when allowed; false when refused, and then only the phone's Settings can allow it. */
export async function askForMic(): Promise<boolean> {
  const speech = speechModule();
  if (!speech) return false;
  if (Platform.OS === 'web') return true;
  try {
    return (await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** What went wrong while listening, as the screen words it. */
export type DictationProblem = 'noSpeech' | 'denied' | 'notSupported' | 'network' | 'error';

const problemOf = (code: ExpoSpeechRecognitionErrorCode): DictationProblem | null => {
  if (code === 'aborted') return null;
  if (code === 'no-speech' || code === 'speech-timeout') return 'noSpeech';
  if (code === 'not-allowed') return 'denied';
  if (code === 'language-not-supported') return 'notSupported';
  if (code === 'network') return 'network';
  return 'error';
};

/**
 * Dictation for one text box. `start(tag)` listens in that language; the words heard so far are
 * passed to `onWords` as they come (the box shows what was typed before, then them), and kept when
 * listening ends. `stop` keeps what was heard; `cancel` throws it away and puts the box back.
 */
export function useDictation(onWords: (heard: string) => void) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const onWordsRef = useRef(onWords);
  useEffect(() => {
    onWordsRef.current = onWords;
  }, [onWords]);

  useEffect(() => {
    const speech = speechModule();
    if (!speech) return;
    const module = speech.ExpoSpeechRecognitionModule;
    const subscriptions = [
      module.addListener('result', (event) => {
        const heard = event.results[0]?.transcript ?? '';
        if (heard) onWordsRef.current(heard);
      }),
      module.addListener('error', (event) => {
        setProblem(problemOf(event.error));
        setListening(false);
      }),
      module.addListener('end', () => {
        setListening(false);
        setLevel(0);
      }),
      module.addListener('volumechange', (event) => setLevel(Math.max(0, Math.min(1, (event.value + 2) / 12)))),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  const start = useCallback((tag: string) => {
    const speech = speechModule();
    if (!speech) return;
    setProblem(null);
    setListening(true);
    try {
      speech.ExpoSpeechRecognitionModule.start({
        lang: tag,
        interimResults: true,
        // Stops by itself after a pause: one thing said, then the person checks it.
        continuous: false,
        addsPunctuation: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 150 },
      });
    } catch {
      setListening(false);
      setProblem('error');
    }
  }, []);

  const stop = useCallback(() => {
    try {
      speechModule()?.ExpoSpeechRecognitionModule.stop();
    } catch {
      // Already stopped.
    }
    setListening(false);
  }, []);

  const cancel = useCallback(() => {
    try {
      speechModule()?.ExpoSpeechRecognitionModule.abort();
    } catch {
      // Already stopped.
    }
    setListening(false);
  }, []);

  // Listening never outlives the screen.
  useEffect(
    () => () => {
      try {
        speechModule()?.ExpoSpeechRecognitionModule.abort();
      } catch {
        // Nothing was listening.
      }
    },
    [],
  );

  return { listening, level, problem, clearProblem: () => setProblem(null), start, stop, cancel };
}
