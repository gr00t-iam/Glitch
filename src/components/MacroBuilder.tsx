import { FormEvent, useMemo, useState } from "react";
import { Check, Circle, MousePointerClick, Play, Save, Square, Trash2, Wand2 } from "lucide-react";

export type MacroActionType = "browser_click" | "browser_key" | "browser_navigate" | "chat_prompt" | "utility_open";

export interface MacroAction {
  id: string;
  type: MacroActionType;
  label: string;
  createdAt: number;
  payload: Record<string, unknown>;
}

export type MacroSaveMode = "skill" | "automation";

interface MacroBuilderProps {
  actions: MacroAction[];
  allowAutomation: boolean;
  isRecording: boolean;
  onClear: () => void;
  onStart: () => void;
  onStop: () => void;
  onSave: (input: { mode: MacroSaveMode; name: string; trigger: string; summary: string }) => Promise<void>;
}

const actionLabels: Record<MacroActionType, string> = {
  browser_click: "Click",
  browser_key: "Typing",
  browser_navigate: "Open page",
  chat_prompt: "Message",
  utility_open: "Tool",
};

export function MacroBuilder({ actions, allowAutomation, isRecording, onClear, onSave, onStart, onStop }: MacroBuilderProps) {
  const [name, setName] = useState("My Shortcut");
  const [trigger, setTrigger] = useState("run my shortcut");
  const [saveMode, setSaveMode] = useState<MacroSaveMode>("skill");
  const [isSaving, setIsSaving] = useState(false);
  const summary = useMemo(() => summarizeActions(actions), [actions]);

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!actions.length || !name.trim() || !trigger.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ mode: saveMode, name: name.trim(), trigger: trigger.trim(), summary });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className={`panel macro-panel ${isRecording ? "recording" : ""}`}>
      <div className="panel-title-row">
        <div>
          <h2>Record My Actions</h2>
          <span>
            {!allowAutomation
              ? "Safe Mode is on. Recording is paused."
              : isRecording
                ? "Recording your next steps..."
                : `${actions.length} saved step${actions.length === 1 ? "" : "s"} in this draft.`}
          </span>
        </div>
        <div className="macro-actions">
          {isRecording ? (
            <button className="danger-action" onClick={onStop}>
              <Square size={15} />
              Stop
            </button>
          ) : (
            <button className="record-action" disabled={!allowAutomation} onClick={onStart}>
              <Circle size={15} />
              Record
            </button>
          )}
          <button aria-label="Clear recorded actions" onClick={onClear} disabled={!allowAutomation || isRecording || actions.length === 0}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="macro-timeline" aria-live="polite">
        {actions.length === 0 ? (
          <div className="macro-empty">
            <MousePointerClick size={18} />
            <span>
              {allowAutomation
                ? "Click Record, use the app normally, then save the steps as a reusable shortcut."
                : "Switch to Power Mode when you want to record reusable automations."}
            </span>
          </div>
        ) : (
          actions.slice(-6).map((action, index) => (
            <div className="macro-step" key={action.id}>
              <strong>{actions.length > 6 ? actions.length - 6 + index + 1 : index + 1}</strong>
              <div>
                <span>{actionLabels[action.type]}</span>
                <p>{action.label}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <form className="macro-save-form" onSubmit={(event) => void handleSave(event)}>
        <div className="macro-mode-toggle" role="radiogroup" aria-label="Save recorded actions as">
          <button type="button" className={saveMode === "skill" ? "active" : ""} onClick={() => setSaveMode("skill")}>
            <Wand2 size={15} />
            Skill
          </button>
          <button
            type="button"
            className={saveMode === "automation" ? "active" : ""}
            disabled={!allowAutomation}
            onClick={() => setSaveMode("automation")}
          >
            <Play size={15} />
            Automation
          </button>
        </div>
        <label>
          <span className="message-role">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span className="message-role">Say or type this to run it</span>
          <input value={trigger} onChange={(event) => setTrigger(event.target.value)} />
        </label>
        <button disabled={!allowAutomation || actions.length === 0 || isSaving || isRecording}>
          {isSaving ? <Check size={15} /> : <Save size={15} />}
          {isSaving ? "Saved" : "Save"}
        </button>
      </form>
    </section>
  );
}

function summarizeActions(actions: MacroAction[]): string {
  if (actions.length === 0) return "No steps recorded.";
  return actions
    .map((action, index) => `${index + 1}. ${action.label}`)
    .join("\n");
}
