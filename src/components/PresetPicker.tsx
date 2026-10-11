import { FormEvent, useState } from "react";
import { Check, Plus, Sparkles, Trash2, X } from "lucide-react";
import { AgentPreset } from "../db/nexusDB";

interface PresetPickerProps {
  presets: AgentPreset[];
  activePresetId: string;
  onClose: () => void;
  onApply: (preset: AgentPreset) => void;
  onCreate: (input: { name: string; description: string; systemPrompt: string; temperature: number; accent: string }) => Promise<void>;
  onDelete: (presetId: string) => Promise<void>;
}

const accentChoices = ["#55d7b8", "#68a8ff", "#a78bfa", "#f4c95d", "#f46d75"];

export function PresetPicker({ presets, activePresetId, onClose, onApply, onCreate, onDelete }: PresetPickerProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.4);
  const [accent, setAccent] = useState(accentChoices[0]);
  const [saving, setSaving] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    try {
      await onCreate({ name, description, systemPrompt, temperature, accent });
      setName("");
      setDescription("");
      setSystemPrompt("");
      setTemperature(0.4);
      setAccent(accentChoices[0]);
      setCreating(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal preset-picker" role="dialog" aria-label="Agent presets" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-kicker">
            <Sparkles size={16} />
            Agent Presets
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setCreating((current) => !current)}>
              <Plus size={15} />
              New preset
            </button>
            <button aria-label="Close presets" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        {creating && (
          <form className="preset-form" onSubmit={(event) => void handleCreate(event)}>
            <div className="preset-form-grid">
              <input aria-label="Preset name" placeholder="Preset name" value={name} onChange={(event) => setName(event.target.value)} />
              <input aria-label="Short description" placeholder="Short description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <textarea aria-label="System prompt" placeholder="System prompt / persona instructions" rows={3} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
            <div className="preset-form-controls">
              <label>
                Creativity {temperature.toFixed(1)}
                <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
              </label>
              <div className="accent-row">
                {accentChoices.map((color) => (
                  <button
                    type="button"
                    key={color}
                    aria-label={`Accent ${color}`}
                    className={`accent-dot ${accent === color ? "active" : ""}`}
                    style={{ background: color }}
                    onClick={() => setAccent(color)}
                  />
                ))}
              </div>
              <button disabled={saving || !name.trim() || !systemPrompt.trim()}>
                <Check size={15} />
                Save
              </button>
            </div>
          </form>
        )}

        <div className="preset-grid">
          {presets.map((preset) => (
            <article className={`preset-card ${preset.id === activePresetId ? "active" : ""}`} key={preset.id} style={{ ["--preset-accent" as string]: preset.accent }}>
              <button className="preset-card-main" onClick={() => onApply(preset)}>
                <div className="preset-dot" style={{ background: preset.accent }} />
                <div>
                  <strong>{preset.name}</strong>
                  <span>{preset.description}</span>
                </div>
                {preset.id === activePresetId && <Check size={16} />}
              </button>
              {!preset.builtIn && (
                <button className="preset-delete" aria-label={`Delete ${preset.name}`} onClick={() => void onDelete(preset.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
