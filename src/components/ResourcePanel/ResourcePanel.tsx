import { ContextBadge } from "../Context";
import { TokenVelocity } from "../TokenVelocity";

export interface ResourcePanelProps {
  tokenVelocity: number;
  tokensUsed: number;
  tokenPercent: number;
}

export function ResourcePanel({ tokenVelocity, tokensUsed, tokenPercent }: ResourcePanelProps) {
  return (
    <section className="resource-panel" role="region" aria-label="Context, token velocity, and cost tracker">
      <ContextBadge />
      <TokenVelocity rate={tokenVelocity} />
      <div className="leftnav-cost-card cost-tracker-focus" role="region" aria-label="Cost Tracker" tabIndex={0}>
        <span>{tokensUsed.toLocaleString()} used</span>
        <strong>{tokenPercent}%</strong>
        <div className="token-meter compact"><div style={{ width: `${tokenPercent}%` }} /></div>
      </div>
    </section>
  );
}
