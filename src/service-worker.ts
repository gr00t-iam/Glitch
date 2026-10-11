/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { handleChatWebhook } from "./services/ChatBotGateway";

declare const self: ServiceWorkerGlobalScope;

export interface HumanApprovalPushPayload {
  type: "HUMAN_APPROVAL_REQUEST";
  requestId: string;
  title?: string;
  agentName: string;
  blockedState: string;
  toolName: string;
  reason: string;
}

const RUNTIME_CACHE = "nexusharness-runtime-v1";

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
const precacheManifest = (self as unknown as { __WB_MANIFEST?: typeof __WB_MANIFEST }).__WB_MANIFEST ?? [];
precacheAndRoute(precacheManifest);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.addAll([
        "/",
        "/manifest.json",
        "/icons/icon-192.svg",
        "/icons/icon-512.svg",
      ]),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.origin === self.location.origin && /\/(?:webhooks|chat-webhook)\//.test(url.pathname)) {
    event.respondWith(
      handleChatWebhook(event.request, async (source, message) => {
        await broadcastRuntimeLog(source, message);
      }).catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : "Webhook routing failed.";
        await broadcastRuntimeLog("service-worker", `Webhook routing failed: ${message}`);
        return new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        });
      }),
    );
    return;
  }

  if (event.request.method === "OPTIONS" && url.origin === self.location.origin && /\/(?:webhooks|chat-webhook)\//.test(url.pathname)) {
    event.respondWith(
      new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
        },
      }),
    );
    return;
  }

  if (event.request.method !== "GET") return;

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok) {
            void caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match("/").then((fallback) => fallback ?? Response.error()));
    }),
  );
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  if (!payload || payload.type !== "HUMAN_APPROVAL_REQUEST") return;

  event.waitUntil(
    Promise.all([
      broadcastRuntimeLog("service-worker", "Human approval notification received."),
      self.registration.showNotification(payload.title ?? "NexusHarness approval required", {
      body: `${payload.agentName} is blocked on ${payload.toolName}: ${payload.reason}`,
      tag: `nexusharness-approval-${payload.requestId}`,
      renotify: true,
      requireInteraction: true,
      icon: "/icons/icon-192.svg",
      badge: "/icons/icon-192.svg",
      data: payload,
      actions: [
        { action: "approve", title: "Approve" },
        { action: "deny", title: "Deny" },
      ],
    } as NotificationOptions & {
      renotify: boolean;
      actions: Array<{ action: string; title: string }>;
    }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payload = event.notification.data as HumanApprovalPushPayload | undefined;
  if (!payload) return;

  const action = event.action === "approve" ? "APPROVED" : "DENIED";
  event.waitUntil(postApprovalResult(payload, action));
});

function parsePushPayload(event: PushEvent): HumanApprovalPushPayload | undefined {
  try {
    return event.data?.json() as HumanApprovalPushPayload | undefined;
  } catch {
    const text = event.data?.text();
    if (!text) return undefined;
    return JSON.parse(text) as HumanApprovalPushPayload;
  }
}

async function postApprovalResult(payload: HumanApprovalPushPayload, action: "APPROVED" | "DENIED"): Promise<void> {
  const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const message = {
    type: "HUMAN_APPROVAL_RESPONSE",
    requestId: payload.requestId,
    action,
    toolName: payload.toolName,
    respondedAt: Date.now(),
  };

  for (const client of windowClients) {
    client.postMessage(message);
  }
  await broadcastRuntimeLog("service-worker", `Permission ${action.toLowerCase()} for ${payload.toolName}.`);

  if (windowClients.length === 0) {
    const opened = await self.clients.openWindow("/");
    opened?.postMessage(message);
  } else {
    await windowClients[0].focus();
  }
}

async function broadcastRuntimeLog(source: "service-worker" | "model" | "chat", message: string): Promise<void> {
  const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windowClients) {
    client.postMessage({
      type: "RUNTIME_LOG",
      source,
      message,
      at: Date.now(),
    });
  }
}
