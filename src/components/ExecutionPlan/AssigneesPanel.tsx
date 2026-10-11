import { RotateCcw, UserRound } from "lucide-react";
import { useState } from "react";
import { planEventBus } from "../../services/planEventBus";

export interface Assignee {
  id: string;
  name: string;
  reason: "policy" | "user" | "auto";
}

export interface AssigneesPanelProps {
  itemId: string;
  assignees: Assignee[];
  activeAssignee: string;
  onReassign: (assigneeId: string) => void;
}

export function AssigneesPanel({ itemId, assignees, activeAssignee, onReassign }: AssigneesPanelProps) {
  const [undoAssignee, setUndoAssignee] = useState<string | null>(null);

  function reassign(nextId: string): void {
    setUndoAssignee(activeAssignee);
    onReassign(nextId);
    const next = assignees.find((assignee) => assignee.id === nextId);
    planEventBus.publish({
      type: "plan:lock",
      lock: { itemId, lockedBy: next?.name ?? nextId, expiresAt: Date.now() + 30_000, reason: next?.reason ?? "user" },
    });
  }

  return (
    <section className="assignees-panel" role="region" aria-label="Assignees and context">
      <header>Assignees and Context</header>
      {assignees.map((assignee) => (
        <button key={assignee.id} type="button" className={assignee.id === activeAssignee ? "active" : ""} onClick={() => reassign(assignee.id)}>
          <span className="assignee-avatar"><UserRound size={13} /></span>
          <span>{assignee.name}</span>
          <small>{assignee.reason}</small>
        </button>
      ))}
      {undoAssignee && (
        <button type="button" onClick={() => { onReassign(undoAssignee); setUndoAssignee(null); }}>
          <RotateCcw size={13} /> Undo reassignment
        </button>
      )}
    </section>
  );
}
