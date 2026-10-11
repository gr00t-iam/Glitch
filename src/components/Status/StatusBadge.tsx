import type { ReactNode } from "react";

export type StatusBadgeTone = "success" | "warning" | "danger" | "neutral";

export interface StatusBadgeProps {
  label: string;
  tone: StatusBadgeTone;
  tooltip?: ReactNode;
}

export function StatusBadge({ label, tone, tooltip }: StatusBadgeProps) {
  return (
    <span className={`status-badge ${tone}`} tabIndex={0}>
      <i className="status-badge-dot" aria-hidden="true" />
      <span>{label}</span>
      {tooltip && (
        <span className="status-badge-tooltip" role="tooltip">
          {tooltip}
        </span>
      )}
    </span>
  );
}
