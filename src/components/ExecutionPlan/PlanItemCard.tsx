import { Check, Play, RotateCcw, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { planEventBus, type PlanItemStatus, type PlanLockPayload } from "../../services/planEventBus";

export interface PlanItemCardProps {
  id: string;
  title: string;
  assignedTo: string;
  status: PlanItemStatus;
  progress: number;
  eta?: string;
  steps: string[];
  lastUpdated: number;
  onClaim?: (id: string) => void;
  onRelease?: (id: string) => void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onRunNextStep?: (id: string) => void;
}

function relativeTime(value: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function PlanItemCard({ id, title, assignedTo, status, progress, eta, steps, lastUpdated, onClaim, onRelease, onApprove, onReject, onRunNextStep }: PlanItemCardProps) {
  const [liveStatus, setLiveStatus] = useState<PlanItemStatus>(status);
  const [liveProgress, setLiveProgress] = useState(progress);
  const [updatedAt, setUpdatedAt] = useState(lastUpdated);
  const [lock, setLock] = useState<PlanLockPayload | null>(null);

  useEffect(() => {
    return planEventBus.subscribe((event) => {
      if ("itemId" in event && event.itemId !== id) return;
      if (event.type === "plan:update") {
        if (event.status) setLiveStatus(event.status);
        if (typeof event.progress === "number") setLiveProgress(event.progress);
        setUpdatedAt(event.lastUpdated ?? Date.now());
      }
      if (event.type === "plan:lock" && event.lock.itemId === id) setLock(event.lock);
      if (event.type === "plan:unlock") setLock(null);
    });
  }, [id]);

  useEffect(() => {
    if (!lock) return;
    const delay = Math.max(0, lock.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      planEventBus.publish({ type: "plan:unlock", itemId: id });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [id, lock]);

  return (
    <article className={`plan-item-card ${liveStatus}`} role="region" aria-label={`Plan item ${title}`} aria-live="polite">
      <header>
        <div>
          <h3>{title}</h3>
          <span title={new Date(updatedAt).toLocaleString()}>Updated {relativeTime(updatedAt)}</span>
        </div>
        <span className={`plan-status ${liveStatus}`}>{liveStatus}</span>
      </header>
      <div className="plan-item-meta">
        <span>Assignee: {lock ? lock.lockedBy : assignedTo}</span>
        <span>ETA: {eta ?? "n/a"}</span>
      </div>
      {lock && <div className="plan-soft-lock">Locked by {lock.lockedBy} ({lock.reason}) until {new Date(lock.expiresAt).toLocaleTimeString()}</div>}
      <div className="plan-progress" aria-label={`${liveProgress}% complete`}>
        <div style={{ width: `${liveProgress}%` }} />
      </div>
      <ol className="plan-steps">
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <footer>
        <button type="button" onClick={() => onClaim?.(id)}><UserCheck size={13} /> Claim</button>
        <button type="button" onClick={() => onRelease?.(id)}><RotateCcw size={13} /> Release</button>
        <button type="button" onClick={() => onApprove?.(id)}><Check size={13} /> Approve</button>
        <button type="button" onClick={() => onReject?.(id)}><X size={13} /> Reject</button>
        <button type="button" onClick={() => onRunNextStep?.(id)}><Play size={13} /> Run Next Step</button>
      </footer>
    </article>
  );
}
