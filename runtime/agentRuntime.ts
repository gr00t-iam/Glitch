import type {
  AgentConfirmRequest,
  AgentConfirmResponse,
  AgentMessageRequest,
  AgentMessageResponse,
  AgentPendingAction,
  AgentSkill,
  AgentTool,
  AutomationAction,
  AutomationPendingResult,
  ToolExecutionContext,
} from "./types";
import { executeAutomationAction, issueAutomationToken } from "./automationService";
import { loadSkills, loadTools } from "./moduleLoader";

const pendingActions = new Map<string, AgentPendingAction>();

export async function handleAgentMessage(workspaceRoot: string, request: AgentMessageRequest): Promise<AgentMessageResponse> {
  const userInput = request.message.trim();
  if (!userInput) return { ok: false, mode: "chat", message: "Message is required.", error: "Message is required." };

  const [tools, skills] = await Promise.all([loadTools(workspaceRoot), loadSkills(workspaceRoot)]);
  const selectedSkill = selectSkill(userInput, skills);
  const selectedToolCall = (await selectedSkill?.apply?.({ userInput, availableTools: publicToolDefinitions(tools) }))?.suggestedTool ?? selectTool(userInput, tools);

  if (!selectedToolCall) {
    return {
      ok: true,
      mode: "chat",
      skillName: selectedSkill?.name,
      message: `${selectedSkill?.apply ? "" : ""}${normalResponse(userInput, selectedSkill)}`,
    };
  }

  const tool = tools.find((candidate) => candidate.name === selectedToolCall.name);
  if (!tool) return { ok: false, mode: "tool", message: `Tool ${selectedToolCall.name} is not available.`, error: "Tool not available." };

  const context = createToolContext(workspaceRoot);
  const result = await tool.handler(selectedToolCall.args, context);
  if (isPendingAutomation(result)) {
    return {
      ok: true,
      mode: "confirmation_required",
      toolName: tool.name,
      skillName: selectedSkill?.name,
      message: result.message,
      pendingAction: result,
    };
  }

  return {
    ok: true,
    mode: "tool",
    toolName: tool.name,
    skillName: selectedSkill?.name,
    message: `Executed ${tool.name}.`,
    toolResult: result,
  };
}

export async function handleAgentConfirmation(workspaceRoot: string, request: AgentConfirmRequest): Promise<AgentConfirmResponse> {
  const pending = pendingActions.get(request.actionId);
  if (!pending) return { ok: false, message: "That automation request is no longer available.", error: "Unknown action." };
  pendingActions.delete(request.actionId);

  if (!request.approved) return { ok: true, message: "Automation request denied." };
  if (Date.now() > pending.expiresAt) return { ok: false, message: "Automation request expired.", error: "Expired action." };

  issueAutomationToken(pending.token);
  const result = await executeAutomationAction(workspaceRoot, pending.action, pending.token);
  return {
    ok: result.ok,
    message: result.ok ? "Automation completed." : "Automation failed.",
    result,
    error: result.error,
  };
}

export async function executeConfirmedAutomation(workspaceRoot: string, action: AutomationAction, confirmationToken?: string) {
  return executeAutomationAction(workspaceRoot, action, confirmationToken);
}

function createToolContext(workspaceRoot: string): ToolExecutionContext {
  return {
    async requestAutomationConfirmation(action) {
      return createPendingAutomation(action);
    },
    async executeAutomation(action, confirmationToken) {
      return executeAutomationAction(workspaceRoot, action, confirmationToken);
    },
  };
}

function createPendingAutomation(action: AutomationAction): AutomationPendingResult {
  const actionId = `auto_${crypto.randomUUID()}`;
  const token = crypto.randomUUID();
  pendingActions.set(actionId, {
    id: actionId,
    token,
    action,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return {
    requiresConfirmation: true,
    actionId,
    action,
    message: `Approval required before ${action.kind} automation can run: ${action.reason}`,
  };
}

function selectSkill(userInput: string, skills: AgentSkill[]): AgentSkill | undefined {
  const lower = userInput.toLowerCase();
  return skills.find((skill) => skill.triggers.some((trigger) => lower.includes(trigger.toLowerCase())));
}

function selectTool(userInput: string, tools: AgentTool[]): { name: string; args: Record<string, unknown> } | undefined {
  const lower = userInput.toLowerCase();
  const pcAutomation = tools.find((tool) => tool.name === "pc_automation");
  if (pcAutomation && /\b(shell|terminal|keyboard|mouse|click|type|build|git status|list files|pwd)\b/.test(lower)) {
    if (lower.includes("git status")) return { name: pcAutomation.name, args: { kind: "shell", commandId: "git_status" } };
    if (lower.includes("build")) return { name: pcAutomation.name, args: { kind: "shell", commandId: "npm_build" } };
    if (lower.includes("list files")) return { name: pcAutomation.name, args: { kind: "shell", commandId: "ls" } };
    if (lower.includes("pwd")) return { name: pcAutomation.name, args: { kind: "shell", commandId: "pwd" } };
  }

  const echo = tools.find((tool) => tool.name === "echo");
  if (echo && lower.startsWith("echo ")) return { name: echo.name, args: { text: userInput.slice(5) } };
  return undefined;
}

function normalResponse(userInput: string, skill?: AgentSkill): string {
  const prefix = skill ? `${skill.name} loaded. ` : "";
  return `${prefix}I can answer normally, or use a loaded tool when your request matches a safe action. You said: ${userInput}`;
}

function publicToolDefinitions(tools: AgentTool[]) {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

function isPendingAutomation(value: unknown): value is AutomationPendingResult {
  return Boolean(value && typeof value === "object" && (value as AutomationPendingResult).requiresConfirmation === true);
}
