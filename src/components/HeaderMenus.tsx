import { useMemo, useState } from "react";
import { BookMarked, Bot, Check, Search, Sparkles } from "lucide-react";
import { AgentPreset, SavedPrompt } from "../db/nexusDB";
import { Popover } from "./Popover";

interface PersonaMenuProps {
  presets: AgentPreset[];
  activePresetId: string;
  onApply: (preset: AgentPreset) => void;
  onManage: () => void;
}

export function HeaderPersonaMenu({ presets, activePresetId, onApply, onManage }: PersonaMenuProps) {
  const [open, setOpen] = useState(false);
  const active = presets.find((preset) => preset.id === activePresetId);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Agent personas"
      cardClassName="persona-popover-card"
      trigger={
        <button onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="dialog" title="Agent personas">
          <Bot size={16} />
          Persona
        </button>
      }
    >
      <div className="menu-card-head">
        <strong>Persona</strong>
        {active && <span>Active: {active.name}</span>}
      </div>
      <div className="menu-list persona-menu-list">
        {presets.map((preset) => (
          <button
            key={preset.id}
            className={`menu-row ${preset.id === activePresetId ? "active" : ""}`}
            onClick={() => {
              onApply(preset);
              setOpen(false);
            }}
          >
            <span className="menu-dot" style={{ background: preset.accent }} />
            <span className="menu-row-text">
              <strong>{preset.name}</strong>
              <small>{preset.description}</small>
            </span>
            {preset.id === activePresetId && <Check size={15} />}
          </button>
        ))}
      </div>
      <button
        className="menu-manage"
        onClick={() => {
          setOpen(false);
          onManage();
        }}
      >
        <Sparkles size={14} />
        Manage presets…
      </button>
    </Popover>
  );
}

interface PromptsMenuProps {
  prompts: SavedPrompt[];
  onUse: (prompt: SavedPrompt) => void;
  onManage: () => void;
}

export function HeaderPromptsMenu({ prompts, onUse, onManage }: PromptsMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...prompts].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!normalized) return sorted.slice(0, 30);
    return sorted.filter((prompt) => [prompt.title, prompt.body, ...prompt.tags].some((value) => value.toLowerCase().includes(normalized))).slice(0, 30);
  }, [prompts, query]);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label="Prompt library"
      trigger={
        <button onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="dialog" title="Prompt library (⌘/)">
          <BookMarked size={16} />
          Prompts
        </button>
      }
    >
      <div className="menu-card-head">
        <strong>Prompts</strong>
        <span>{prompts.length} saved</span>
      </div>
      <div className="menu-search">
        <Search size={14} />
        <input autoFocus aria-label="Search prompts" placeholder="Search prompts…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="menu-list">
        {filtered.length === 0 ? (
          <p className="menu-empty">No saved prompts yet.</p>
        ) : (
          filtered.map((prompt) => (
            <button
              key={prompt.id}
              className="menu-row"
              onClick={() => {
                onUse(prompt);
                setOpen(false);
              }}
            >
              <span className="menu-row-text">
                <strong>{prompt.title}</strong>
                <small>{prompt.body}</small>
              </span>
            </button>
          ))
        )}
      </div>
      <button
        className="menu-manage"
        onClick={() => {
          setOpen(false);
          onManage();
        }}
      >
        <BookMarked size={14} />
        Open full library…
      </button>
    </Popover>
  );
}
