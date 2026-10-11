import { useEffect, useRef, useState } from "react";
import { BookOpen, FileSpreadsheet, FileText, Image, Mic, Plug, Plus, Sparkles, Telescope } from "lucide-react";
import { Popover } from "./Popover";
import { stopPiperSpeech, unlockPiperPlayback } from "../services/PiperSpeech";

/* ------------------------------------------------------------------ */
/*  Microphone dictation button (lives inside the input bar)          */
/* ------------------------------------------------------------------ */

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechResultAlt {
  transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly 0: SpeechResultAlt;
}
interface SpeechEvent extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResult };
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onresult: ((event: SpeechEvent) => void) | null;
  start: () => void;
  stop: () => void;
}
interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getRecognition(): SpeechRecognitionConstructor | undefined {
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

interface MicButtonProps {
  onAutoSubmit?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onStatus?: (message: string) => void;
  onTranscript: (text: string) => void;
  stopSignal?: number;
  startSignal?: number;
}

export function MicButton({ onAutoSubmit, onInterimTranscript, onListeningChange, onStatus, onTranscript, startSignal = 0, stopSignal = 0 }: MicButtonProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const listeningRequestedRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const finalTranscriptRef = useRef("");
  const initialStopSignalRef = useRef(stopSignal);
  const initialStartSignalRef = useRef(startSignal);
  const [listening, setListening] = useState(false);
  const supported = getRecognition() !== undefined;

  useEffect(() => {
    return () => {
      listeningRequestedRef.current = false;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
      recognitionRef.current?.stop();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      void audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (stopSignal === initialStopSignalRef.current) return;
    initialStopSignalRef.current = stopSignal;
    stopListening();
  }, [stopSignal]);

  useEffect(() => {
    if (startSignal === initialStartSignalRef.current) return;
    initialStartSignalRef.current = startSignal;
    if (!listeningRequestedRef.current) void startListening();
  }, [startSignal]);

  function updateListening(next: boolean): void {
    setListening(next);
    onListeningChange?.(next);
  }

  function stopListening(clearTranscript = true): void {
    listeningRequestedRef.current = false;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.suspend();
    if (clearTranscript) finalTranscriptRef.current = "";
    onInterimTranscript?.("");
    updateListening(false);
  }

  async function resumeAudioCapture(): Promise<void> {
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (navigator.mediaDevices?.getUserMedia && !audioStreamRef.current) {
      audioStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (!AudioContextConstructor) return;
    const context = audioContextRef.current ?? new AudioContextConstructor();
    audioContextRef.current = context;
    if (context.state !== "running") await context.resume();
    if (audioStreamRef.current) context.createMediaStreamSource(audioStreamRef.current);
  }

  function scheduleAutoSubmit(): void {
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      const transcript = finalTranscriptRef.current.trim();
      if (!transcript || !listeningRequestedRef.current) return;
      // Stop before sending so synthesized replies cannot feed back into capture.
      stopListening(false);
      finalTranscriptRef.current = "";
      onAutoSubmit?.(transcript);
    }, 1500);
  }

  function startRecognition(): void {
    const Recognition = getRecognition();
    if (!Recognition || !listeningRequestedRef.current) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      if (silenceTimerRef.current !== null) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      const transcript = finalText.trim();
      if (transcript) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim();
        onTranscript(finalTranscriptRef.current);
        scheduleAutoSubmit();
      }
      // Feed the complete working sentence into the composer on every result.
      onInterimTranscript?.(`${finalTranscriptRef.current} ${interimText}`.trim());
    };
    recognition.onerror = (event) => {
      const error = "error" in event ? String((event as Event & { error?: string }).error ?? "") : "";
      if (error === "not-allowed" || error === "service-not-allowed" || error === "audio-capture") {
        stopListening();
        onStatus?.("Voice input stopped. Check the browser microphone permission and audio device.");
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!listeningRequestedRef.current) return;
      // Browsers may end a continuous recognition segment after a pause. Restart
      // while the user-visible toggle remains active so dictation is persistent.
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        startRecognition();
      }, 150);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      stopListening();
      onStatus?.("Voice input could not start. Check the browser microphone permission.");
    }
  }

  async function startListening(): Promise<void> {
    if (!supported || listeningRequestedRef.current) return;
    stopPiperSpeech();
    unlockPiperPlayback();
    listeningRequestedRef.current = true;
    finalTranscriptRef.current = "";
    updateListening(true);
    try {
      await resumeAudioCapture();
      if (!listeningRequestedRef.current) return;
      startRecognition();
      onStatus?.("Continuous dictation is active. Pause for 1.5 seconds to send.");
    } catch {
      stopListening();
      onStatus?.("Voice input could not start. Check the browser microphone permission and audio device.");
    }
  }

  function toggle(): void {
    if (!supported) {
      onStatus?.("Voice input is not available in this browser.");
      return;
    }
    if (listeningRequestedRef.current) {
      stopListening();
      onStatus?.("Dictation stopped.");
      return;
    }
    void startListening();
  }

  return (
    <button
      type="button"
      className={`composer-mic ${listening ? "listening" : ""}`}
      onClick={toggle}
      title={supported ? (listening ? "Stop dictation" : "Dictate with your voice") : "Voice not supported"}
      aria-label={listening ? "Stop voice dictation" : "Start voice dictation"}
      aria-pressed={listening}
      data-listening={listening || undefined}
    >
      <Mic size={18} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  "+" attach / inject menu (left of the input bar)                  */
/* ------------------------------------------------------------------ */

export type FrameworkKey = "deep-research" | "guided-learning" | "personal-intelligence";

interface ComposerPlusMenuProps {
  onAttachFile: (file: File) => void;
  onOpenSkills: () => void;
  onApplyFramework: (framework: FrameworkKey) => void;
}

export function ComposerPlusMenu({ onAttachFile, onOpenSkills, onApplyFramework }: ComposerPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState("*/*");

  function pick(acceptTypes: string) {
    setAccept(acceptTypes);
    setOpen(false);
    // Let the accept attribute apply before opening the picker.
    window.setTimeout(() => fileRef.current?.click(), 0);
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onAttachFile(file);
        }}
      />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="left"
        direction="up"
        label="Attach or inject"
        trigger={
          <button type="button" className="composer-plus" onClick={() => setOpen((current) => !current)} aria-label="Attach or inject" title="Attach files, skills, or a framework">
            <Plus size={18} />
          </button>
        }
      >
        <div className="menu-card-head">
          <strong>Add to chat</strong>
        </div>
        <div className="menu-section-label">Attach a file</div>
        <div className="menu-list">
          <button className="menu-row" onClick={() => pick("image/*")}>
            <Image size={16} />
            <span className="menu-row-text"><strong>Photo or image</strong></span>
          </button>
          <button className="menu-row" onClick={() => pick("application/pdf,.pdf")}>
            <FileText size={16} />
            <span className="menu-row-text"><strong>PDF document</strong></span>
          </button>
          <button className="menu-row" onClick={() => pick(".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}>
            <FileSpreadsheet size={16} />
            <span className="menu-row-text"><strong>Spreadsheet</strong></span>
          </button>
        </div>
        <div className="menu-section-label">Connect</div>
        <div className="menu-list">
          <button
            className="menu-row"
            onClick={() => {
              setOpen(false);
              onOpenSkills();
            }}
          >
            <Plug size={16} />
            <span className="menu-row-text"><strong>Skills &amp; connectors</strong></span>
          </button>
        </div>
        <div className="menu-section-label">Frameworks</div>
        <div className="menu-list">
          <button className="menu-row" onClick={() => { setOpen(false); onApplyFramework("deep-research"); }}>
            <Telescope size={16} />
            <span className="menu-row-text"><strong>Deep Research</strong><small>Plan, gather sources, synthesize</small></span>
          </button>
          <button className="menu-row" onClick={() => { setOpen(false); onApplyFramework("guided-learning"); }}>
            <BookOpen size={16} />
            <span className="menu-row-text"><strong>Guided Learning</strong><small>Teach step-by-step with checks</small></span>
          </button>
          <button className="menu-row" onClick={() => { setOpen(false); onApplyFramework("personal-intelligence"); }}>
            <Sparkles size={16} />
            <span className="menu-row-text"><strong>Personal Intelligence</strong><small>Tailor to my context &amp; goals</small></span>
          </button>
        </div>
      </Popover>
    </>
  );
}

export const FRAMEWORK_SCAFFOLDS: Record<FrameworkKey, string> = {
  "deep-research":
    "Use a Deep Research framework: clarify the question, outline a research plan, gather and cite multiple sources, weigh evidence, and finish with a structured synthesis and open questions.\n\nResearch topic: ",
  "guided-learning":
    "Use a Guided Learning framework: assess what I already know, break the topic into a short curriculum, teach one step at a time with simple examples, and check my understanding before moving on.\n\nI want to learn: ",
  "personal-intelligence":
    "Use a Personal Intelligence framework: ask brief clarifying questions about my context, goals, and constraints, then give advice tailored specifically to me and remember it for the rest of our conversation.\n\nHelp me with: ",
};
