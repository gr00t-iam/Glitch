import { useEffect, useRef, useState } from "react";
import { piperBase64ToBlobUrl, playPiperAudioSource, stopPiperSpeech } from "../../services/PiperSpeech";

export interface MessageAudioProps {
  audioBase64: string;
  mimeType?: string;
  onPlaybackEnd?: () => void;
}

export function MessageAudio({ audioBase64, mimeType = "audio/wav", onPlaybackEnd }: MessageAudioProps) {
  const [showFallback, setShowFallback] = useState(false);
  const [fallbackSrc, setFallbackSrc] = useState("");
  const onPlaybackEndRef = useRef(onPlaybackEnd);

  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
  }, [onPlaybackEnd]);

  useEffect(() => {
    setShowFallback(false);
    const blobUrl = piperBase64ToBlobUrl(audioBase64, mimeType);
    setFallbackSrc(blobUrl);
    void playPiperAudioSource(blobUrl, () => onPlaybackEndRef.current?.()).catch(() => setShowFallback(true));
    return () => {
      stopPiperSpeech();
      URL.revokeObjectURL(blobUrl);
    };
  }, [audioBase64, mimeType]);

  if (!showFallback) return null;
  return (
    <div className="message-audio-fallback" role="group" aria-label="Voice response playback">
      <span>Voice playback needs your permission.</span>
      <audio controls preload="metadata" src={fallbackSrc} onEnded={() => onPlaybackEndRef.current?.()}>
        Your browser cannot play this audio.
      </audio>
    </div>
  );
}
