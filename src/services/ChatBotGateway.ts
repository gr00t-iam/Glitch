import { ChatIntegration, ChatPlatform, decryptCredential, nexusDB } from "../db/nexusDB";
import { LLMClient } from "./McpRouter";

export interface GatewayResult {
  ok: boolean;
  platform: ChatPlatform;
  prompt: string;
  reply: string;
}

export type GatewayLogSink = (source: "service-worker" | "model" | "chat", message: string) => void | Promise<void>;

interface DiscordPayload {
  type?: number;
  data?: { name?: string; options?: Array<{ name: string; value: string }> };
  message?: { content?: string };
  content?: string;
  token?: string;
}

interface SlackPayload {
  type?: string;
  challenge?: string;
  event?: { text?: string; user?: string; channel?: string };
  text?: string;
  response_url?: string;
}

interface WhatsAppPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{ text?: { body?: string }; from?: string }>;
      };
    }>;
  }>;
  text?: string;
  from?: string;
}

type GatewayPayload = DiscordPayload | SlackPayload | WhatsAppPayload;

export async function handleChatWebhook(request: Request, onLog?: GatewayLogSink): Promise<Response> {
  const url = new URL(request.url);
  const platform = platformFromPath(url);
  if (!platform) {
    return jsonResponse({ ok: false, error: "Unknown chat service." }, 404);
  }
  await onLog?.("service-worker", `Webhook received for ${platform}.`);

  const payload = (await request.json()) as GatewayPayload;
  if (platform === "slack" && isSlackChallenge(payload)) {
    await onLog?.("chat", "Slack verification challenge answered.");
    return jsonResponse({ challenge: (payload as SlackPayload).challenge });
  }
  if (platform === "discord" && isDiscordPing(payload)) {
    await onLog?.("chat", "Discord ping acknowledged.");
    return jsonResponse({ type: 1 });
  }

  const prompt = extractPrompt(platform, payload);
  if (!prompt) {
    await onLog?.("chat", "Webhook did not include message text.");
    return jsonResponse({ ok: false, error: "No message text found." }, 400);
  }

  const integration = await nexusDB.integrations.get(platform);
  if (!integration?.isActive) {
    await onLog?.("chat", `${platform} is currently turned off.`);
    return jsonResponse({ ok: false, error: "This chat connection is turned off." }, 409);
  }

  const session = await nexusDB.sessions.orderBy("createdAt").reverse().first();
  if (!session) {
    await onLog?.("chat", "No active session was available for webhook prompt.");
    return jsonResponse({ ok: false, error: "No NexusHarness session is ready." }, 409);
  }

  await onLog?.("service-worker", "Awakening background review and routing flow.");
  const llm = new LLMClient();
  await onLog?.("model", `Routing webhook prompt through ${session.activeModel}.`);
  const response = await llm.complete({
    session,
    messages: [
      {
        role: "system",
        content:
          "You are NexusHarness, a concise personal automation helper. Reply in clear markdown without internal engineering terms.",
      },
      {
        role: "user",
        content: `Message from ${platform}: ${prompt}`,
      },
    ],
  });

  await recordChatTrajectory(session.id, platform, prompt, response.markdown);
  await onLog?.("chat", `Saved ${platform} request to task history.`);
  await streamReplyToPlatform(platform, integration, payload, response.markdown);
  await onLog?.("chat", `Reply streamed back to ${platform}.`);

  const result: GatewayResult = {
    ok: true,
    platform,
    prompt,
    reply: response.markdown,
  };
  return jsonResponse(result);
}

function platformFromPath(url: URL): ChatPlatform | undefined {
  const match = url.pathname.match(/\/(?:webhooks|chat-webhook)\/(discord|slack|whatsapp)$/);
  return match?.[1] as ChatPlatform | undefined;
}

function isSlackChallenge(payload: GatewayPayload): payload is SlackPayload {
  const slack = payload as SlackPayload;
  return slack.type === "url_verification" && typeof slack.challenge === "string";
}

function isDiscordPing(payload: GatewayPayload): payload is DiscordPayload {
  return "type" in payload && payload.type === 1;
}

function extractPrompt(platform: ChatPlatform, payload: GatewayPayload): string {
  if (platform === "discord") {
    const discord = payload as DiscordPayload;
    return (
      discord.data?.options?.find((option) => option.name === "prompt")?.value ??
      discord.message?.content ??
      discord.content ??
      ""
    ).trim();
  }

  if (platform === "slack") {
    const slack = payload as SlackPayload;
    return (slack.event?.text ?? slack.text ?? "").trim();
  }

  const whatsapp = payload as WhatsAppPayload;
  return (
    whatsapp.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ??
    whatsapp.text ??
    ""
  ).trim();
}

async function recordChatTrajectory(sessionId: string, platform: ChatPlatform, prompt: string, reply: string): Promise<void> {
  const existingSteps = await nexusDB.trajectories.where("sessionId").equals(sessionId).toArray();
  const nextStep = existingSteps.reduce((max, step) => Math.max(max, step.stepNumber), 0) + 1;
  await nexusDB.trajectories.put({
    id: `trajectory_chat_${crypto.randomUUID()}`,
    sessionId,
    stepNumber: nextStep,
    stateSnapshot: {
      status: "completed",
      activeAgentId: "chat-gateway",
      trajectoryPointer: nextStep,
      notes: [`Answered ${platform} message.`],
    },
    contextMemory: {
      memoryMarkdown: `Answered ${platform} message: ${prompt.slice(0, 120)}`,
      workingSet: [platform, "chat reply"],
      injectedSkillIds: [],
    },
    toolCalled: `${platform}.reply`,
    responseData: { prompt, reply },
  });
}

async function streamReplyToPlatform(
  platform: ChatPlatform,
  integration: ChatIntegration,
  payload: GatewayPayload,
  markdown: string,
): Promise<void> {
  const token = await decryptCredential(integration.credentials);
  const targetUrl = replyUrlForPlatform(platform, integration, payload);
  if (!targetUrl) return;

  const chunks = markdown
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks.length > 0 ? chunks : [markdown]) {
    await fetch(targetUrl, {
      method: "POST",
      headers: replyHeadersForPlatform(platform, token),
      body: JSON.stringify(replyBodyForPlatform(platform, chunk)),
    });
  }
}

function replyUrlForPlatform(platform: ChatPlatform, integration: ChatIntegration, payload: GatewayPayload): string {
  if (platform === "slack") {
    return (payload as SlackPayload).response_url ?? integration.webhookUrl;
  }
  return integration.webhookUrl;
}

function replyHeadersForPlatform(platform: ChatPlatform, token: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token && platform !== "discord") {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function replyBodyForPlatform(platform: ChatPlatform, markdown: string): Record<string, unknown> {
  if (platform === "discord") return { content: markdown };
  if (platform === "whatsapp") return { text: { body: markdown } };
  return { text: markdown, response_type: "in_channel" };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}
