import { useCallback, useEffect, useRef, useState } from 'react';

/** The slice of the Web Speech API used here (TypeScript's DOM types do not ship it). */
interface SpeechResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResult };
}
interface SpeechErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationError = 'denied' | 'noSpeech' | 'failed';

interface Options {
  /** BCP 47 tag, e.g. es-ES. */
  lang: string;
  /** The text as it was when dictation started. */
  getBase: () => string;
  /** Called with the base plus everything heard so far (interim words included). */
  onText: (text: string) => void;
}

/**
 * Browser dictation through the Web Speech API. Words land in the textarea as
 * they are heard (interim ones get replaced by the final version); `supported`
 * is false where the browser has no recognizer, and the button hides.
 */
export function useDictation({ lang, getBase, onText }: Options) {
  const [supported] = useState(() => recognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const handlers = useRef({ getBase, onText });
  useEffect(() => {
    handlers.current = { getBase, onText };
  }, [getBase, onText]);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  /** Stops at once and drops words not delivered yet (the message was sent, or the student typed). */
  const cancel = useCallback(() => {
    const rec = recognition.current;
    if (!rec) return;
    rec.onresult = null;
    rec.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    const base = handlers.current.getBase();
    const prefix = base && !/\s$/.test(base) ? `${base} ` : base;
    let heard = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) heard += ` ${result[0].transcript}`;
        else interim += ` ${result[0].transcript}`;
      }
      const spoken = `${heard} ${interim}`.replace(/\s+/g, ' ').trim();
      handlers.current.onText(spoken ? `${prefix}${spoken}` : base);
    };
    rec.onerror = (e) => {
      if (e.error === 'aborted') return;
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'noSpeech' : 'failed');
    };
    rec.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    try {
      rec.start();
      recognition.current = rec;
      setError(null);
      setListening(true);
    } catch {
      setError('failed');
    }
  }, [lang]);

  const toggle = useCallback(() => (recognition.current ? stop() : start()), [start, stop]);

  // An error shows for a few seconds, then the hint line goes back to normal.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  // Leaving the page stops the microphone.
  useEffect(
    () => () => {
      const rec = recognition.current;
      if (!rec) return;
      rec.onend = null;
      rec.abort();
    },
    [],
  );

  return { supported, listening, error, start, stop, cancel, toggle };
}
