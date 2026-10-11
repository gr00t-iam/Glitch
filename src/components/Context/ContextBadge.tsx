import { useContextTracker } from "./ContextStore";

export interface ContextBadgeProps {
  compact?: boolean;
}

export default function ContextBadge({ compact = true }: ContextBadgeProps) {
  const { contextPercent, lastUpdated } = useContextTracker();
  return (
    <div className={`context-badge ${compact ? "compact" : ""}`} role="status" aria-live="polite" tabIndex={0} title={`Updated ${new Date(lastUpdated).toLocaleString()}`}>
      <span>Context</span>
      <div className="context-meter" aria-label={`${contextPercent}% context used`}>
        <i style={{ width: `${contextPercent}%` }} />
      </div>
      <strong>{contextPercent}%</strong>
    </div>
  );
}
