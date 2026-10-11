import { GripVertical, Pin, PinOff } from "lucide-react";
import { ReactNode } from "react";

export interface CollapsiblePanelProps {
  id: string;
  title: string;
  children: ReactNode;
  collapsed?: boolean;
  pinned?: boolean;
  onToggleCollapsed: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onMove?: (id: string, direction: -1 | 1) => void;
}

export function CollapsiblePanel({
  id,
  title,
  children,
  collapsed = false,
  pinned = false,
  onToggleCollapsed,
  onTogglePinned,
  onMove,
}: CollapsiblePanelProps) {
  return (
    <section className={`collapsible-panel ${collapsed ? "collapsed" : ""}`} role="region" aria-label={title}>
      <header className="collapsible-panel-header">
        {/* Drag handle is keyboard reachable through adjacent reorder buttons for accessibility. */}
        <span className="collapsible-drag-handle" aria-hidden="true">
          <GripVertical size={14} />
        </span>
        <button
          className="collapsible-title-button"
          type="button"
          aria-expanded={!collapsed}
          aria-controls={`${id}-panel-body`}
          onClick={() => onToggleCollapsed(id)}
        >
          {title}
        </button>
        {onMove && (
          <span className="collapsible-reorder-actions" aria-label={`Reorder ${title}`}>
            <button type="button" aria-label={`Move ${title} up`} onClick={() => onMove(id, -1)}>
              ↑
            </button>
            <button type="button" aria-label={`Move ${title} down`} onClick={() => onMove(id, 1)}>
              ↓
            </button>
          </span>
        )}
        <button
          className="collapsible-pin-button"
          type="button"
          aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
          aria-pressed={pinned}
          onClick={() => onTogglePinned(id)}
        >
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
      </header>
      <div id={`${id}-panel-body`} className="collapsible-panel-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

