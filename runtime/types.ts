export interface JsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  handler(args: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  apply?(input: SkillApplyInput): Promise<SkillApplyResult> | SkillApplyResult;
}

export interface SkillApplyInput {
  userInput: string;
  availableTools: Array<Pick<AgentTool, "name" | "description" | "parameters">>;
}

export interface SkillApplyResult {
  responsePrefix?: string;
  suggestedTool?: {
    name: string;
    args: Record<string, unknown>;
  };
}

export interface ToolExecutionContext {
  confirmedActionId?: string;
  requestAutomationConfirmation(action: AutomationAction): Promise<AutomationPendingResult>;
  executeAutomation(action: AutomationAction, confirmationToken: string): Promise<AutomationExecutionResult>;
}

export type AutomationKind = "keyboard" | "mouse" | "shell";

export interface AutomationAction {
  kind: AutomationKind;
  payload: Record<string, unknown>;
  reason: string;
}

export interface AutomationPendingResult {
  requiresConfirmation: true;
  actionId: string;
  message: string;
  action: AutomationAction;
}

export interface AutomationExecutionResult {
  ok: boolean;
  kind: AutomationKind;
  output?: string;
  error?: string;
}

export interface AgentPendingAction {
  id: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  action: AutomationAction;
}

export interface AgentMessageRequest {
  message: string;
}

export interface AgentMessageResponse {
  ok: boolean;
  message: string;
  mode: "chat" | "tool" | "confirmation_required";
  toolName?: string;
  toolResult?: unknown;
  pendingAction?: AutomationPendingResult;
  skillName?: string;
  error?: string;
}

export interface AgentConfirmRequest {
  actionId: string;
  approved: boolean;
}

export interface AgentConfirmResponse {
  ok: boolean;
  message: string;
  result?: AutomationExecutionResult;
  error?: string;
}
