// self-edit/selfEditTools.ts
//
// Tool definitions passed to the Anthropic Messages API, plus the executor
// that dispatches a tool_use block to the right handler and turns the
// result into a tool_result content block.

import { listWorkspaceDir, readWorkspaceFile, applyPatchOp, type PatchOp } from "./patchTool";
import { createSnapshot } from "./snapshotManager";

export const SELF_EDIT_TOOLS = [
  {
    name: "list_directory",
    description: "List files and folders at a workspace-relative path. Use this to explore structure before editing.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative directory path, e.g. 'src/components'." } },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description: "Read the full text contents of a workspace-relative file.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "snapshot_files",
    description:
      "Back up the given files before modifying them. MUST be called once, before the first write/replace on a given run.",
    input_schema: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
    },
  },
  {
    name: "replace_in_file",
    description:
      "Replace an exact, unique block of text in a file with new text. Preferred over write_file for small, targeted edits — include enough surrounding context in oldText to make it unique.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "write_file",
    description: "Overwrite (or create) a file with new full contents. Use only for new files or full-file rewrites.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
] as const;

export async function executeSelfEditTool(
  workspaceRoot: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ output: string; changedPath?: string }> {
  switch (toolName) {
    case "list_directory": {
      const entries = await listWorkspaceDir(workspaceRoot, String(input.path ?? "."));
      return { output: JSON.stringify(entries) };
    }
    case "read_file": {
      const content = await readWorkspaceFile(workspaceRoot, String(input.path));
      return { output: content };
    }
    case "snapshot_files": {
      const paths = Array.isArray(input.paths) ? (input.paths as string[]) : [];
      const record = await createSnapshot(workspaceRoot, paths, "self-edit run");
      return { output: `Snapshot ${record.id} created for: ${record.files.join(", ") || "(no pre-existing files)"}` };
    }
    case "replace_in_file": {
      const op: PatchOp = {
        type: "replace",
        path: String(input.path),
        oldText: String(input.oldText),
        newText: String(input.newText),
      };
      const result = await applyPatchOp(workspaceRoot, op);
      return { output: result.message, changedPath: result.ok ? result.path : undefined };
    }
    case "write_file": {
      const op: PatchOp = { type: "write", path: String(input.path), content: String(input.content) };
      const result = await applyPatchOp(workspaceRoot, op);
      return { output: result.message, changedPath: result.ok ? result.path : undefined };
    }
    default:
      return { output: `Unknown tool: ${toolName}` };
  }
}
