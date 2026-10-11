import { RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ResetScope = "Thread" | "Workspace" | "Global";

export interface ResetTokenFlowProps {
  onReset: (scope: ResetScope) => Promise<void>;
  onAnalytics?: (eventName: string, payload: Record<string, unknown>) => void;
}

export interface TokenUsagePanelProps extends ResetTokenFlowProps {
  tokensUsed: number;
  tokenBudget: number;
}

export function ResetTokenFlow({ onReset, onAnalytics }: ResetTokenFlowProps) {
  const [scope, setScope] = useState<ResetScope>("Thread");
  const [confirmation, setConfirmation] = useState("");
  const [undoVisible, setUndoVisible] = useState(false);
  const undoTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  async function commitReset(): Promise<void> {
    await onReset(scope);
    onAnalytics?.("token_usage_reset", { scope });
    setUndoVisible(true);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setUndoVisible(false), 10_000);
  }

  return (
    <div className="reset-token-flow" role="region" aria-label="Reset token usage">
      <label>
        <span className="field-label">Reset Scope</span>
        <select value={scope} onChange={(event) => setScope(event.target.value as ResetScope)}>
          <option>Thread</option>
          <option>Workspace</option>
          <option>Global</option>
        </select>
      </label>
      <label>
        <span className="field-label">Type RESET to confirm</span>
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      </label>
      <button className="danger-soft-btn" type="button" disabled={confirmation !== "RESET"} onClick={() => void commitReset()}>
        <RotateCcw size={14} />
        Reset {scope}
      </button>
      {undoVisible && (
        <div className="settings-undo-toast" role="status">
          Token usage reset. Undo is available for 10 seconds.
          <button type="button" onClick={() => setUndoVisible(false)}>
            <Undo2 size={14} />
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

export function TokenUsagePanel({ tokensUsed, tokenBudget, onReset, onAnalytics }: TokenUsagePanelProps) {
  const tokenPercent = Math.min(100, Math.round((tokensUsed / Math.max(1, tokenBudget)) * 100));
  return (
    <section className="settings-panel" role="region" aria-label="Usage">
      <div className="settings-panel-head">
        <div>
          <h2>Usage</h2>
          <span>{tokensUsed.toLocaleString()} of {tokenBudget.toLocaleString()} tokens used.</span>
        </div>
        <strong>{tokenPercent}%</strong>
      </div>
      <div className="settings-progress"><div style={{ width: `${tokenPercent}%` }} /></div>
      <ResetTokenFlow onReset={onReset} onAnalytics={onAnalytics} />
    </section>
  );
}
