import { FormEvent, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  Binary,
  Check,
  CloudLightning,
  Code2,
  Cpu,
  FileArchive,
  FileCode,
  FolderGit,
  GitBranch,
  Globe,
  HardDrive,
  Network,
  PencilLine,
  Radio,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Terminal,
  Webhook,
  Wifi,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SkillCard } from "../db/nexusDB";
import { marketplaceSkills } from "../data/skillCatalog";
import { runtimeJson } from "../services/RemoteRuntime";

export type SkillStoreCategory =
  | "System & OS Management"
  | "File & Data Operations"
  | "Network & Diagnostics"
  | "Developer Utilities"
  | "Web APIs";

export type ScreenshotTone = "mint" | "gold" | "rose" | "blue" | "violet";

export type SkillOsTarget = "windows" | "macos" | "linux" | "android";

export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "path" | "url" | "enum";
  required: boolean;
  description?: string;
  enumValues?: string[];
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  category: SkillStoreCategory;
  description: string;
  rating: number;
  installs: string;
  screenshotTone: ScreenshotTone;
  triggerKeywords: string[];
  systemPromptSnippet: string;
  /** OS platforms this skill is designed to run on. */
  osTargets?: SkillOsTarget[];
  /** Declared input parameters for the agent to collect and validate. */
  parameters?: SkillParameter[];
  /** Explicit safety constraints enforced when the skill runs. */
  safety?: string[];
}

interface SkillStoreProps {
  installedSkillIds: string[];
  onClose: () => void;
  onCreateSkill: (skill: SkillCard) => Promise<void>;
  onInstallSkill: (skill: MarketplaceSkill) => Promise<void>;
}

interface CustomSkillForm {
  name: string;
  description: string;
  triggers: string;
  instructions: string;
}

interface GeneratedSkillResponse {
  ok: boolean;
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  directory: string;
  files: string[];
  error?: string;
}

const categories: Array<SkillStoreCategory | "All"> = [
  "All",
  "System & OS Management",
  "File & Data Operations",
  "Network & Diagnostics",
  "Developer Utilities",
  "Web APIs",
];

// The 100-skill catalog lives in src/data/skillCatalog.ts (imported above).

interface CategoryTheme {
  className: string;
  label: string;
  navIcon: LucideIcon;
  cardIcons: LucideIcon[];
}

const categoryThemes: Record<SkillStoreCategory, CategoryTheme> = {
  "System & OS Management": {
    className: "system",
    label: "System",
    navIcon: Cpu,
    cardIcons: [Cpu, Terminal, Activity, HardDrive],
  },
  "File & Data Operations": {
    className: "files",
    label: "Files",
    navIcon: FolderGit,
    cardIcons: [FolderGit, FileCode, Binary, FileArchive],
  },
  "Network & Diagnostics": {
    className: "network",
    label: "Network",
    navIcon: Globe,
    cardIcons: [Globe, Wifi, Radio, ShieldCheck],
  },
  "Developer Utilities": {
    className: "developer",
    label: "Dev",
    navIcon: GitBranch,
    cardIcons: [GitBranch, Code2, Terminal, Activity],
  },
  "Web APIs": {
    className: "apis",
    label: "API",
    navIcon: Webhook,
    cardIcons: [Webhook, CloudLightning, Globe, Archive],
  },
};

function stableIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % modulo;
}

function iconForSkill(skill: MarketplaceSkill): LucideIcon {
  const icons = categoryThemes[skill.category].cardIcons;
  return icons[stableIndex(`${skill.category}:${skill.id}:${skill.name}`, icons.length)];
}

export function SkillStore({ installedSkillIds, onClose, onCreateSkill, onInstallSkill }: SkillStoreProps) {
  const [activeCategory, setActiveCategory] = useState<SkillStoreCategory | "All">("All");
  const [query, setQuery] = useState("");
  const [isWriting, setIsWriting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [generatorDescription, setGeneratorDescription] = useState("");
  const [generatorStatus, setGeneratorStatus] = useState("Describe a tool and Glitch will scaffold a local skill module.");
  const [customSkill, setCustomSkill] = useState<CustomSkillForm>({
    name: "",
    description: "",
    triggers: "",
    instructions: "",
  });

  const installed = useMemo(() => new Set(installedSkillIds), [installedSkillIds]);
  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return marketplaceSkills.filter((skill) => {
      const categoryMatch = activeCategory === "All" || skill.category === activeCategory;
      const textMatch =
        !normalized ||
        [skill.name, skill.category, skill.description, ...skill.triggerKeywords].some((value) =>
          value.toLowerCase().includes(normalized),
        );
      return categoryMatch && textMatch;
    });
  }, [activeCategory, query]);

  async function installSkill(skill: MarketplaceSkill): Promise<void> {
    setSavingId(skill.id);
    try {
      await onInstallSkill(skill);
    } finally {
      setSavingId(null);
    }
  }

  async function createCustomSkill(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = customSkill.name.trim();
    const instructions = customSkill.instructions.trim();
    if (!name || !instructions) return;
    const triggers = customSkill.triggers
      .split(",")
      .map((trigger) => trigger.trim().toLowerCase())
      .filter(Boolean);

    setSavingId("custom");
    try {
      await onCreateSkill({
        id: `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || crypto.randomUUID()}`,
        name,
        systemPromptSnippet: [
          customSkill.description.trim() ? `Purpose: ${customSkill.description.trim()}` : "",
          instructions,
        ]
          .filter(Boolean)
          .join("\n\n"),
        triggerKeywords: triggers.length ? triggers : [name.toLowerCase()],
        successCount: 0,
      });
      setCustomSkill({ name: "", description: "", triggers: "", instructions: "" });
      setIsWriting(false);
    } finally {
      setSavingId(null);
    }
  }

  async function generateSkill(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const description = generatorDescription.trim();
    if (!description) return;
    setIsGenerating(true);
    setGeneratorStatus("Generating backend, UI component, metadata, and hot-loadable skill module...");
    try {
      const payload = await runtimeJson<GeneratedSkillResponse>("/api/skills/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
        retries: 1,
        timeoutMs: 30000,
      });
      if (!payload.ok) throw new Error(payload.error ?? "Skill generation failed.");
      await onCreateSkill({
        id: payload.id,
        name: payload.name,
        systemPromptSnippet: [
          `Generated skill stored at ${payload.directory}.`,
          payload.description,
          `Files: ${payload.files.join(", ")}`,
        ].join("\n\n"),
        triggerKeywords: payload.triggerKeywords,
        successCount: 0,
      });
      setGeneratorDescription("");
      setGeneratorStatus(`${payload.name} generated in .agents/skills and registered locally.`);
    } catch (error) {
      setGeneratorStatus(error instanceof Error ? error.message : "Skill generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="skill-store-overlay" aria-label="Skill Store">
      <header className="skill-store-header">
        <div>
          <span className="skill-store-kicker">
            <Sparkles size={15} />
            Skill Store
          </span>
          <h1>Install new abilities in one click.</h1>
          <p>Browse trusted shortcuts, including built-in auto-chunking for long responses with Continue controls.</p>
        </div>
        <div className="skill-store-header-actions">
          <button onClick={() => setIsWriting((current) => !current)}>
            <PencilLine size={16} />
            Write Your Own
          </button>
          <button onClick={onClose} aria-label="Close Skill Store">
            <X size={16} />
            Close
          </button>
        </div>
      </header>

      <div className="skill-store-body">
        <aside className="skill-store-nav" aria-label="Skill categories">
          {categories.map((category) => {
            const theme = category === "All" ? null : categoryThemes[category];
            const Icon = theme?.navIcon ?? Rocket;
            const count = category === "All" ? marketplaceSkills.length : marketplaceSkills.filter((skill) => skill.category === category).length;
            return (
              <button
                key={category}
                className={`${activeCategory === category ? "active" : ""} ${theme ? `skill-nav-${theme.className}` : "skill-nav-all"}`}
                onClick={() => setActiveCategory(category)}
              >
                <span>
                  <Icon size={16} />
                  {category}
                </span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </aside>

        <main className="skill-store-content">
          <div className="skill-store-search">
            <Search size={16} />
            <input
              aria-label="Search skills"
              placeholder="Search by skill, category, or trigger..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {isWriting && (
            <div className="skill-authoring-stack">
            <form className="custom-skill-panel" onSubmit={(event) => void generateSkill(event)}>
              <div className="panel-title-row">
                <div>
                  <h2>Skill Generator</h2>
                  <span>Generate a backend scaffold, UI component, metadata, and hot-loadable skill module in <code>.agents/skills</code>.</span>
                </div>
                <Sparkles size={18} />
              </div>
              <label>
                <span className="message-role">Describe the tool</span>
                <textarea
                  value={generatorDescription}
                  onChange={(event) => setGeneratorDescription(event.target.value)}
                  placeholder="Create a tool that summarizes game server logs and flags crash loops, player join spikes, and plugin errors."
                />
              </label>
              <div className="skill-generator-actions">
                <button disabled={isGenerating || !generatorDescription.trim()}>
                  <Sparkles size={16} />
                  {isGenerating ? "Generating..." : "Generate Skill Module"}
                </button>
                <span>{generatorStatus}</span>
              </div>
            </form>

            <form className="custom-skill-panel" onSubmit={(event) => void createCustomSkill(event)}>
              <div className="panel-title-row">
                <div>
                  <h2>Write Your Own Skill</h2>
                  <span>Save a personal shortcut locally. You can edit or remove it later from your local data.</span>
                </div>
                <ShieldCheck size={18} />
              </div>
              <div className="custom-skill-grid">
                <label>
                  <span className="message-role">Skill Name</span>
                  <input
                    value={customSkill.name}
                    onChange={(event) => setCustomSkill((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Travel planning helper"
                  />
                </label>
                <label>
                  <span className="message-role">Trigger Words</span>
                  <input
                    value={customSkill.triggers}
                    onChange={(event) => setCustomSkill((current) => ({ ...current, triggers: event.target.value }))}
                    placeholder="travel, itinerary, flights"
                  />
                </label>
                <label className="wide">
                  <span className="message-role">Short Description</span>
                  <input
                    value={customSkill.description}
                    onChange={(event) => setCustomSkill((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Helps compare routes and make packing lists."
                  />
                </label>
                <label className="wide">
                  <span className="message-role">What should the helper do?</span>
                  <textarea
                    value={customSkill.instructions}
                    onChange={(event) => setCustomSkill((current) => ({ ...current, instructions: event.target.value }))}
                    placeholder="When I ask about travel, ask for destination and dates, then provide a concise itinerary and safety checklist."
                  />
                </label>
              </div>
              <button disabled={savingId === "custom"}>
                <Check size={16} />
                Save Skill
              </button>
            </form>
            </div>
          )}

          <div className="skill-card-grid">
            {filteredSkills.map((skill) => {
              const theme = categoryThemes[skill.category];
              const CategoryIcon = theme.navIcon;
              const SkillIcon = iconForSkill(skill);
              const isInstalled = installed.has(skill.id);
              return (
                <article className={`skill-card skill-card-${theme.className}`} key={skill.id}>
                  <div className="skill-card-visual" aria-label={`${skill.name} category preview`}>
                    <div className="skill-visual-rhythm" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="skill-icon-tile">
                      <SkillIcon size={25} strokeWidth={1.9} />
                      <small>{theme.label}</small>
                    </div>
                  </div>

                  <div className="skill-card-body">
                    <div className="skill-category-row">
                      <span className="skill-category-badge">
                        <CategoryIcon size={13} />
                        {skill.category}
                      </span>
                      <div className="skill-rating">
                        <Star size={14} />
                        {skill.rating.toFixed(1)}
                      </div>
                    </div>
                    <h2>{skill.name}</h2>
                    <p>{skill.description}</p>
                    <div className="skill-tags">
                      {skill.triggerKeywords.slice(0, 4).map((keyword) => (
                        <span key={keyword}>{keyword}</span>
                      ))}
                    </div>
                  </div>

                  <footer className="skill-card-footer">
                    <span>{skill.installs} installs</span>
                    <button disabled={isInstalled || savingId === skill.id} onClick={() => void installSkill(skill)}>
                      {isInstalled ? <Check size={16} /> : <Rocket size={16} />}
                      {isInstalled ? "Installed" : savingId === skill.id ? "Installing..." : "Install"}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </main>
      </div>
    </section>
  );
}
