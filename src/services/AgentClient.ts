export interface AgentClientMessageRequest {
  message: string;
}

export interface AgentClientPendingAction {
  requiresConfirmation: true;
  actionId: string;
  message: string;
  action: {
    kind: "keyboard" | "mouse" | "shell";
    payload: Record<string, unknown>;
    reason: string;
  };
}

export interface AgentClientMessageResponse {
  ok: boolean;
  message: string;
  mode: "chat" | "tool" | "confirmation_required";
  toolName?: string;
  skillName?: string;
  toolResult?: unknown;
  pendingAction?: AgentClientPendingAction;
  error?: string;
}

export interface AgentClientConfirmResponse {
  ok: boolean;
  message: string;
  result?: {
    ok: boolean;
    kind: "keyboard" | "mouse" | "shell";
    output?: string;
    error?: string;
  };
  error?: string;
}

export async function sendAgentMessage(message: string): Promise<AgentClientMessageResponse> {
  const response = await fetch("/api/agent/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message } satisfies AgentClientMessageRequest),
  });
  const payload = (await response.json()) as AgentClientMessageResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? payload.message ?? "Agent request failed.");
  return payload;
}

export async function confirmAgentAutomation(actionId: string, approved: boolean): Promise<AgentClientConfirmResponse> {
  const response = await fetch("/api/agent/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actionId, approved }),
  });
  const payload = (await response.json()) as AgentClientConfirmResponse;
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? payload.message ?? "Agent confirmation failed.");
  return payload;
}

export async function exampleAgentFlow(): Promise<AgentClientConfirmResponse | AgentClientMessageResponse> {
  const response = await sendAgentMessage("git status");
  if (response.mode !== "confirmation_required" || !response.pendingAction) return response;
  return confirmAgentAutomation(response.pendingAction.actionId, true);
}
