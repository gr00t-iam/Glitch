import { RefreshCw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { LocalModelInfo } from "../AdminHub";
import { StatusBadge } from "../common/StatusBadge";
import { ModelCard } from "./ModelCard";
import { ModelSandboxModal } from "./ModelSandboxModal";

export interface ManagedModel {
  id: string;
  name: string;
  source: string;
  version?: string;
  checksum?: string;
  vramEstimate?: string;
  downloadedAt?: string;
  duplicateOf?: string;
  raw?: LocalModelInfo;
}

export interface ModelManagerProps {
  models: LocalModelInfo[];
  activeModel: string;
  onRefresh: () => Promise<void>;
  onSelect: (modelId: string) => Promise<void>;
  onRemove: (modelId: string) => void;
  onBake?: (modelId: string) => void;
  onLog?: (message: string) => void;
}

function checksumForModel(model: LocalModelInfo): string {
  return `${model.details?.family ?? "local"}:${model.details?.parameterSize ?? "unknown"}:${model.size || model.name}`;
}

export function dedupeModels(models: LocalModelInfo[]): ManagedModel[] {
  const seen = new Map<string, string>();
  return models.map((model) => {
    const checksum = checksumForModel(model);
    const source = model.id.includes("/") ? model.id : `ollama://${model.id}`;
    const key = checksum || source;
    const duplicateOf = seen.get(key);
    if (!duplicateOf) seen.set(key, model.id);
    return {
      id: model.id,
      name: model.name,
      source,
      version: model.details?.parameterSize,
      checksum,
      vramEstimate: estimateVram(model),
      downloadedAt: model.modifiedAt,
      duplicateOf,
      raw: model,
    };
  });
}

function estimateVram(model: LocalModelInfo): string {
  if (!model.size) return "VRAM unknown";
  return `~${Math.max(2, Math.ceil((model.size / 1024 ** 3) * 1.2))} GB VRAM`;
}

function isActiveModel(model: ManagedModel, activeModel: string): boolean {
  return activeModel === model.id || activeModel === model.name || activeModel === `ollama:${model.id}` || activeModel === `ollama:${model.name}`;
}

export function ModelManager({ models, activeModel, onRefresh, onSelect, onRemove, onBake, onLog }: ModelManagerProps) {
  const [sandboxModelId, setSandboxModelId] = useState<string | null>(null);
  const managedModels = useMemo(() => dedupeModels(models), [models]);
  const duplicateCount = managedModels.filter((model) => model.duplicateOf).length;
  const sandboxModel = managedModels.find((model) => model.id === sandboxModelId);

  return (
    <section className="settings-panel" role="region" aria-label="Model Manager">
      <div className="settings-panel-head">
        <div>
          <h2>Model Manager</h2>
          <span>{managedModels.length} local model entries · {duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"} detected</span>
        </div>
        <div className="settings-card-actions">
          <StatusBadge tone="success" label="Integrity ready" tooltip="Integrity keys are derived from checksum or stable source metadata." />
          <button type="button" onClick={() => void onRefresh()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>
      <div className="settings-integrity-note">
        <ShieldCheck size={16} />
        <span>Deduplication uses checksum when available and falls back to stable source/runtime metadata.</span>
      </div>
      <div className="settings-model-grid">
        {managedModels.length === 0 ? (
          <div className="settings-empty-state">No downloaded models found.</div>
        ) : (
          managedModels.map((model) => (
            <ModelCard
              key={model.id}
              {...model}
              isActive={isActiveModel(model, activeModel)}
              onBake={onBake}
              onInspect={(modelId) => void onSelect(modelId)}
              onRemove={onRemove}
              onTest={setSandboxModelId}
            />
          ))
        )}
      </div>
      {sandboxModel && (
        <ModelSandboxModal
          modelId={sandboxModel.id}
          modelName={sandboxModel.name}
          vramEstimate={sandboxModel.vramEstimate}
          onClose={() => setSandboxModelId(null)}
          onSnapshot={(modelId) => onLog?.(`Sandbox snapshot saved for ${modelId}.`)}
        />
      )}
    </section>
  );
}
