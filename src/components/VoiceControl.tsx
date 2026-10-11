import { useEffect, useRef, useState } from "react";
import { speakWithPiper, stopPiperSpeech } from "../services/PiperSpeech";
import { Mic, MicOff, Radio, Volume2 } from "lucide-react";

export interface VoiceControlProps {
  disabled?: boolean;
  onTranscript: (text: string, source: "push-to-talk" | "wake-word") => void;
  onVoiceStatus?: (message: string) => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionResultAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: SpeechRecognitionResultAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

const wakeWord = "nexus";

export function VoiceControl({ disabled = false, onTranscript, onVoiceStatus }: VoiceControlProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeModeRef = useRef(false);
  const wakeEnabledRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [wakeMode, setWakeMode] = useState(false);
  const [status, setStatus] = useState("Push to talk");
  const supported = getSpeechRecognitionConstructor() !== undefined;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  function speak(message: string): void {
    onVoiceStatus?.(message);
    setStatus(message);
    stopPiperSpeech();
    void speakWithPiper(message).catch(() => setStatus("Piper voice is unavailable right now."));
  }

  function startListening(mode: "push-to-talk" | "wake-word"): void {
    if (!supported || disabled) {
      speak("Voice control is not available in this browser.");
      return;
    }

    recognitionRef.current?.stop();
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) return;

    wakeModeRef.current = mode === "wake-word";
    const recognition = new Recognition();
    recognition.continuous = mode === "wake-word";
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => handleResult(event, mode);
    recognition.onerror = (event) => {
      const reason = event.error ? `Voice input stopped: ${event.error}` : "Voice input stopped.";
      speak(reason);
      setIsListening(false);
      setWakeMode(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      if (wakeModeRef.current && wakeEnabledRef.current) {
        window.setTimeout(() => startListening("wake-word"), 250);
      } else if (!wakeModeRef.current) {
        setStatus("Push to talk");
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    setStatus(mode === "wake-word" ? `Listening for "${wakeWord}"` : "Listening...");
  }

  function stopListening(): void {
    wakeModeRef.current = false;
    wakeEnabledRef.current = false;
    recognitionRef.current?.stop();
    setWakeMode(false);
    setIsListening(false);
    speak("Voice control paused.");
  }

  function handleResult(event: SpeechRecognitionEventLike, mode: "push-to-talk" | "wake-word"): void {
    let text = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) text += result[0].transcript;
    }
    const transcript = text.trim();
    if (!transcript) return;

    if (mode === "wake-word") {
      const lower = transcript.toLowerCase();
      const wakeIndex = lower.indexOf(wakeWord);
      if (wakeIndex === -1) return;
      const command = transcript.slice(wakeIndex + wakeWord.length).trim();
      if (!command) {
        speak("I'm listening.");
        return;
      }
      onTranscript(command, "wake-word");
      speak("Got it. I added that request.");
      return;
    }

    onTranscript(transcript, "push-to-talk");
    speak("Got it. I added that request.");
  }

  function toggleWakeMode(nextWakeMode: boolean): void {
    setWakeMode(nextWakeMode);
    wakeEnabledRef.current = nextWakeMode;
    if (nextWakeMode) {
      startListening("wake-word");
    } else {
      stopListening();
    }
  }

  return (
    <section className={`panel voice-panel ${isListening ? "listening" : ""}`}>
      <div className="panel-title-row">
        <div>
          <h2>Voice Control</h2>
          <span>{supported ? status : "Voice input is not available in this browser."}</span>
        </div>
        <Volume2 size={16} />
      </div>

      <div className="voice-actions">
        <button disabled={!supported || disabled || isListening} onClick={() => startListening("push-to-talk")}>
          <Mic size={15} />
          Push to Talk
        </button>
        <button disabled={!supported || disabled || !isListening} onClick={stopListening}>
          <MicOff size={15} />
          Stop
        </button>
      </div>

      <label className="wake-word-toggle">
        <input
          checked={wakeMode}
          disabled={!supported || disabled}
          onChange={(event) => toggleWakeMode(event.target.checked)}
          type="checkbox"
        />
        <span>
          <Radio size={15} />
          Optional wake word: “Nexus”
        </span>
      </label>
    </section>
  );
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}
