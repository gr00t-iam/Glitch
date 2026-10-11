import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, ClipboardCheck, CornerLeftUp, File, FolderOpen, Globe2, HardDrive, House, PanelRightOpen, Plus, RefreshCw, RotateCcw, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import type { MacroAction } from "./MacroBuilder";
import { onWorkspaceChanged, workspace } from "../services/WorkspaceBridge";
import type { FsEntry, FsReadResult, FsRoot } from "../services/WorkspaceBridge";
import { apiUrl, cdpHttpBase, cdpWsBase, reconnectDelay, runtimeFetch, wait, wsUrl } from "../services/RemoteRuntime";
import {
  browserObservationRequestEvent,
  type BrowserObservationRequest,
  publishBrowserObservation,
} from "../services/browserRuntime/browserObservation";

interface CdpCanvasProps {
  allowAutomation?: boolean;
  endpoint: string;
  debuggingPort?: number;
  expanded?: boolean;
  className?: string;
  onMacroAction?: (action: Omit<MacroAction, "id" | "createdAt">) => void;
  onToggleExpand?: () => void;
  onStatusChange?: (status: CdpConnectionStatus) => void;
}

export type CdpConnectionStatus = "idle" | "connecting" | "attached" | "dropped" | "error";

interface CdpMessage<T = unknown> {
  id?: number;
  method?: string;
  params?: T;
  sessionId?: string;
  result?: unknown;
  error?: { message: string };
}

interface ScreencastFrameParams {
  data: string;
  sessionId: number;
  metadata: {
    deviceWidth: number;
    deviceHeight: number;
    pageScaleFactor: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
  };
}

interface TargetCreatedResult {
  targetId: string;
}

interface AttachResult {
  sessionId: string;
}

interface CloseTargetResult {
  success: boolean;
}

interface CdpTargetInfo {
  id: string;
  title: string;
  type: string;
  url: string;
}

interface CdpVersionInfo {
  Browser?: string;
  webSocketDebuggerUrl?: string;
}

interface BrowserStatusResponse {
  ok: boolean;
  connected: boolean;
  error?: string;
}

type UtilityTabType = "review" | "terminal" | "files";

type BrowserCommandEventDetail =
  | {
      type: "navigate";
      url: string;
    }
  | {
      type: "utility";
      utility: UtilityTabType;
    };

interface UtilityTab {
  id: string;
  type: UtilityTabType;
  title: string;
}

interface UtilityMenuAction {
  type: UtilityTabType | "browser";
  title: string;
  shortcut?: string;
  Icon: LucideIcon;
}

const SETUP_GUIDE = "The embedded browser will open here automatically when the local runtime is available.";

const utilityMenuActions: UtilityMenuAction[] = [
  { type: "browser", title: "New Browser Tab", Icon: Globe2 },
  { type: "review", title: "Review", shortcut: "Ctrl+Shift+G", Icon: ClipboardCheck },
  { type: "terminal", title: "Terminal", Icon: TerminalIcon },
  { type: "files", title: "Files", shortcut: "Ctrl+P", Icon: FolderOpen },
];

const KEY_MAP: Record<string, string> = {
  Backspace: "Backspace",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

const browserStatusLabels: Record<CdpConnectionStatus, string> = {
  idle: "Ready when you are",
  connecting: "Connecting",
  attached: "Connected",
  dropped: "Not connected",
  error: "Needs setup",
};

export function CdpCanvas({
  allowAutomation = true,
  endpoint,
  debuggingPort = 9222,
  expanded = false,
  className,
  onMacroAction,
  onToggleExpand,
  onStatusChange,
}: CdpCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const commandIdRef = useRef(1);
  const viewportRef = useRef({ width: 1280, height: 720 });
  const [status, setStatus] = useState<CdpConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resolvedSocket, setResolvedSocket] = useState<string | null>(null);
  const [targets, setTargets] = useState<CdpTargetInfo[]>([]);
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null);
  const [utilityTabs, setUtilityTabs] = useState<UtilityTab[]>([]);
  const [activeUtilityTabId, setActiveUtilityTabId] = useState<string | null>(null);
  const [isUtilityMenuOpen, setIsUtilityMenuOpen] = useState(false);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const [isAutoLaunching, setIsAutoLaunching] = useState(false);
  const autoLaunchAttemptedRef = useRef(false);
  const macroActionRef = useRef<typeof onMacroAction>(onMacroAction);
  const allowAutomationRef = useRef(allowAutomation);
  const activeUtilityTab = utilityTabs.find((tab) => tab.id === activeUtilityTabId) ?? null;

  useEffect(() => {
    macroActionRef.current = onMacroAction;
  }, [onMacroAction]);

  useEffect(() => {
    allowAutomationRef.current = allowAutomation;
  }, [allowAutomation]);

  useEffect(() => {
    const abort = new AbortController();
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    autoLaunchAttemptedRef.current = false;

    const scheduleReconnect = () => {
      if (abort.signal.aborted) return;
      const delayMs = reconnectDelay(autoLaunchAttemptedRef.current ? 2 : 0);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => setConnectionNonce((value) => value + 1), delayMs);
    };

    if (!allowAutomation) {
      setTargets([]);
      setActiveTargetId(null);
      setActiveUtilityTabId(null);
      setUtilityTabs([]);
      setError("Safe Mode is on. Browser automation and developer tools are paused.");
      updateStatus("idle");
      return () => {
        abort.abort();
      };
    }

    const connect = async (allowAutoLaunch: boolean) => {
      updateStatus("connecting");
      setError(null);
      setResolvedSocket(null);
      let webSocketUrl: string;
      try {
        webSocketUrl = await resolveCdpWebSocketUrl(endpoint, debuggingPort, abort.signal);
      } catch (err) {
        if (!allowAutoLaunch || autoLaunchAttemptedRef.current || abort.signal.aborted) throw err;
        autoLaunchAttemptedRef.current = true;
        await ensureEmbeddedBrowser(abort.signal);
        if (abort.signal.aborted) return;
        webSocketUrl = await resolveCdpWebSocketUrl(endpoint, debuggingPort, abort.signal);
      }
      if (abort.signal.aborted) return;
      setResolvedSocket(webSocketUrl);
      ws = new WebSocket(webSocketUrl);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (!ws) return;
        void attachToInitialPage(ws).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Browser setup could not finish.");
          updateStatus("error");
        });
      });

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as CdpMessage;
        if (message.method === "Page.screencastFrame" && message.sessionId === sessionIdRef.current) {
          const params = message.params as ScreencastFrameParams;
          viewportRef.current = {
            width: params.metadata.deviceWidth,
            height: params.metadata.deviceHeight,
          };
          void drawFrame(params.data);
          send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionIdRef.current);
        }
      });

      ws.addEventListener("close", () => {
        updateStatus("dropped");
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        if (!autoLaunchAttemptedRef.current && !abort.signal.aborted) {
          autoLaunchAttemptedRef.current = true;
          void ensureEmbeddedBrowser(abort.signal)
            .then(() => setConnectionNonce((value) => value + 1))
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : `Browser not connected. ${SETUP_GUIDE}`);
              updateStatus("error");
            });
          return;
        }
        setError(`Browser not connected. ${SETUP_GUIDE}`);
        updateStatus("error");
      });
    };

    const handleOnline = () => {
      scheduleReconnect();
    };
    window.addEventListener("online", handleOnline);

    void connect(true).catch((err: unknown) => {
      if (abort.signal.aborted) return;
      setError(err instanceof Error ? err.message : `Browser not connected. ${SETUP_GUIDE}`);
      updateStatus("error");
      scheduleReconnect();
    });

    return () => {
      abort.abort();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      window.removeEventListener("online", handleOnline);
      ws?.close();
      wsRef.current = null;
      sessionIdRef.current = null;
    };
  }, [allowAutomation, connectionNonce, debuggingPort, endpoint]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<BrowserCommandEventDetail>).detail;
      if (!detail || !allowAutomationRef.current) return;
      if (detail.type === "utility") {
        createUtilityTab(detail.utility);
        return;
      }
      if (detail.type !== "navigate" || !sessionIdRef.current) return;
      try {
        setActiveUtilityTabId(null);
        send("Page.navigate", { url: detail.url }, sessionIdRef.current);
        macroActionRef.current?.({
          type: "browser_navigate",
          label: `Open ${detail.url}`,
          payload: { url: detail.url },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Browser command could not be sent.");
        updateStatus("error");
      }
    };
    window.addEventListener("nexusharness:browser-command", handler);
    return () => window.removeEventListener("nexusharness:browser-command", handler);
  }, [utilityTabs, allowAutomation]);

  useEffect(() => {
    const handleObservationRequest = (event: Event) => {
      const request = (event as CustomEvent<BrowserObservationRequest>).detail;
      if (!request || !allowAutomationRef.current) return;
      void navigateAndReadPage(request.url)
        .then((text) => publishBrowserObservation({ requestId: request.requestId, url: request.url, text }))
        .catch((error) =>
          publishBrowserObservation({
            requestId: request.requestId,
            url: request.url,
            error: error instanceof Error ? error.message : "The live browser could not read this page.",
          }),
        );
    };
    window.addEventListener(browserObservationRequestEvent, handleObservationRequest);
    return () => window.removeEventListener(browserObservationRequestEvent, handleObservationRequest);
  }, [allowAutomation]);

  useEffect(() => {
    if (status !== "attached") return;
    const timer = window.setInterval(() => {
      void refreshTargets();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [status]);

  function updateStatus(nextStatus: CdpConnectionStatus) {
    setStatus(nextStatus);
    onStatusChange?.(nextStatus);
  }

  function send(method: string, params?: unknown, sessionId?: string | null): number {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Browser connection is not open.");
    }
    const id = commandIdRef.current++;
    const payload: CdpMessage = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    return id;
  }

  async function waitForResult<T>(ws: WebSocket, commandId: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const message = JSON.parse(event.data as string) as CdpMessage<T>;
        if (message.id !== commandId) return;
        ws.removeEventListener("message", handler);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result as T);
      };
      ws.addEventListener("message", handler);
    });
  }

  async function navigateAndReadPage(url: string): Promise<string> {
    const ws = wsRef.current;
    const sessionId = sessionIdRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) {
      throw new Error("The live browser is not connected.");
    }

    const idle = waitForNetworkIdle(ws, sessionId);
    const enableNetworkId = send("Network.enable", {}, sessionId);
    await waitForResult(ws, enableNetworkId);
    const navigateId = send("Page.navigate", { url }, sessionId);
    await waitForResult(ws, navigateId);
    await Promise.all([waitForDocumentReady(ws, sessionId), idle]);

    const evaluateId = send(
      "Runtime.evaluate",
      {
        expression: "document.body ? document.body.innerText : ''",
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
    );
    const result = await waitForResult<{ result?: { value?: unknown } }>(ws, evaluateId);
    const text = typeof result.result?.value === "string" ? result.result.value : "";
    if (!text.trim()) throw new Error("The live browser loaded the page, but it did not contain readable text.");
    return text.replace(/\s+/g, " ").trim().slice(0, 12_000);
  }

  async function waitForDocumentReady(ws: WebSocket, sessionId: string, timeoutMs = 12_000): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const evaluateId = send(
        "Runtime.evaluate",
        { expression: "document.readyState", returnByValue: true },
        sessionId,
      );
      const result = await waitForResult<{ result?: { value?: unknown } }>(ws, evaluateId);
      if (result.result?.value === "complete" || result.result?.value === "interactive") return;
      await wait(200);
    }
    throw new Error("The page loaded, but its document did not become readable in time.");
  }

  function waitForNetworkIdle(ws: WebSocket, sessionId: string, timeoutMs = 5_000, quietMs = 700): Promise<void> {
    return new Promise((resolve) => {
      let inFlight = 0;
      let sawLoad = false;
      let lastActivityAt = Date.now();
      const check = window.setInterval(() => {
        if (sawLoad && inFlight <= 0 && Date.now() - lastActivityAt >= quietMs) finish();
      }, 100);
      const timeout = window.setTimeout(() => {
        // Some pages keep telemetry or streaming requests open indefinitely.
        // Treat the timeout as a settled-enough fallback once document readiness is confirmed.
        finish();
      }, timeoutMs);
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(event.data as string) as CdpMessage;
        if (message.sessionId !== sessionId) return;
        if (message.method === "Network.requestWillBeSent") {
          inFlight += 1;
          lastActivityAt = Date.now();
        } else if (message.method === "Network.loadingFinished" || message.method === "Network.loadingFailed") {
          inFlight = Math.max(0, inFlight - 1);
          lastActivityAt = Date.now();
        } else if (message.method === "Page.loadEventFired") {
          sawLoad = true;
          lastActivityAt = Date.now();
        }
      };
      const finish = () => {
        window.clearInterval(check);
        window.clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        resolve();
      };
      ws.addEventListener("message", onMessage);
    });
  }

  async function attachToInitialPage(ws: WebSocket): Promise<void> {
    const pages = await refreshTargets();
    const selected = pages.find((page) => page.id === activeTargetId) ?? pages[0];
    const targetId = selected?.id ?? (await createTarget(ws, "about:blank"));
    await attachToTarget(ws, targetId);
  }

  async function createTarget(ws: WebSocket, url: string): Promise<string> {
    const targetCommandId = send("Target.createTarget", { url });
    const target = await waitForResult<TargetCreatedResult>(ws, targetCommandId);
    return target.targetId;
  }

  async function attachToTarget(ws: WebSocket, targetId: string): Promise<void> {
    const previousSessionId = sessionIdRef.current;
    if (previousSessionId) {
      try {
        send("Page.stopScreencast", {}, previousSessionId);
        send("Target.detachFromTarget", { sessionId: previousSessionId });
      } catch {
        // The browser may already have detached the old target.
      }
    }

    const attachCommandId = send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const attach = await waitForResult<AttachResult>(ws, attachCommandId);
    sessionIdRef.current = attach.sessionId;
    setActiveTargetId(targetId);
    setActiveUtilityTabId(null);

    send("Page.enable", {}, attach.sessionId);
    send("Runtime.enable", {}, attach.sessionId);
    send("Page.startScreencast", { format: "jpeg", quality: 78, everyNthFrame: 1 }, attach.sessionId);
    await refreshTargets();
    updateStatus("attached");
  }

  async function refreshTargets(): Promise<CdpTargetInfo[]> {
      const response = await runtimeFetch(`${httpEndpointBase(endpoint)}/json/list`, { retries: 2, timeoutMs: 8000 });
    if (!response.ok) return [];
    const targetList = ((await response.json()) as CdpTargetInfo[]).filter((target) => target.type === "page");
    setTargets(targetList);
    return targetList;
  }

  async function ensureEmbeddedBrowser(signal?: AbortSignal): Promise<void> {
    setIsAutoLaunching(true);
    setError(null);
    updateStatus("connecting");
    try {
      const response = await runtimeFetch("/api/browser/launch", { method: "POST", signal, retries: 1, timeoutMs: 18000 });
      if (!response.ok) throw new Error(`Launch failed with HTTP ${response.status}`);
      await waitForEmbeddedBrowser(signal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Browser could not be launched from the app.");
      updateStatus("error");
      throw err;
    } finally {
      setIsAutoLaunching(false);
    }
  }

  async function reconnectEmbeddedBrowser(): Promise<void> {
    autoLaunchAttemptedRef.current = false;
    await ensureEmbeddedBrowser();
    setConnectionNonce((value) => value + 1);
  }

  async function selectTarget(targetId: string): Promise<void> {
    setIsUtilityMenuOpen(false);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setActiveUtilityTabId(null);
      setActiveTargetId(targetId);
      setConnectionNonce((value) => value + 1);
      return;
    }
    await attachToTarget(ws, targetId);
  }

  async function createBrowserTab(): Promise<void> {
    if (!allowAutomation) return;
    setIsUtilityMenuOpen(false);
    setActiveUtilityTabId(null);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      await ensureEmbeddedBrowser();
      setConnectionNonce((value) => value + 1);
      return;
    }
    const targetId = await createTarget(ws, "about:blank");
    await attachToTarget(ws, targetId);
    onMacroAction?.({
      type: "browser_navigate",
      label: "Open a new browser tab",
      payload: { url: "about:blank" },
    });
  }

  function createUtilityTab(type: UtilityTabType): void {
    if (!allowAutomation) return;
    const action = utilityMenuActions.find((item) => item.type === type);
    if (!action) return;

    const existing = utilityTabs.find((tab) => tab.type === type);
    if (existing) {
      setActiveUtilityTabId(existing.id);
      setIsUtilityMenuOpen(false);
      return;
    }

    const tab: UtilityTab = {
      id: `${type}-${crypto.randomUUID()}`,
      type,
      title: action.title,
    };
    setUtilityTabs((current) => [...current, tab]);
    setActiveUtilityTabId(tab.id);
    setIsUtilityMenuOpen(false);
    onMacroAction?.({
      type: "utility_open",
      label: `Open ${action.title}`,
      payload: { utility: type },
    });
  }

  function closeUtilityTab(tabId: string): void {
    setUtilityTabs((current) => {
      const closingIndex = current.findIndex((tab) => tab.id === tabId);
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      if (activeUtilityTabId === tabId) {
        const nextActive = nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null;
        setActiveUtilityTabId(nextActive?.id ?? null);
      }
      return nextTabs;
    });
  }

  async function closeTarget(targetId: string): Promise<void> {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const currentTargets = targets.filter((target) => target.type === "page");
    const closingIndex = currentTargets.findIndex((target) => target.id === targetId);
    const fallbackTarget =
      currentTargets[closingIndex + 1] ??
      currentTargets[closingIndex - 1] ??
      currentTargets.find((target) => target.id !== targetId);

    if (targetId === activeTargetId && sessionIdRef.current) {
      try {
        send("Page.stopScreencast", {}, sessionIdRef.current);
        send("Target.detachFromTarget", { sessionId: sessionIdRef.current });
      } catch {
        // Closing the page will detach the session if it is still attached.
      } finally {
        sessionIdRef.current = null;
      }
    }

    const closeCommandId = send("Target.closeTarget", { targetId });
    const result = await waitForResult<CloseTargetResult>(ws, closeCommandId);
    if (!result.success) {
      throw new Error("The browser tab could not be closed.");
    }

    const nextTargets = await refreshTargets();
    const nextActive = fallbackTarget && nextTargets.some((target) => target.id === fallbackTarget.id)
      ? fallbackTarget
      : nextTargets[0];

    if (nextActive) {
      await attachToTarget(ws, nextActive.id);
    } else {
      const newTargetId = await createTarget(ws, "about:blank");
      await attachToTarget(ws, newTargetId);
    }
  }

  async function drawFrame(base64Jpeg: string): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64Jpeg}`;
    await image.decode();
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context?.drawImage(image, 0, 0);
  }

  function canvasCoordinates(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * viewportRef.current.width,
      y: ((event.clientY - rect.top) / rect.height) * viewportRef.current.height,
    };
  }

  function handlePointer(event: React.PointerEvent<HTMLCanvasElement>, type: "mousePressed" | "mouseReleased" | "mouseMoved") {
    if (!sessionIdRef.current || !allowAutomation) return;
    const { x, y } = canvasCoordinates(event);
    send(
      "Input.dispatchMouseEvent",
      {
        type,
        x,
        y,
        button: type === "mouseMoved" ? "none" : "left",
        clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
      },
      sessionIdRef.current,
    );
    if (type === "mouseReleased") {
      onMacroAction?.({
        type: "browser_click",
        label: `Click browser at ${Math.round(x)}, ${Math.round(y)}`,
        payload: { x: Math.round(x), y: Math.round(y) },
      });
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!sessionIdRef.current || !allowAutomation) return;
    const key = KEY_MAP[event.key] ?? event.key;
    const text = event.key.length === 1 ? event.key : undefined;
    send(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key,
        text,
        unmodifiedText: text,
      },
      sessionIdRef.current,
    );
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      onMacroAction?.({
        type: "browser_key",
        label: text ? `Type "${text}"` : `Press ${key}`,
        payload: { key, text },
      });
    }
  }

  function handleKeyUp(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!sessionIdRef.current || !allowAutomation) return;
    send(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key: KEY_MAP[event.key] ?? event.key,
      },
      sessionIdRef.current,
    );
  }

  return (
    <section className={`cdp-shell ${expanded ? "expanded" : ""} ${className ?? ""}`}>
      <div className="browser-toolbar">
        <div className="browser-toolbar-spacer" aria-hidden="true" />
        <div className="browser-toolbar-title">
          <Globe2 size={17} />
          <h2>Live Browser Session</h2>
        </div>
        <div className="browser-window-actions">
          {onToggleExpand && (
            <button
              className="browser-window-button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
              title={expanded ? "Restore browser preview" : "Maximize browser preview"}
              aria-label={expanded ? "Restore browser preview" : "Maximize browser preview"}
            >
              <PanelRightOpen size={15} />
            </button>
          )}
          <button
            className="browser-window-button"
            disabled={!allowAutomation}
            onClick={() => setConnectionNonce((value) => value + 1)}
            title="Refresh browser connection"
            aria-label="Refresh browser connection"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      <div className="browser-subbar">
        <span className={`status-dot ${status}`}>{browserStatusLabels[status]}</span>
        <div className="browser-tabs" aria-label="Live browser tabs">
          <div className="browser-tabs-list">
            {targets.map((target) => (
              <div
                className={`browser-tab ${target.id === activeTargetId && !activeUtilityTabId ? "active" : ""}`}
                key={target.id}
                title={target.url}
              >
                <button className="browser-tab-title" onClick={() => void selectTarget(target.id)}>
                  <span>{target.title || "New Tab"}</span>
                </button>
                <button
                  aria-label={`Close ${target.title || "tab"}`}
                  className="browser-tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTarget(target.id);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {utilityTabs.map((tab) => {
              const action = utilityMenuActions.find((item) => item.type === tab.type);
              const Icon = action?.Icon ?? ClipboardCheck;
              return (
                <div className={`browser-tab utility ${tab.id === activeUtilityTabId ? "active" : ""}`} key={tab.id}>
                  <button className="browser-tab-title" onClick={() => setActiveUtilityTabId(tab.id)}>
                    <Icon size={14} />
                    <span>{tab.title}</span>
                  </button>
                  <button
                    aria-label={`Close ${tab.title}`}
                    className="browser-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeUtilityTab(tab.id);
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            {allowAutomation && (
            <div className="browser-tab-menu-anchor">
              <button
                aria-expanded={isUtilityMenuOpen}
                aria-haspopup="menu"
                aria-label="Open browser utilities"
                className="browser-tab-new compact"
                onClick={() => setIsUtilityMenuOpen((isOpen) => !isOpen)}
                disabled={isAutoLaunching}
              >
              <Plus size={15} />
              </button>
              {isUtilityMenuOpen && (
                <div className="browser-utility-menu" role="menu">
                  {utilityMenuActions.map(({ Icon, shortcut, title, type }) => (
                    <button
                      key={type}
                      role="menuitem"
                      onClick={() => {
                        if (type === "browser") void createBrowserTab();
                        else createUtilityTab(type);
                      }}
                    >
                      <span>
                        <Icon size={15} />
                        {title}
                      </span>
                      {shortcut && <kbd>{shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
      <div className="canvas-frame">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onPointerDown={(event) => handlePointer(event, "mousePressed")}
          onPointerUp={(event) => handlePointer(event, "mouseReleased")}
          onPointerMove={(event) => {
            if (event.buttons === 1) handlePointer(event, "mouseMoved");
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          aria-label="Interactive live browser window"
        />
        {activeUtilityTab && <UtilityTabView tab={activeUtilityTab} />}
        {!activeUtilityTab && (!allowAutomation || status !== "attached") && (
          <div className="canvas-overlay">
            <strong>{!allowAutomation ? "Safe Mode is on" : status === "connecting" || isAutoLaunching ? "Opening your browser" : "Browser not connected"}</strong>
            <span>
              {error ??
                `Browser not connected. ${SETUP_GUIDE}`}
            </span>
            {allowAutomation && status !== "connecting" && !isAutoLaunching && (
              <button className="embedded-browser-action" type="button" onClick={() => void reconnectEmbeddedBrowser()}>
                Start embedded browser
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function UtilityTabView({ tab }: { tab: UtilityTab }) {
  if (tab.type === "terminal") return <TerminalTab />;
  if (tab.type === "review") return <CodeReviewPanel />;
  return <FileExplorerPanel />;
}

interface TerminalSocketMessage {
  type: "ready" | "output" | "exit" | "error";
  data?: string;
  shell?: string;
  cwd?: string;
  exitCode?: number;
  message?: string;
}

const TERMINAL_THEME = {
  background: "#0c1118",
  foreground: "#e7edf4",
  cursor: "#55d7b8",
  cursorAccent: "#0c1118",
  selectionBackground: "rgba(85, 215, 184, 0.30)",
  black: "#0c1118",
  red: "#f46d75",
  green: "#55d7b8",
  yellow: "#f4c95d",
  blue: "#68a8ff",
  magenta: "#a78bfa",
  cyan: "#5ad7e6",
  white: "#c7d2df",
  brightBlack: "#5d6b7a",
  brightRed: "#ff8a90",
  brightGreen: "#7defc8",
  brightYellow: "#ffd97a",
  brightBlue: "#8cc0ff",
  brightMagenta: "#c4aaff",
  brightCyan: "#8be9f0",
  brightWhite: "#ffffff",
};

function TerminalTab() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [connectionLabel, setConnectionLabel] = useState("Connecting");
  const [shellLabel, setShellLabel] = useState("Shell");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    // Real terminal emulator: parses ANSI/VT escape sequences, colors, and
    // cursor control coming back from the PTY instead of printing them as text.
    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Consolas, "Courier New", monospace',
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    safeFit(fitAddon);
    term.focus();

    let isDisposed = false;
    let socket: WebSocket | null = null;
    let retryAttempt = 0;
    let reconnectTimer: number | undefined;
    const pendingInput: string[] = [];

    const syncSize = () => {
      if (isDisposed) return;
      safeFit(fitAddon);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    const connect = () => {
      if (isDisposed) return;
      setConnectionLabel(retryAttempt > 0 ? `Reconnecting ${retryAttempt}` : "Connecting");
      socket = new WebSocket(wsUrl("/api/workspace/terminal"));

      socket.addEventListener("open", () => {
        if (isDisposed) return;
        retryAttempt = 0;
        setConnectionLabel("Connected");
        syncSize();
        while (pendingInput.length && socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "input", data: pendingInput.shift() }));
        }
      });
      socket.addEventListener("message", (event) => {
        if (isDisposed) return;
        const message = JSON.parse(event.data as string) as TerminalSocketMessage;
        if (message.type === "ready") {
          setConnectionLabel("Connected");
          if (message.shell) setShellLabel(prettyShellName(message.shell));
          syncSize();
        } else if (message.type === "output" && message.data) {
          term.write(message.data);
        } else if (message.type === "error") {
          setConnectionLabel("Error");
          term.write(`\r\n\x1b[31m${message.message ?? "Terminal failed to start."}\x1b[0m\r\n`);
        } else if (message.type === "exit") {
          setConnectionLabel("Closed");
          term.write(`\r\n\x1b[90m[process exited with code ${message.exitCode ?? 0}]\x1b[0m\r\n`);
        }
      });
      socket.addEventListener("close", () => {
        if (isDisposed) return;
        retryAttempt += 1;
        const delayMs = reconnectDelay(retryAttempt);
        setConnectionLabel(`Reconnecting in ${Math.ceil(delayMs / 1000)}s`);
        reconnectTimer = window.setTimeout(connect, delayMs);
      });
      socket.addEventListener("error", () => {
        if (!isDisposed) setConnectionLabel("Connection issue");
      });
    };

    const resizeObserver = new ResizeObserver(() => syncSize());
    resizeObserver.observe(host);
    connect();

    // Every keystroke / paste / control sequence xterm produces is forwarded
    // verbatim to the PTY. xterm encodes arrows, Ctrl-C, Tab, Backspace, etc.
    const dataSub = term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
      else pendingInput.push(data);
    });

    return () => {
      isDisposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      resizeObserver.disconnect();
      dataSub.dispose();
      socket?.close();
      term.dispose();
    };
  }, []);

  return (
    <div className="utility-tab-view terminal-view">
      <div className="utility-view-header">
        <div>
          <span>Terminal</span>
          <h3>{shellLabel}</h3>
        </div>
        <strong>{connectionLabel}</strong>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </div>
  );
}

function safeFit(fitAddon: FitAddon): void {
  try {
    fitAddon.fit();
  } catch {
    /* container not laid out yet */
  }
}

function prettyShellName(shell: string): string {
  const base = shell.split(/[\\/]/).pop() ?? shell;
  const lower = base.toLowerCase();
  if (lower.startsWith("powershell")) return "PowerShell";
  if (lower.startsWith("pwsh")) return "PowerShell 7";
  if (lower.startsWith("cmd")) return "Command Prompt";
  if (lower.startsWith("bash")) return "bash";
  if (lower.startsWith("zsh")) return "zsh";
  return base;
}

interface WorkspaceDiffResponse {
  ok: boolean;
  error?: string;
  status: GitStatusEntry[];
  files: DiffFile[];
}

interface GitStatusEntry {
  path: string;
  status: string;
}

interface DiffLine {
  type: "context" | "added" | "deleted" | "meta";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export function CodeReviewPanel() {
  const [status, setStatus] = useState<GitStatusEntry[]>([]);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  const loadDiff = async () => {
    try {
      const payload = await workspace.diff();
      if (!payload.ok) throw new Error(payload.error ?? "Could not load changes.");
      setStatus(payload.status);
      setFiles(payload.files as DiffFile[]);
      setSelectedPath((current) => current ?? payload.files[0]?.path ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load changes.");
    }
  };

  useEffect(() => {
    void loadDiff();
    const timer = window.setInterval(() => void loadDiff(), 2500);
    const unsubscribe = onWorkspaceChanged(() => void loadDiff());
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stage(path: string) {
    setBusyPath(path);
    try {
      await workspace.stage(path);
      await loadDiff();
    } finally {
      setBusyPath(null);
    }
  }

  async function reject(path: string) {
    if (!window.confirm(`Revert changes to "${path}"? This cannot be undone.`)) return;
    setBusyPath(path);
    try {
      await workspace.reject(path);
      if (selectedPath === path) setSelectedPath(null);
      await loadDiff();
    } finally {
      setBusyPath(null);
    }
  }

  return (
    <div className="utility-tab-view review-view">
      <div className="utility-view-header">
        <div>
          <span>Review</span>
          <h3>Workspace Changes</h3>
        </div>
        <div className="review-header-actions">
          <strong>{status.length} changed</strong>
          <button className="ghost-btn" onClick={() => void loadDiff()} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {error && <div className="utility-error">{error}</div>}
      <div className="review-layout">
        <aside className="review-file-list">
          {status.length === 0 && <p>No local changes detected.</p>}
          {status.map((entry) => (
            <button
              className={entry.path === selectedFile?.path ? "active" : ""}
              key={`${entry.status}-${entry.path}`}
              onClick={() => setSelectedPath(entry.path)}
            >
              <span>{entry.path}</span>
              <code>{entry.status}</code>
            </button>
          ))}
        </aside>
        <div className="diff-pane">
          {selectedFile ? (
            <>
              <div className="diff-file-header">
                <span>{selectedFile.path}</span>
                <div className="diff-file-header-right">
                  <code className="diff-stat">
                    <em className="add">+{selectedFile.additions}</em> <em className="del">-{selectedFile.deletions}</em>
                  </code>
                  <button
                    className="ghost-btn"
                    disabled={busyPath === selectedFile.path}
                    onClick={() => void stage(selectedFile.path)}
                    title="Stage this file (git add)"
                  >
                    <Check size={13} /> Stage
                  </button>
                  <button
                    className="ghost-btn danger"
                    disabled={busyPath === selectedFile.path}
                    onClick={() => void reject(selectedFile.path)}
                    title="Reject / revert this file"
                  >
                    <RotateCcw size={13} /> Reject
                  </button>
                </div>
              </div>
              <div className="diff-lines">
                {selectedFile.lines.map((line, index) => (
                  <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                    <span className="diff-gutter">{line.oldLineNumber ?? ""}</span>
                    <span className="diff-gutter">{line.newLineNumber ?? ""}</span>
                    <span className="diff-sign">{line.type === "added" ? "+" : line.type === "deleted" ? "-" : " "}</span>
                    <code>{line.content || " "}</code>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">Select a file to view its line-by-line diff.</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modifiedAt: string;
}

interface FileTreeResponse {
  ok: boolean;
  root?: string;
  path?: string;
  entries?: FileTreeEntry[];
  error?: string;
}

interface FileContentResponse {
  ok: boolean;
  path?: string;
  size?: number;
  modifiedAt?: string;
  content?: string;
  error?: string;
}

export function FileExplorerPanel() {
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [rootPath, setRootPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState<string>("");
  const [entriesByPath, setEntriesByPath] = useState<Record<string, FsEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedFile, setSelectedFile] = useState<FsReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Discover drives / home / project on mount, then open a sensible default root.
  useEffect(() => {
    void (async () => {
      const result = await workspace.roots();
      if (!result.ok) {
        setError(result.error ?? "Could not read drives.");
        return;
      }
      setRoots(result.roots);
      const project = result.roots.find((root) => /project/i.test(root.label));
      const initial = project?.path ?? result.roots[0]?.path ?? "";
      if (initial) await openRoot(initial);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live refresh when the agent or user mutates the filesystem.
  useEffect(() => {
    const unsubscribe = onWorkspaceChanged(() => {
      Object.keys(entriesByPath).forEach((path) => void loadDirectory(path));
      if (selectedFile) void openFile(selectedFile.path);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesByPath, selectedFile]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (rootPath) void loadDirectory(rootPath);
      if (selectedFile?.path) void openFile(selectedFile.path);
    }, 12000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, selectedFile?.path]);

  async function loadDirectory(path: string): Promise<void> {
    const result = await workspace.list(path);
    if (!result.ok) {
      setError(result.error ?? "Could not open folder.");
      return;
    }
    setError(null);
    setEntriesByPath((current) => ({ ...current, [result.path]: result.entries }));
    return;
  }

  async function openRoot(path: string): Promise<void> {
    const result = await workspace.list(path);
    if (!result.ok) {
      setError(result.error ?? "Could not open folder.");
      return;
    }
    setError(null);
    setRootPath(result.path);
    setPathInput(result.path);
    setParentPath(result.parent);
    setEntriesByPath({ [result.path]: result.entries });
    setExpandedPaths(new Set([result.path]));
  }

  async function toggleDirectory(path: string): Promise<void> {
    const next = new Set(expandedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!entriesByPath[path]) await loadDirectory(path);
    }
    setExpandedPaths(next);
  }

  async function openFile(path: string): Promise<void> {
    const result = await workspace.read(path);
    if (!result.ok) {
      setError(result.error ?? "Could not open file.");
      return;
    }
    setError(null);
    setSelectedFile(result);
  }

  return (
    <div className="utility-tab-view files-view">
      <div className="utility-view-header">
        <div>
          <span>Files</span>
          <h3>File Explorer</h3>
        </div>
        <strong>This PC</strong>
      </div>

      <div className="file-explorer-toolbar">
        <div className="root-chips">
          {roots.map((root) => (
            <button
              key={root.path}
              className={`root-chip ${root.path === rootPath ? "active" : ""}`}
              onClick={() => void openRoot(root.path)}
              title={root.path}
            >
              {/project/i.test(root.label) ? <FolderOpen size={13} /> : /home/i.test(root.label) ? <House size={13} /> : <HardDrive size={13} />}
              {root.label}
            </button>
          ))}
        </div>
        <form
          className="path-bar"
          onSubmit={(event) => {
            event.preventDefault();
            if (pathInput.trim()) void openRoot(pathInput.trim());
          }}
        >
          <button type="button" className="ghost-btn" disabled={!parentPath} onClick={() => parentPath && void openRoot(parentPath)} title="Up one folder">
            <CornerLeftUp size={14} />
          </button>
          <input aria-label="Folder path" value={pathInput} onChange={(event) => setPathInput(event.target.value)} placeholder="Type a folder path and press Enter" />
          <button type="button" className="ghost-btn" onClick={() => rootPath && void openRoot(rootPath)} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </form>
      </div>

      {error && <div className="utility-error">{error}</div>}
      <div className="files-layout">
        <div className="file-tree">
          {rootPath && (entriesByPath[rootPath]?.length ?? 0) === 0 ? (
            <p className="file-tree-empty">This folder is empty.</p>
          ) : (
            <FileTreeBranch
              entries={entriesByPath[rootPath] ?? []}
              entriesByPath={entriesByPath}
              expandedPaths={expandedPaths}
              level={0}
              onOpenFile={(path) => void openFile(path)}
              onToggleDirectory={(path) => void toggleDirectory(path)}
              selectedPath={selectedFile?.path ?? null}
            />
          )}
        </div>
        <div className="file-preview">
          {selectedFile ? (
            <>
              <div className="file-preview-header">
                <span>{selectedFile.path}</span>
                <code>
                  {selectedFile.truncated && selectedFile.previewBytes
                    ? `${formatBytes(selectedFile.previewBytes)} preview of ${formatBytes(selectedFile.size ?? 0)}`
                    : formatBytes(selectedFile.size ?? 0)}
                </code>
              </div>
              {selectedFile.truncated && (
                <div className="utility-warning">
                  Showing the first {formatBytes(selectedFile.previewBytes ?? 0)}. Increase <code>NEXUS_MAX_FILE_PREVIEW_MB</code> on the runtime host to preview more.
                </div>
              )}
              {selectedFile.binary ? (
                <div className="empty-state">Binary file — no text preview.</div>
              ) : (
                <pre>{selectedFile.content}</pre>
              )}
            </>
          ) : (
            <div className="empty-state">Select a file to view its contents.</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FileTreeBranchProps {
  entries: FileTreeEntry[];
  entriesByPath: Record<string, FileTreeEntry[]>;
  expandedPaths: Set<string>;
  level: number;
  onOpenFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  selectedPath: string | null;
}

function FileTreeBranch({ entries, entriesByPath, expandedPaths, level, onOpenFile, onToggleDirectory, selectedPath }: FileTreeBranchProps) {
  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path || entry.name}>
          <button
            className={`file-tree-row ${selectedPath === entry.path ? "active" : ""}`}
            onClick={() => (entry.type === "directory" ? onToggleDirectory(entry.path) : onOpenFile(entry.path))}
            style={{ paddingLeft: 8 + level * 14 }}
          >
            {entry.type === "directory" ? (
              <ChevronRight className={expandedPaths.has(entry.path) ? "expanded" : ""} size={14} />
            ) : (
              <File size={14} />
            )}
            <span>{entry.name}</span>
          </button>
          {entry.type === "directory" && expandedPaths.has(entry.path) && (
            <FileTreeBranch
              entries={entriesByPath[entry.path] ?? []}
              entriesByPath={entriesByPath}
              expandedPaths={expandedPaths}
              level={level + 1}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
              selectedPath={selectedPath}
            />
          )}
        </div>
      ))}
    </>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function resolveCdpWebSocketUrl(endpoint: string, debuggingPort: number, signal: AbortSignal): Promise<string> {
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
    if (/\/devtools\/browser\/[^/]+$/.test(endpoint)) return endpoint;
  }

  const baseUrl = httpEndpointBase(endpoint || `http://127.0.0.1:${debuggingPort}`);
  const response = await runtimeFetch(`${baseUrl}/json/version`, { signal, retries: 2, timeoutMs: 8000 });
  if (!response.ok) {
    throw new Error(`Browser not connected. ${SETUP_GUIDE}`);
  }
  const version = (await response.json()) as CdpVersionInfo;
  if (!version.webSocketDebuggerUrl) {
    throw new Error(`Browser did not expose a remote-control socket. ${SETUP_GUIDE}`);
  }
  return rewriteLocalWebSocket(version.webSocketDebuggerUrl);
}

function rewriteLocalWebSocket(webSocketUrl: string): string {
  try {
    const url = new URL(webSocketUrl);
    const secureBase = cdpWsBase();
    if (secureBase) return `${secureBase}${url.pathname}`;
    if (url.hostname === "127.0.0.1") {
      url.hostname = window.location.hostname === "localhost" ? "localhost" : "127.0.0.1";
    }
    return url.toString();
  } catch {
    return webSocketUrl;
  }
}

function httpEndpointBase(endpoint: string): string {
  const configured = cdpHttpBase(endpoint);
  if (configured.startsWith("http")) return configured.replace(/\/$/, "");
  if (configured.startsWith("/")) return configured.replace(/\/$/, "");
  return `http://127.0.0.1:9222`;
}

async function waitForEmbeddedBrowser(signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("Browser launch was cancelled.", "AbortError");
    try {
      const response = await runtimeFetch("/api/browser/status", { signal, retries: 0, timeoutMs: 2000 });
      const status = (await response.json()) as BrowserStatusResponse;
      if (status.connected) return;
    } catch {
      // Keep polling until the local runtime exposes CDP.
    }
    await wait(350);
  }
  throw new Error("Embedded browser started, but the live panel could not connect to it yet.");
}
