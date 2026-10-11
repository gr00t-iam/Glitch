import { Archive, Bot, ChevronDown, Clock3, Search, Settings, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { FixedSizeList as List } from "react-window";
import { useUndoToast } from "../../hooks/useUndoToast";
import type { RuntimeLogEntry } from "../AdminHub";

export type ActivitySeverity = "all" | "info" | "warning" | "error";
export type ActivityTimeRange = "all" | "15m" | "1h" | "24h";

export interface ActivityLogEntry extends RuntimeLogEntry {
  severity?: Exclude<ActivitySeverity, "all">;
  agentId?: string;
}

export interface ActivityLogPanelProps {
  entries: ActivityLogEntry[];
  onClear: (restored?: ActivityLogEntry[]) => void;
}

function sourceIcon(source: RuntimeLogEntry["source"]) {
  if (source === "model") return <Bot size={14} />;
  if (source === "app") return <Settings size={14} />;
  return <Clock3 size={14} />;
}

function severityFor(entry: ActivityLogEntry): Exclude<ActivitySeverity, "all"> {
  if (entry.severity) return entry.severity;
  if (/fail|error|blocked|denied/i.test(entry.message)) return "error";
  if (/warn|skipped|unavailable/i.test(entry.message)) return "warning";
  return "info";
}

function rangeCutoff(range: ActivityTimeRange): number {
  if (range === "15m") return Date.now() - 15 * 60_000;
  if (range === "1h") return Date.now() - 60 * 60_000;
  if (range === "24h") return Date.now() - 24 * 60 * 60_000;
  return 0;
}

function clusterKey(entry: ActivityLogEntry): string {
  return `${entry.source}:${entry.message.replace(/\[[^\]]+\]|\d+/g, "").slice(0, 40).toLowerCase()}`;
}

export function ActivityLogPanel({ entries, onClear }: ActivityLogPanelProps) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<ActivitySeverity>("all");
  const [agent, setAgent] = useState("all");
  const [timeRange, setTimeRange] = useState<ActivityTimeRange>("all");
  const [clearArmed, setClearArmed] = useState(false);
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(() => new Set());
  const { toast, showUndo, undo } = useUndoToast();

  const agentOptions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.agentId ?? entry.source))), [entries]);
  const filteredEntries = useMemo(() => {
    const cutoff = rangeCutoff(timeRange);
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (cutoff && entry.at < cutoff) return false;
      if (severity !== "all" && severityFor(entry) !== severity) return false;
      if (agent !== "all" && (entry.agentId ?? entry.source) !== agent) return false;
      if (normalized && !entry.message.toLowerCase().includes(normalized)) return false;
      return true;
    });
  }, [agent, entries, query, severity, timeRange]);

  const clusters = useMemo(() => {
    const map = new Map<string, ActivityLogEntry[]>();
    for (const entry of filteredEntries) {
      const key = clusterKey(entry);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return Array.from(map.entries()).map(([key, rows]) => ({ key, rows, latest: rows[rows.length - 1] }));
  }, [filteredEntries]);

  function clearVisible(): void {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    const removed = filteredEntries;
    onClear();
    showUndo("Activity log cleared.", () => onClear(removed));
    setClearArmed(false);
  }

  function archiveVisible(): void {
    const archived = JSON.parse(localStorage.getItem("NEXUS_ACTIVITY_LOG_ARCHIVE") ?? "[]") as ActivityLogEntry[];
    localStorage.setItem("NEXUS_ACTIVITY_LOG_ARCHIVE", JSON.stringify([...archived, ...filteredEntries]));
  }

  const rowRenderer = ({ index, style }: { index: number; style: CSSProperties }) => {
    const cluster = clusters[index];
    const collapsed = collapsedClusters.has(cluster.key);
    return (
      <div key={cluster.key} style={style}>
        <article className="activity-cluster">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsedClusters((current) => {
              const next = new Set(current);
              if (next.has(cluster.key)) next.delete(cluster.key);
              else next.add(cluster.key);
              return next;
            })}
          >
            <ChevronDown className={collapsed ? "" : "expanded"} size={14} />
            {sourceIcon(cluster.latest.source)}
            <span>{cluster.latest.message}</span>
            <strong>{cluster.rows.length}</strong>
          </button>
          {!collapsed && cluster.rows.slice(-3).map((entry) => (
            <div className={`activity-cluster-row ${severityFor(entry)}`} key={entry.id}>
              <span>{new Date(entry.at).toLocaleTimeString()}</span>
              <span>{entry.message}</span>
            </div>
          ))}
        </article>
      </div>
    );
  };

  return (
    <section className="activity-log-panel" role="region" aria-label="Activity Log">
      <div className="activity-log-controls">
        <label>
          <Search size={13} />
          <input aria-label="Search activity log" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search log..." />
        </label>
        <select aria-label="Severity filter" value={severity} onChange={(event) => setSeverity(event.target.value as ActivitySeverity)}>
          <option value="all">All severity</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
        <select aria-label="Agent filter" value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="all">All agents</option>
          {agentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select aria-label="Time range" value={timeRange} onChange={(event) => setTimeRange(event.target.value as ActivityTimeRange)}>
          <option value="all">All time</option>
          <option value="15m">15m</option>
          <option value="1h">1h</option>
          <option value="24h">24h</option>
        </select>
      </div>
      <div className="activity-log-actions">
        <button type="button" onClick={clearVisible}><Trash2 size={13} /> {clearArmed ? "Confirm clear" : "Clear"}</button>
        <button type="button" onClick={archiveVisible}><Archive size={13} /> Archive</button>
      </div>
      <div className="activity-log-results" role="log" aria-live="polite">
        {clusters.length > 100 ? (
          <List height={360} itemCount={clusters.length} itemSize={92}>{rowRenderer}</List>
        ) : (
          clusters.map((_, index) => rowRenderer({ index, style: {} }))
        )}
      </div>
      {toast && (
        <div className="leftnav-undo-toast" role="status">
          {toast.message}
          <button type="button" onClick={undo}><Undo2 size={13} /> Undo</button>
        </div>
      )}
    </section>
  );
}
