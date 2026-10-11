import { ReactNode, useEffect, useMemo, useState } from "react";
import { CollapsiblePanel } from "./CollapsiblePanel";

export interface SidebarPanelItem {
  id: string;
  title: string;
  content: ReactNode;
}

export interface SidebarProps {
  panels: SidebarPanelItem[];
  storageKey?: string;
}

interface SidebarState {
  order: string[];
  collapsed: Record<string, boolean>;
  pinned: Record<string, boolean>;
}

const defaultStorageKey = "NEXUS_SIDEBAR_GROUP_STATE";

function loadSidebarState(storageKey: string, panels: SidebarPanelItem[]): SidebarState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<SidebarState>;
    const knownIds = new Set(panels.map((panel) => panel.id));
    const order = [...(parsed.order ?? []).filter((id) => knownIds.has(id)), ...panels.map((panel) => panel.id).filter((id) => !(parsed.order ?? []).includes(id))];
    return { order, collapsed: parsed.collapsed ?? {}, pinned: parsed.pinned ?? {} };
  } catch {
    return { order: panels.map((panel) => panel.id), collapsed: {}, pinned: {} };
  }
}

export function Sidebar({ panels, storageKey = defaultStorageKey }: SidebarProps) {
  const [state, setState] = useState<SidebarState>(() => loadSidebarState(storageKey, panels));

  useEffect(() => {
    // Persisting order/collapse locally keeps the sidebar stable between PWA sessions.
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  const panelMap = useMemo(() => new Map(panels.map((panel) => [panel.id, panel])), [panels]);
  const orderedPanels = state.order.map((id) => panelMap.get(id)).filter((panel): panel is SidebarPanelItem => Boolean(panel));

  function toggleCollapsed(id: string): void {
    setState((current) => ({ ...current, collapsed: { ...current.collapsed, [id]: !current.collapsed[id] } }));
  }

  function togglePinned(id: string): void {
    setState((current) => ({ ...current, pinned: { ...current.pinned, [id]: !current.pinned[id] } }));
  }

  function movePanel(id: string, direction: -1 | 1): void {
    setState((current) => {
      const order = [...current.order];
      const index = order.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return current;
      [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
      return { ...current, order };
    });
  }

  return (
    <div className="grouped-sidebar" role="region" aria-label="Workspace sidebar">
      {orderedPanels.map((panel) => (
        <CollapsiblePanel
          key={panel.id}
          id={panel.id}
          title={panel.title}
          collapsed={state.collapsed[panel.id]}
          pinned={state.pinned[panel.id]}
          onMove={movePanel}
          onToggleCollapsed={toggleCollapsed}
          onTogglePinned={togglePinned}
        >
          {panel.content}
        </CollapsiblePanel>
      ))}
    </div>
  );
}

export * from "./CollapsiblePanel";
