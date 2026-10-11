import { useEffect, useRef, useState } from "react";

export interface UndoToastState {
  id: string;
  message: string;
  expiresAt: number;
}

function createUndoId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useUndoToast(timeoutMs = 10_000) {
  const [toast, setToast] = useState<UndoToastState | null>(null);
  const timerRef = useRef<number | null>(null);
  const undoRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function clearUndo(): void {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    undoRef.current = null;
    setToast(null);
  }

  function showUndo(message: string, onUndo: () => void): void {
    clearUndo();
    undoRef.current = onUndo;
    setToast({ id: createUndoId(), message, expiresAt: Date.now() + timeoutMs });
    timerRef.current = window.setTimeout(clearUndo, timeoutMs);
  }

  function undo(): void {
    undoRef.current?.();
    clearUndo();
  }

  return { toast, showUndo, clearUndo, undo };
}
