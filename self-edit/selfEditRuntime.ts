// self-edit/selfEditRuntime.ts
//
// Drives a bounded agent loop: send the instruction + codebase map to Claude
// with the self-edit tools, execute whatever tools it calls, feed results
// back, repeat until it stops or we hit a turn/tool-call ceiling. Every
// event is pushed through `onEvent` so the frontend can render a live log
// ("Reading App.tsx...", "Writing patch...", etc.) via SSE.

import { buildCodebaseMap } from "./codebaseMapper";
import { executeSelfEditTool, SELF_EDIT_TOOLS } from "./selfEditTools";
import { createSnapshot, listSnapshots, revertSnapshot } from "./snapshotManager";

const MODEL = "claude-sonnet-4-6"; // update to whichever model your Anthropic account has access to
const MAX_TURNS = 8;

export type SelfEditEvent =
  | { type: "status"; message: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "file_changed"; path: string }
  | { type: "done"; changedFiles: string[]; summary: string }
  | { type: "error"; message: string };

interface AnthropicContentBlock {
  type: "text" | "tool_use" | "tool_result";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[] | string;
}

export async function runSelfEditLoop(
  workspaceRoot: string,
  instruction: string,
  onEvent: (event: SelfEditEvent) => void,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onEvent({ type: "error", message: "ANTHROPIC_API_KEY is not set. Add it in Settings first." });
    return;
  }

  onEvent({ type: "status", message: "Mapping codebase..." });
  const map = await buildCodebaseMap(workspaceRoot, { instruction });

  const systemPrompt = [
    "You are NexusHarness's self-editing agent. You may read and modify files in this workspace using the provided tools.",
    "Rules:",
    "1. Always call snapshot_files on every path you intend to change, BEFORE the first write/replace to that path.",
    "2. Prefer replace_in_file with a small, unique oldText anchor over write_file. Only use write_file for new files or full rewrites.",
    "3. Make the smallest change that satisfies the instruction. Do not refactor unrelated code.",
    "4. When you are done, reply with plain text (no tool call) summarizing exactly what changed.",
    "",
    "Directory tree:",
    map.tree,
  ].join("\n");

  const messages: AnthropicMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: `Instruction: ${instruction}` },
        {
          type: "text",
          text: `Relevant files:\n${map.files.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`,
        },
      ],
    },
  ];

  const changedFiles = new Set<string>();

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    onEvent({ type: "status", message: `Thinking (turn ${turn + 1}/${MAX_TURNS})...` });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: SELF_EDIT_TOOLS,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      onEvent({ type: "error", message: `Anthropic API error (${response.status}): ${errText}` });
      return;
    }

    const data = (await response.json()) as { content: AnthropicContentBlock[]; stop_reason: string };
    messages.push({ role: "assistant", content: data.content });

    const toolUses = data.content.filter((b) => b.type === "tool_use");
    const textBlocks = data.content.filter((b) => b.type === "text");

    if (toolUses.length === 0) {
      const summary = textBlocks.map((b) => b.text ?? "").join("\n").trim() || "No further changes.";
      onEvent({ type: "status", message: "Reloading..." });
      onEvent({ type: "done", changedFiles: [...changedFiles], summary });
      return;
    }

    const toolResultBlocks: AnthropicContentBlock[] = [];
    for (const use of toolUses) {
      const toolName = use.name ?? "";
      const input = use.input ?? {};
      onEvent({ type: "tool_call", tool: toolName, input });
      onEvent({ type: "status", message: describeTool(toolName, input) });

      const { output, changedPath } = await executeSelfEditTool(workspaceRoot, toolName, input);
      if (changedPath) {
        changedFiles.add(changedPath);
        onEvent({ type: "file_changed", path: changedPath });
      }
      onEvent({ type: "tool_result", tool: toolName, output });

      toolResultBlocks.push({
        type: "tool_result",
        // @ts-expect-error tool_use_id required by API, not part of our narrow type above
        tool_use_id: use.id,
        content: output,
      } as unknown as AnthropicContentBlock);
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  onEvent({ type: "error", message: "Reached the turn limit without finishing. Review changes manually." });
}

function describeTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "list_directory":
      return `Listing ${input.path ?? "."}...`;
    case "read_file":
      return `Reading ${input.path}...`;
    case "snapshot_files":
      return `Snapshotting ${(input.paths as string[] | undefined)?.join(", ") ?? "files"}...`;
    case "replace_in_file":
      return `Patching ${input.path}...`;
    case "write_file":
      return `Writing ${input.path}...`;
    default:
      return `Running ${name}...`;
  }
}

export async function snapshotThenEdit(workspaceRoot: string, paths: string[], instruction: string) {
  return createSnapshot(workspaceRoot, paths, instruction);
}

export { listSnapshots, revertSnapshot };
