import { RefreshCw } from "lucide-react";
import type { CdpConnectionStatus } from "../CdpCanvas";
import { StatusBadge } from "../Status/StatusBadge";

export interface BrowserStatusProps {
  status: CdpConnectionStatus;
  onReconnect?: () => void;
}

export function BrowserStatus({ status, onReconnect }: BrowserStatusProps) {
  const connected = status === "attached";
  return (
    /* aria-live makes connection drops/reconnects audible without stealing focus. */
    <span aria-live="polite" className="browser-status-wrap">
      <StatusBadge
        tone={connected ? "success" : status === "error" ? "danger" : "warning"}
        label={connected ? "Browser connected" : "Browser not connected"}
        tooltip={
          connected
            ? "The live browser session is attached and ready."
            : "Start or reconnect the local browser bridge, then use Reconnect."
        }
      />
      {!connected && onReconnect && (
        <button className="browser-reconnect-button" type="button" onClick={onReconnect}>
          <RefreshCw size={13} />
          Reconnect
        </button>
      )}
    </span>
  );
}
