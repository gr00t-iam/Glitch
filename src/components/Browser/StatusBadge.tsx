import { CheckCircle2, Loader2, PlayCircle, XCircle } from "lucide-react";
import type { ConnectionStatus } from "../../services/browserRuntime/runtimeClient";

export interface BrowserRuntimeStatusBadgeProps {
  status: ConnectionStatus;
  lastAttemptAt?: number;
  onAction?: () => void;
}

export function StatusBadge({ status, lastAttemptAt, onAction }: BrowserRuntimeStatusBadgeProps) {
  const connected = status === "connected";
  const busy = status === "connecting" || status === "starting";
  const Icon = connected ? CheckCircle2 : busy ? Loader2 : status === "dry-run" ? PlayCircle : XCircle;
  return (
    <button className={`browser-runtime-status ${status}`} type="button" onClick={onAction} title={lastAttemptAt ? `Last attempt ${new Date(lastAttemptAt).toLocaleTimeString()}` : undefined}>
      <Icon className={busy ? "spin" : undefined} size={14} />
      {status}
    </button>
  );
}
