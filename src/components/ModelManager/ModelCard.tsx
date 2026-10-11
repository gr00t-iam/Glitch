import { Box, Check, FlaskConical, Hammer, Info, Trash2 } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "../common/StatusBadge";

export interface ModelCardProps {
  id: string;
  name: string;
  source: string;
  version?: string;
  checksum?: string;
  vramEstimate?: string;
  downloadedAt?: string;
  isActive?: boolean;
  duplicateOf?: string;
  onInspect?: (modelId: string) => void;
  onTest?: (modelId: string) => void;
  onBake?: (modelId: string) => void;
  onRemove?: (modelId: string) => void;
}

export function ModelCard({
  id,
  name,
  source,
  version,
  checksum,
  vramEstimate,
  downloadedAt,
  isActive = false,
  duplicateOf,
  onInspect,
  onTest,
  onBake,
  onRemove,
}: ModelCardProps) {
  const [armedRemove, setArmedRemove] = useState(false);
  const metadata = [version, vramEstimate, downloadedAt ? `downloaded ${new Date(downloadedAt).toLocaleDateString()}` : undefined].filter(Boolean).join(" · ");

  return (
    <article className={`settings-model-card ${isActive ? "active" : ""}`} role="region" aria-label={`${name} model`}>
      <div className="settings-model-card-head">
        <span className="settings-model-icon">
          <Box size={18} />
        </span>
        <div>
          <h3>{name}</h3>
          <span>{metadata || source}</span>
        </div>
        <StatusBadge
          tone={isActive ? "success" : duplicateOf ? "warning" : "neutral"}
          label={isActive ? "Active" : duplicateOf ? "Duplicate" : "Ready"}
          tooltip={duplicateOf ? `Deduplicated with ${duplicateOf}. Actions target this local entry.` : undefined}
        />
      </div>

      <dl className="settings-model-metadata">
        <div>
          <dt>Source</dt>
          <dd>{source}</dd>
        </div>
        <div>
          <dt>Checksum</dt>
          <dd>{checksum ?? "pending integrity check"}</dd>
        </div>
      </dl>

      <div className="settings-card-actions">
        <button type="button" onClick={() => onInspect?.(id)}>
          <Info size={14} />
          Inspect
        </button>
        <button type="button" onClick={() => onTest?.(id)}>
          <FlaskConical size={14} />
          Test
        </button>
        <button type="button" onClick={() => onBake?.(id)}>
          <Hammer size={14} />
          Bake
        </button>
        {armedRemove ? (
          <button
            className="danger-soft-btn"
            type="button"
            disabled={isActive}
            onBlur={() => window.setTimeout(() => setArmedRemove(false), 120)}
            onClick={() => {
              onRemove?.(id);
              setArmedRemove(false);
            }}
          >
            <Check size={14} />
            Confirm Remove
          </button>
        ) : (
          <button type="button" disabled={isActive} onClick={() => setArmedRemove(true)} aria-label={`Remove ${name}`}>
            <Trash2 size={14} />
            Remove
          </button>
        )}
      </div>
    </article>
  );
}
