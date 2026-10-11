import { KeyboardEvent, useMemo } from "react";
import {
  Activity,
  BadgeDollarSign,
  Bot,
  Brush,
  FileCode,
  GitCompare,
  GraduationCap,
  Layers3,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SlashCommandCategory = "State" | "Diagnostics" | "Workspace";

export interface SlashCommandDefinition {
  id: string;
  command: string;
  aliases?: string[];
  category: SlashCommandCategory;
  title: string;
  description: string;
  usage: string;
  Icon: LucideIcon;
  requiresArgs?: boolean;
}

export interface ParsedSlashCommand {
  raw: string;
  command: string;
  args: string;
  definition?: SlashCommandDefinition;
}

export const slashCommands: SlashCommandDefinition[] = [
  {
    id: "init",
    command: "/init",
    category: "State",
    title: "Initialize Agent Context",
    description: "Create AGENTS.md and CLAUDE.md templates in the workspace root.",
    usage: "/init",
    Icon: FileCode,
  },
  {
    id: "plan",
    command: "/plan",
    category: "State",
    title: "Planning State",
    description: "Switch into read-only architecture planning with amber UI treatment.",
    usage: "/plan",
    Icon: Brush,
  },
  {
    id: "compact",
    command: "/compact",
    category: "State",
    title: "Compact Thread",
    description: "Summarize long chat history into a tight context note.",
    usage: "/compact",
    Icon: Layers3,
  },
  {
    id: "clear",
    command: "/clear",
    aliases: ["/new"],
    category: "State",
    title: "New Blank Thread",
    description: "Archive the current thread view and start a clean canvas.",
    usage: "/clear or /new",
    Icon: Trash2,
  },
  {
    id: "status",
    command: "/status",
    category: "Diagnostics",
    title: "System Status",
    description: "Show runtime diagnostics, browser health, model state, and tool schemas.",
    usage: "/status",
    Icon: Activity,
  },
  {
    id: "cost",
    command: "/cost",
    category: "Diagnostics",
    title: "Cost Breakdown",
    description: "Display token usage, budget percentage, and local/cloud cost posture.",
    usage: "/cost",
    Icon: BadgeDollarSign,
  },
  {
    id: "yolo",
    command: "/yolo",
    category: "Diagnostics",
    title: "Full Auto-Approve",
    description: "Enable full auto-approve mode for automation flows.",
    usage: "/yolo",
    Icon: Zap,
  },
  {
    id: "elevated",
    command: "/elevated",
    category: "Diagnostics",
    title: "Elevated Capabilities",
    description: "Prompt for authorization to toggle administrative capability mode.",
    usage: "/elevated on|off",
    Icon: ShieldAlert,
    requiresArgs: true,
  },
  {
    id: "diff",
    command: "/diff",
    category: "Workspace",
    title: "Review Diff",
    description: "Open the right-side code review tab with uncommitted file changes.",
    usage: "/diff",
    Icon: GitCompare,
  },
  {
    id: "rollback",
    command: "/rollback",
    category: "Workspace",
    title: "Rollback Checkpoint",
    description: "Restore the latest available trajectory checkpoint.",
    usage: "/rollback",
    Icon: RefreshCcw,
  },
  {
    id: "steer",
    command: "/steer",
    category: "Workspace",
    title: "Steer Active Run",
    description: "Inject a high-priority directive into the background runner context.",
    usage: "/steer <instruction>",
    Icon: Bot,
    requiresArgs: true,
  },
  {
    id: "learn",
    command: "/learn",
    category: "Workspace",
    title: "Learn Target",
    description: "Digest a file, folder, URL, or log into localized execution rules.",
    usage: "/learn <path|url|log>",
    Icon: GraduationCap,
    requiresArgs: true,
  },
];

const commandLookup = new Map<string, SlashCommandDefinition>();
for (const definition of slashCommands) {
  commandLookup.set(definition.command, definition);
  for (const alias of definition.aliases ?? []) commandLookup.set(alias, definition);
}

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const raw = input.trim();
  if (!raw.startsWith("/")) return null;
  const [commandPart, ...rest] = raw.split(/\s+/);
  const command = commandPart.toLowerCase();
  return { raw, command, args: rest.join(" ").trim(), definition: commandLookup.get(command) };
}

export function matchingSlashCommands(input: string): SlashCommandDefinition[] {
  if (!input.startsWith("/")) return [];
  const query = input.split(/\s+/)[0].toLowerCase();
  return slashCommands.filter((definition) => {
    const aliases = definition.aliases ?? [];
    return (
      definition.command.startsWith(query) ||
      aliases.some((alias) => alias.startsWith(query)) ||
      definition.title.toLowerCase().includes(query.slice(1))
    );
  });
}

interface SlashCommandAutocompleteProps {
  activeIndex: number;
  input: string;
  onHover: (index: number) => void;
  onPick: (definition: SlashCommandDefinition) => void;
}

export function SlashCommandAutocomplete({ activeIndex, input, onHover, onPick }: SlashCommandAutocompleteProps) {
  const matches = useMemo(() => matchingSlashCommands(input), [input]);
  if (!input.startsWith("/") || input.includes(" ") || matches.length === 0) return null;

  const grouped = matches.reduce<Record<SlashCommandCategory, SlashCommandDefinition[]>>(
    (accumulator, command) => {
      accumulator[command.category].push(command);
      return accumulator;
    },
    { State: [], Diagnostics: [], Workspace: [] },
  );

  let runningIndex = -1;

  return (
    <div className="slash-command-panel" role="listbox" aria-label="Slash commands">
      <div className="slash-command-header">
        <Sparkles size={15} />
        <strong>Slash Commands</strong>
        <span>↑ ↓ select · Enter complete · Esc dismiss</span>
      </div>
      <div className="slash-command-list">
        {Object.entries(grouped).map(([category, commands]) =>
          commands.length ? (
            <div className="slash-command-group" key={category}>
              <div className="slash-command-group-label">{category}</div>
              {commands.map((command) => {
                runningIndex += 1;
                const index = runningIndex;
                const Icon = command.Icon;
                return (
                  <button
                    key={command.id}
                    className={`slash-command-row ${index === activeIndex ? "active" : ""}`}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onPick(command)}
                    role="option"
                    aria-selected={index === activeIndex}
                  >
                    <span className="slash-command-icon">
                      <Icon size={16} />
                    </span>
                    <span className="slash-command-copy">
                      <strong>{command.command}</strong>
                      <small>{command.description}</small>
                    </span>
                    <code>{command.usage}</code>
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function handleSlashAutocompleteKey(
  event: KeyboardEvent<HTMLInputElement>,
  input: string,
  activeIndex: number,
  setActiveIndex: (value: number | ((current: number) => number)) => void,
  onComplete: (definition: SlashCommandDefinition) => void,
  onDismiss?: () => void,
): boolean {
  const matches = matchingSlashCommands(input);
  if (!input.startsWith("/") || input.includes(" ") || matches.length === 0) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    setActiveIndex(0);
    onDismiss?.();
    return true;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveIndex((current) => Math.min(current + 1, matches.length - 1));
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveIndex((current) => Math.max(current - 1, 0));
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    onComplete(matches[Math.min(activeIndex, matches.length - 1)]);
    return true;
  }
  return false;
}
