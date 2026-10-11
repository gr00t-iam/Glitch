export {};

export type AgentMode = "local" | "hybrid";

export interface DesktopSettings {
  mode: AgentMode;
  ollamaBaseUrl: string;
  ollamaModel: string;
  supervisorProvider: "openrouter" | "developer-api";
  supervisorBaseUrl: string;
  supervisorModel: string;
  supervisorApiKeySaved: boolean;
  requireApprovalForWrites: boolean;
  requireApprovalForShell: boolean;
  supervisorEverySteps: number;
  maxSteps: number;
}

export interface TimelineEvent {
  id: string;
  timestamp: number;
  type:
    | "agent.message"
    | "agent.started"
    | "agent.finished"
    | "tool.started"
    | "tool.finished"
    | "tool.error"
    | "approval.required"
    | "approval.resolved"
    | "supervisor.check"
    | "supervisor.directive"
    | "runtime.error";
  title: string;
  detail?: string;
  payload?: unknown;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  reason: string;
  risk: "medium" | "high";
  payload: unknown;
}

export interface AgentRunRequest {
  prompt: string;
  workspacePath: string;
}

export interface AgentRunResult {
  ok: boolean;
  runId?: string;
  error?: string;
}

declare global {
  interface Window {
    nexusDesktop?: {
      selectWorkspace: () => Promise<string | null>;
      getSettings: () => Promise<DesktopSettings>;
      saveSettings: (
        settings: Partial<DesktopSettings> & { supervisorApiKey?: string },
      ) => Promise<DesktopSettings>;
      startAgent: (request: AgentRunRequest) => Promise<AgentRunResult>;
      resolveApproval: (id: string, approved: boolean) => Promise<void>;
      cancelAgent: () => Promise<void>;
      onAgentEvent: (callback: (event: TimelineEvent) => void) => () => void;
      onApprovalRequest: (callback: (request: ApprovalRequest) => void) => () => void;
    };
  }
}
