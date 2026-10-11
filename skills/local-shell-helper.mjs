export default {
  id: "local-shell-helper",
  name: "Local Shell Helper",
  description: "Routes safe local shell requests to the confirmed PC automation tool.",
  triggers: ["git status", "build", "list files", "pwd"],
  instructions: "Use pc_automation only for whitelisted shell command identifiers and always require confirmation.",
  apply({ userInput }) {
    const lower = userInput.toLowerCase();
    if (lower.includes("git status")) return { suggestedTool: { name: "pc_automation", args: { kind: "shell", commandId: "git_status" } } };
    if (lower.includes("build")) return { suggestedTool: { name: "pc_automation", args: { kind: "shell", commandId: "npm_build" } } };
    if (lower.includes("list files")) return { suggestedTool: { name: "pc_automation", args: { kind: "shell", commandId: "ls" } } };
    if (lower.includes("pwd")) return { suggestedTool: { name: "pc_automation", args: { kind: "shell", commandId: "pwd" } } };
    return {};
  },
};
