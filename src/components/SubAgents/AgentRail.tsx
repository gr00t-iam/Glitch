import { Bot, Pause, Pin, PinOff, Play, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { FixedSizeList as List } from "react-window";
import type { RuntimeLogEntry, SubAgentProfile } from "../AdminHub";

export interface AgentRailProps {
  agents: SubAgentProfile[];
  logs: RuntimeLogEntry[];
  collapsed?: boolean;
  onPause: (agentId: string) => void;
  onResume: (agentId: string) => void;
  onContextLimitChange: (agentId: string, contextLimit: number) => void;
}

const storageKey = "NEXUS_PINNED_SUB_AGENTS";

function loadPinned(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function statusClass(status: SubAgentProfile["status"]): string {
  if (status === "Running" || status === "Active") return "running";
  if (status === "Downloading") return "pending";
  return "idle";
}

export function AgentRail({ agents, logs, collapsed = false, onPause, onResume, onContextLimitChange }: AgentRailProps) {
  const [expandedAgentId, setExpandedAgentId] = useState(agents[0]?.id ?? "");
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinned());
  const orderedAgents = useMemo(
    () => agents.slice().sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || a.name.localeCompare(b.name)),
    [agents, pinned],
  );
  const visibleCollapsed = orderedAgents.slice(0, 5);
  const expandedAgent = orderedAgents.find((agent) => agent.id === expandedAgentId) ?? orderedAgents[0];

  function togglePinned(agentId: string): void {
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  if (collapsed) {
    return (
      <section className="agent-rail collapsed" role="region" aria-label="Sub-Agent Rail">
        {visibleCollapsed.map((agent) => (
          <button key={agent.id} type="button" title={`${agent.name}: ${agent.status}`} onClick={() => setExpandedAgentId(agent.id)}>
            <Bot size={16} />
            <span className={`agent-status-dot ${statusClass(agent.status)}`} />
          </button>
        ))}
        {orderedAgents.length > visibleCollapsed.length && <span className="agent-more">+{orderedAgents.length - visibleCollapsed.length}</span>}
      </section>
    );
  }

  const rowRenderer = ({ index, style }: { index: number; style: CSSProperties }) => {
    const agent = orderedAgents[index];
    return (
      <div style={style}>
        <button className={agent.id === expandedAgent?.id ? "active" : ""} type="button" onClick={() => setExpandedAgentId(agent.id)}>
          <Bot size={15} />
          <span>{agent.name.replace(" Agent", "")}</span>
          <i className={`agent-status-dot ${statusClass(agent.status)}`} />
        </button>
      </div>
    );
  };

  return (
    <section className="agent-rail" role="region" aria-label="Sub-Agent Rail">
      <div className="agent-rail-list">
        {orderedAgents.length > 100 ? (
          <List height={220} itemCount={orderedAgents.length} itemSize={38}>{rowRenderer}</List>
        ) : (
          orderedAgents.map((_, index) => rowRenderer({ index, style: {} }))
        )}
      </div>
      {expandedAgent && (
        <article className="agent-card" role="region" aria-label={`${expandedAgent.name} details`}>
          <header>
            <div>
              <strong>{expandedAgent.name}</strong>
              <span>{expandedAgent.specialization}</span>
            </div>
            <button type="button" aria-label={pinned.has(expandedAgent.id) ? "Unpin agent" : "Pin agent"} onClick={() => togglePinned(expandedAgent.id)}>
              {pinned.has(expandedAgent.id) ? <Pin size={14} /> : <PinOff size={14} />}
            </button>
          </header>
          <p>{expandedAgent.currentTask}</p>
          <label className="agent-slider">
            <span><SlidersHorizontal size={13} /> Context {expandedAgent.contextLimit.toLocaleString()}</span>
            <input type="range" min={2048} max={32768} step={1024} value={expandedAgent.contextLimit} onChange={(event) => onContextLimitChange(expandedAgent.id, Number(event.target.value))} />
          </label>
          <div className="agent-actions">
            <button type="button" onClick={() => onResume(expandedAgent.id)}><Play size={13} /> Resume</button>
            <button type="button" onClick={() => onPause(expandedAgent.id)}><Pause size={13} /> Pause</button>
          </div>
          <div className="agent-log-preview" role="log" aria-live="polite">
            {logs.slice(-3).map((log) => <code key={`${expandedAgent.id}-${log.id}`}>{log.message}</code>)}
          </div>
        </article>
      )}
    </section>
  );
}
