import { ReactNode } from "react";
import { Brain, RotateCcw, Globe2 } from "lucide-react";

export interface ContextActionBarProps {
  onRunBrowserTask: () => void;
  onSwitchBrain: () => void;
  onUndoAgentAction: () => void;
}

export function ContextActionBar({
  onRunBrowserTask,
  onSwitchBrain,
  onUndoAgentAction,
}: ContextActionBarProps) {
  return (
    <nav className="context-action-bar" aria-label="Workspace actions">
      <button type="button" onClick={onRunBrowserTask}>
        <Globe2 size={14} />
        Run Browser Task
      </button>
      <button type="button" onClick={onSwitchBrain}>
        <Brain size={14} />
        Switch Brain
      </button>
      <button type="button" onClick={onUndoAgentAction}>
        <RotateCcw size={14} />
        Undo Agent Action
      </button>
    </nav>
  );
}

export interface WorkspaceLayoutProps {
  sidebar: ReactNode;
  topBar: ReactNode;
  actionBar: ReactNode;
  workspace: ReactNode;
  terminal: ReactNode;
  rightPanel?: ReactNode;
}

export function WorkspaceLayout({ sidebar, topBar, actionBar, workspace, terminal, rightPanel }: WorkspaceLayoutProps) {
  return (
    <div className="workspace-layout">
      {sidebar}
      <main className="workspace-layout-main" role="main" aria-label="Primary workspace">
        {topBar}
        {actionBar}
        <section className="workspace-layout-canvas" role="region" aria-label="Agent workspace">
          {workspace}
        </section>
        {terminal}
      </main>
      {rightPanel}
    </div>
  );
}
