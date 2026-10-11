import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export interface ContextualTipsProps {
  featureId: string;
  children: ReactNode;
  title?: string;
  maxImpressions?: number;
}

export function ContextualTips({ featureId, children, title, maxImpressions = 3 }: ContextualTipsProps) {
  const storageKey = `NEXUS_TIP_IMPRESSIONS:${featureId}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const count = Number(localStorage.getItem(storageKey) ?? "0");
    if (count >= maxImpressions) return;
    localStorage.setItem(storageKey, String(count + 1));
    setVisible(true);
  }, [maxImpressions, storageKey]);

  if (!visible) return null;
  return (
    <aside className="contextual-tip" role="note" aria-label="Contextual tip">
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
      <button type="button" onClick={() => setVisible(false)} aria-label="Dismiss tip">
        Got it
      </button>
    </aside>
  );
}
