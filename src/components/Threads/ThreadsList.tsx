import type { CSSProperties } from "react";
import { FixedSizeList as List } from "react-window";
import type { LocalModelInfo } from "../AdminHub";

export interface ThreadListItem {
  id: string;
  title: string;
  activeModel: string;
  createdAt?: number;
  updatedAt?: number;
  durationMs?: number;
  lastMessageSnippet?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface ThreadsListProps {
  sessions: ThreadListItem[];
  activeSessionId?: string;
  localModels: LocalModelInfo[];
  modelDisplayName: (modelId: string, localModels: LocalModelInfo[]) => string;
  onSelect: (sessionId: string) => void;
  onRename: (session: ThreadListItem) => void;
  onDelete: (sessionId: string) => void;
  onPin?: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;
}

const rowHeight = 70;

function relativeTime(value?: number): string {
  if (!value) return "never";
  const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatDuration(value?: number): string {
  if (!value) return "n/a";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

export function ThreadsList({ sessions, activeSessionId, localModels, modelDisplayName, onSelect, onRename, onDelete, onPin, onArchive }: ThreadsListProps) {
  const shouldVirtualize = sessions.length > 100;
  const rowRenderer = ({ index, style }: { index: number; style: CSSProperties }) => {
    const session = sessions[index];
    return (
      <div key={session.id} style={style}>
        <div
          className={`session-row ${session.id === activeSessionId ? "active" : ""}`}
          onClick={() => onSelect(session.id)}
          onDoubleClick={() => onRename(session)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSelect(session.id);
          }}
        >
          <div className="thread-row-main">
            <strong>{session.pinned ? "★ " : ""}{session.title}</strong>
            <span title={session.updatedAt ? new Date(session.updatedAt).toLocaleString() : undefined}>
              {relativeTime(session.updatedAt ?? session.createdAt)} · {formatDuration(session.durationMs)}
            </span>
            <small>{session.lastMessageSnippet ?? "No messages yet."}</small>
          </div>
          <span className="thread-model-badge">{modelDisplayName(session.activeModel, localModels)}</span>
          <div className="thread-row-actions">
            <button type="button" onClick={(event) => { event.stopPropagation(); onSelect(session.id); }}>Open</button>
            <button type="button" onClick={(event) => { event.stopPropagation(); onPin?.(session.id); }}>Pin</button>
            <button type="button" onClick={(event) => { event.stopPropagation(); onArchive?.(session.id); }}>Archive</button>
          </div>
          <button
            className="session-row-delete"
            aria-label={`Delete ${session.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(session.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`session-list${shouldVirtualize ? " virtualized-list" : ""}`}
      style={shouldVirtualize ? ({ "--virtual-list-height": "460px" } as CSSProperties & Record<string, string>) : undefined}
    >
      {shouldVirtualize ? (
        <List height={460} itemCount={sessions.length} itemSize={rowHeight}>{rowRenderer}</List>
      ) : (
        sessions.map((_, index) => rowRenderer({ index, style: {} }))
      )}
    </div>
  );
}
