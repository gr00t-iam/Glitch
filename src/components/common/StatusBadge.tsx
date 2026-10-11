import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import type { ReactNode } from "react";

export type StatusBadgeTone = "success" | "warning" | "danger" | "neutral" | "pending";

export interface StatusBadgeProps {
  label: string;
  tone?: StatusBadgeTone;
  tooltip?: ReactNode;
}

function iconForTone(tone: StatusBadgeTone) {
  if (tone === "success") return <CheckCircle2 size={13} />;
  if (tone === "danger") return <XCircle size={13} />;
  if (tone === "pending") return <Loader2 className="spin" size={13} />;
  return <Info size={13} />;
}

export function StatusBadge({ label, tone = "neutral", tooltip }: StatusBadgeProps) {
  return (
    <span className={`settings-status-badge ${tone}`} tabIndex={tooltip ? 0 : undefined}>
      {iconForTone(tone)}
      <span>{label}</span>
      {tooltip && (
        <span className="settings-status-tooltip" role="tooltip">
          {tooltip}
        </span>
      )}
    </span>
  );
}
