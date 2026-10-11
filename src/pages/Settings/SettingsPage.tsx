import { Download, KeyRound, PieChart } from "lucide-react";
import { useMemo, useState } from "react";
import type { LocalModelInfo, RuntimeLogEntry } from "../../components/AdminHub";
import { ApiKeysList } from "../../components/ApiKeys";
import type { ApiKeyRecord } from "../../components/ApiKeys";
import { ModelManager } from "../../components/ModelManager";
import { PullModelModal } from "../../components/PullModel";
import { TokenUsagePanel } from "../../components/Usage";
import type { ResetScope } from "../../components/Usage";

export type SettingsSection = "models" | "keys" | "usage";

export interface SettingsPageProps {
  activeModel: string;
  downloadedModels: LocalModelInfo[];
  tokenBudget: number;
  tokensUsed: number;
  providerKeys: Record<"openai" | "anthropic", string>;
  initialSection?: SettingsSection;
  onModelChange: (modelId: string) => Promise<void>;
  onModelRemove: (modelId: string) => void;
  onModelsRefresh: () => Promise<void>;
  onResetTokenUsage: (scope: ResetScope) => Promise<void>;
  onProviderKeySave: (provider: "openai" | "anthropic", value: string) => void;
  onRuntimeLog: (source: RuntimeLogEntry["source"], message: string) => void;
}

const sections: Array<{ id: SettingsSection; label: string; Icon: typeof Download }> = [
  { id: "models", label: "Model Manager", Icon: Download },
  { id: "keys", label: "API Keys", Icon: KeyRound },
  { id: "usage", label: "Usage", Icon: PieChart },
];


export function SettingsPage({
  activeModel,
  downloadedModels,
  tokenBudget,
  tokensUsed,
  providerKeys,
  initialSection = "models",
  onModelChange,
  onModelRemove,
  onModelsRefresh,
  onResetTokenUsage,
  onProviderKeySave,
  onRuntimeLog,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [pullOpen, setPullOpen] = useState(false);

  const apiKeys = useMemo<ApiKeyRecord[]>(
    () => [
      { id: "openai", provider: "OpenAI", value: providerKeys.openai, lastUsed: localStorage.getItem("NEXUS_OPENAI_LAST_USED") ?? undefined, auditHref: "#settings-audit" },
      { id: "anthropic", provider: "Anthropic", value: providerKeys.anthropic, lastUsed: localStorage.getItem("NEXUS_ANTHROPIC_LAST_USED") ?? undefined, auditHref: "#settings-audit" },
    ],
    [providerKeys],
  );

  return (
    <div className="settings-page" role="region" aria-label="Settings">
      <aside className="settings-section-list" aria-label="Settings categories">
        {sections.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)}>
            <Icon size={16} />
            {label}
          </button>
        ))}
      </aside>

      <main className="settings-detail-panel" role="region" aria-label={`${activeSection} settings`}>
        {activeSection === "models" && (
          <>
            <div className="settings-panel-toolbar">
              <button className="primary-btn" type="button" onClick={() => setPullOpen(true)}>
                <Download size={15} />
                Pull Model
              </button>
            </div>
            <ModelManager
              activeModel={activeModel}
              models={downloadedModels}
              onBake={(modelId) => onRuntimeLog("model", `Bake requested for ${modelId}.`)}
              onLog={(message) => onRuntimeLog("model", message)}
              onRefresh={onModelsRefresh}
              onRemove={onModelRemove}
              onSelect={onModelChange}
            />
          </>
        )}

        {activeSection === "keys" && (
          <ApiKeysList
            keys={apiKeys}
            onAudit={(message) => onRuntimeLog("app", message)}
            onRevoke={(keyId) => onProviderKeySave(keyId as "openai" | "anthropic", "")}
            onSaveKey={(provider, value) => onProviderKeySave(provider.toLowerCase() as "openai" | "anthropic", value)}
          />
        )}

        {activeSection === "usage" && (
          <>
            <TokenUsagePanel
              tokenBudget={tokenBudget}
              tokensUsed={tokensUsed}
              onAnalytics={(eventName, payload) => onRuntimeLog("app", `${eventName}: ${JSON.stringify(payload)}`)}
              onReset={onResetTokenUsage}
            />
          </>
        )}
      </main>

      <PullModelModal
        open={pullOpen}
        onClose={() => setPullOpen(false)}
        onLog={(message) => onRuntimeLog("model", message)}
        onPulled={async () => {
          await onModelsRefresh();
          setPullOpen(false);
        }}
      />
    </div>
  );
}
