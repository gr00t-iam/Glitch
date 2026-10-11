import { Terminal as TerminalIcon } from "lucide-react";
import type { RuntimeLogEntry } from "../AdminHub";

export type TerminalDockMode = "bottom" | "floating";

export interface TerminalDockProps {
  open: boolean;
  mode: TerminalDockMode;
  logs: RuntimeLogEntry[];
  onToggleOpen: () => void;
  onModeChange: (mode: TerminalDockMode) => void;
}

export function TerminalDock({ open, mode, logs, onToggleOpen, onModeChange }: TerminalDockProps) {
  return (
    /* Region label gives assistive tech a stable landmark for docked and floating modes. */
    <section className={`terminal-dock ${open ? "open" : ""} ${mode}`} role="region" aria-label="Runtime terminal">
      <div className="terminal-dock-header">
        <button className="terminal-toggle" type="button" onClick={onToggleOpen}>
          <TerminalIcon size={15} />
          Runtime Terminal
          <span>{logs.length}</span>
        </button>
        <button type="button" onClick={() => onModeChange(mode === "bottom" ? "floating" : "bottom")}>
          {mode === "bottom" ? "Undock" : "Dock bottom"}
        </button>
      </div>
      {open && (
        <div className="terminal-console" role="log" aria-live="polite">
          {logs.length === 0 ? (
            <code>$ waiting for runtime output...</code>
          ) : (
            logs.slice(-80).map((log) => (
              <code key={log.id}>
                <span>{new Date(log.at).toLocaleTimeString()}</span> [{log.source}] {log.message}
              </code>
            ))
          )}
        </div>
      )}
    </section>
  );
}
