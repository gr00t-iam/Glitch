import { Play, RefreshCw } from "lucide-react";
import { ReactNode } from "react";
import { useRuntimeConnection } from "../../hooks/useRuntimeConnection";
import { ConnectionLog } from "./ConnectionLog";
import { StatusBadge } from "./StatusBadge";

export interface LiveBrowserPanelProps {
  children: ReactNode;
  startAutoConnectOnMount?: boolean;
}

export function LiveBrowserPanel({ children, startAutoConnectOnMount = true }: LiveBrowserPanelProps) {
  const { status, logs, connect, startRuntime } = useRuntimeConnection({ startAutoConnectOnMount });

  return (
    <section className="live-browser-panel" role="region" aria-label="Live Browser Session">
      <div className="live-browser-controls">
        <StatusBadge status={status} lastAttemptAt={logs.at(-1)?.at} onAction={() => void connect()} />
        <button type="button" onClick={() => void startRuntime()}><Play size={14} /> Start Runtime</button>
        <button type="button" onClick={() => void connect()}><RefreshCw size={14} /> Connect/Reconnect</button>
      </div>
      {children}
      <ConnectionLog logs={logs} />
    </section>
  );
}
