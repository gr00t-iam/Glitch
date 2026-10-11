let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

function getActiveAudio(): HTMLAudioElement {
  if (!activeAudio) activeAudio = new Audio();
  return activeAudio;
}

/** Called synchronously from Submit/microphone gestures to unlock later playback. */
export function unlockPiperPlayback(): void {
  const audio = getActiveAudio();
  audio.muted = true;
  audio.src = SILENT_WAV;
  let playback: Promise<void> | void;
  try {
    playback = audio.play();
  } catch {
    audio.muted = false;
    return;
  }
  void Promise.resolve(playback).then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
  }).catch(() => {
    audio.muted = false;
  });
}

export function stopPiperSpeech(): void {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio.src = "";
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
}

/** Releases the shared player when the app or an isolated test is torn down. */
export function releasePiperPlayback(): void {
  stopPiperSpeech();
  activeAudio = null;
}

export async function speakWithPiper(text: string): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) return;
  await playPiperAudioPayload(await requestPiperAudioPayload(cleanText));
}

export interface PiperAudioPayload {
  audioBase64: string;
  mimeType: string;
  voice: string;
}

export interface CompletedChatPayload {
  text: string;
  audio_url: string;
  audio_base64: string;
  media_type: string;
}

export async function completeChatWithPiper(text: string): Promise<CompletedChatPayload> {
  const response = await fetch("/api/chat/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: text.trim() }),
  });
  if (!response.ok) throw new Error("Piper voice is unavailable.");
  const payload = await response.json() as Partial<CompletedChatPayload>;
  if (!payload.text || !payload.audio_url || !payload.audio_base64) throw new Error("The completed response is missing audio.");
  return payload as CompletedChatPayload;
}

export function piperBase64ToBlobUrl(base64: string, mimeType = "audio/wav"): string {
  const characters = atob(base64);
  const bytes = new Uint8Array(characters.length);
  for (let index = 0; index < characters.length; index += 1) bytes[index] = characters.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export async function playPiperAudioSource(src: string, onEnded?: () => void): Promise<void> {
  const audio = getActiveAudio();
  audio.muted = false;
  audio.src = src;
  audio.preload = "auto";
  audio.onended = () => onEnded?.();
  await audio.play();
}

export async function requestPiperAudioPayload(text: string): Promise<PiperAudioPayload> {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: text.trim() }),
  });
  if (!response.ok) throw new Error("Piper voice is unavailable.");
  const payload = await response.json() as { audio_base64?: string; media_type?: string; voice?: string };
  if (!payload.audio_base64) throw new Error("Piper returned no audio.");
  return {
    audioBase64: payload.audio_base64,
    mimeType: payload.media_type || "audio/wav",
    voice: payload.voice || "en_US-amy-medium",
  };
}

export async function playPiperAudioPayload(payload: PiperAudioPayload): Promise<void> {
  stopPiperSpeech();
  const url = piperBase64ToBlobUrl(payload.audioBase64, payload.mimeType);
  activeAudioUrl = url;
  await playPiperAudioSource(url);
}
