import { Bot, Clock3, Search, Settings } from "lucide-react";
import type { RuntimeLogEntry } from "../AdminHub";

export interface ActivityLogListItem {
  id: string;
  source: RuntimeLogEntry["source"];
  message: string;
  at: number;
  count: number;
  status: "active" | "done" | "queued";
}

export interface ActivityLogListProps {
  logs: ActivityLogListItem[];
  sourceLabel: (source: RuntimeLogEntry["source"]) => string;
}

function iconForSource(source: RuntimeLogEntry["source"]) {
  if (source === "model") return <Bot size={15} />;
  if (source === "app") return <Settings size={15} />;
  if (source === "browser") return <Search size={15} />;
  return <Clock3 size={15} />;
}

export function ActivityLogList({ logs, sourceLabel }: ActivityLogListProps) {
  return (
    /* role="log" with polite live updates announces new agent activity without interrupting typing. */
    <div className="virtualized-list activity-log-list" role="log" aria-live="polite">
      {logs.slice(0, 120).map((log) => (
        <div className={`task-card activity-log-card task-card-${log.status}`} key={log.id}>
          <span className={`activity-log-icon ${log.source}`}>{iconForSource(log.source)}</span>
          <div className="task-card-copy">
            <strong>
              {sourceLabel(log.source)}: {log.message}
              {log.count > 1 && <span className="activity-count-badge">[{log.count}]</span>}
            </strong>
            <small>
              {new Date(log.at).toLocaleTimeString()} · {log.source}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}
