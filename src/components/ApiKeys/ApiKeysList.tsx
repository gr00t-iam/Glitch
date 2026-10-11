import { Copy, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge } from "../common/StatusBadge";

export interface ApiKeyRecord {
  id: string;
  provider: string;
  value: string;
  lastUsed?: string;
  auditHref?: string;
}

export interface ApiKeysListProps {
  keys: ApiKeyRecord[];
  onSaveKey?: (provider: string, value: string) => void;
  onRevoke?: (keyId: string) => void;
  onAudit?: (message: string) => void;
}

interface RotateKeyModalProps {
  keyRecord: ApiKeyRecord;
  onClose: () => void;
  onRotate: (nextValue: string, updateIntegrations: boolean) => void;
}

function maskKey(value: string): string {
  if (!value) return "not configured";
  if (value.length <= 10) return "••••••";
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

function RotateKeyModal({ keyRecord, onClose, onRotate }: RotateKeyModalProps) {
  const [nextValue, setNextValue] = useState("");
  const [updateIntegrations, setUpdateIntegrations] = useState(true);
  return (
    <div className="settings-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Rotate ${keyRecord.provider} key`}>
      <section className="settings-modal compact">
        <header>
          <div>
            <h2>Rotate Key</h2>
            <span>{keyRecord.provider}</span>
          </div>
          <button type="button" aria-label="Close rotate key" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <label>
          <span className="field-label">New API Key</span>
          <input value={nextValue} onChange={(event) => setNextValue(event.target.value)} type="password" />
        </label>
        <label className="settings-checkbox-row">
          <input checked={updateIntegrations} onChange={(event) => setUpdateIntegrations(event.target.checked)} type="checkbox" />
          Update connected integrations that use this provider.
        </label>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="button" disabled={!nextValue.trim()} onClick={() => onRotate(nextValue, updateIntegrations)}>
            <RefreshCw size={14} />
            Rotate
          </button>
        </footer>
      </section>
    </div>
  );
}

export function ApiKeysList({ keys, onSaveKey, onRevoke, onAudit }: ApiKeysListProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [rotateKey, setRotateKey] = useState<ApiKeyRecord | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((key) => [key.id, key.value])));
  const sortedKeys = useMemo(() => keys.slice().sort((a, b) => a.provider.localeCompare(b.provider)), [keys]);

  function save(provider: string, keyId: string): void {
    onSaveKey?.(provider, drafts[keyId] ?? "");
    onAudit?.(`${provider} key saved.`);
  }

  return (
    <section className="settings-panel" role="region" aria-label="Cloud API Keys">
      <div className="settings-panel-head">
        <div>
          <h2>Cloud API Keys</h2>
          <span>Keys are masked by default and copied only on explicit request.</span>
        </div>
        <StatusBadge tone="neutral" label="Local storage" tooltip="This UI avoids rendering raw key values unless Reveal is enabled." />
      </div>
      <div className="api-key-list">
        {sortedKeys.map((keyRecord) => {
          const draft = drafts[keyRecord.id] ?? "";
          return (
            <article className="api-key-row" key={keyRecord.id}>
              <div>
                <strong><KeyRound size={14} /> {keyRecord.provider}</strong>
                <span>Last used {keyRecord.lastUsed ? new Date(keyRecord.lastUsed).toLocaleString() : "never"}</span>
                {keyRecord.auditHref && <a href={keyRecord.auditHref}>Audit trail</a>}
              </div>
              <input
                aria-label={`${keyRecord.provider} API key`}
                type={revealed[keyRecord.id] ? "text" : "password"}
                value={revealed[keyRecord.id] ? draft : maskKey(draft)}
                onChange={(event) => setDrafts((current) => ({ ...current, [keyRecord.id]: event.target.value }))}
                readOnly={!revealed[keyRecord.id]}
              />
              <div className="settings-card-actions">
                <button type="button" onClick={() => setRevealed((current) => ({ ...current, [keyRecord.id]: !current[keyRecord.id] }))}>
                  {revealed[keyRecord.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  {revealed[keyRecord.id] ? "Hide" : "Reveal"}
                </button>
                <button type="button" onClick={() => void navigator.clipboard.writeText(draft)}>
                  <Copy size={14} />
                  Copy
                </button>
                <button type="button" onClick={() => save(keyRecord.provider, keyRecord.id)}>
                  <ShieldCheck size={14} />
                  Save
                </button>
                <button type="button" onClick={() => setRotateKey(keyRecord)}>
                  <RefreshCw size={14} />
                  Rotate
                </button>
                {pendingRevoke === keyRecord.id ? (
                  <button
                    className="danger-soft-btn"
                    type="button"
                    onBlur={() => window.setTimeout(() => setPendingRevoke(null), 120)}
                    onClick={() => {
                      onRevoke?.(keyRecord.id);
                      onAudit?.(`${keyRecord.provider} key revoked.`);
                      setPendingRevoke(null);
                    }}
                  >
                    Confirm Revoke
                  </button>
                ) : (
                  <button type="button" onClick={() => setPendingRevoke(keyRecord.id)}>
                    <Trash2 size={14} />
                    Revoke
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {rotateKey && (
        <RotateKeyModal
          keyRecord={rotateKey}
          onClose={() => setRotateKey(null)}
          onRotate={(nextValue, updateIntegrations) => {
            setDrafts((current) => ({ ...current, [rotateKey.id]: nextValue }));
            onSaveKey?.(rotateKey.provider, nextValue);
            onAudit?.(`${rotateKey.provider} key rotated${updateIntegrations ? " and integrations queued for update" : ""}.`);
            setRotateKey(null);
          }}
        />
      )}
    </section>
  );
}
