const crypto = require("node:crypto");
const path = require("node:path");
const { createTools } = require("./tools.cjs");
const { TriggerMonitor } = require("./triggerMonitor.cjs");
const { SupervisorBridge } = require("./supervisorBridge.cjs");

function createEvent(type, title, detail, payload) {
  return {
    id: `${type}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    timestamp: Date.now(),
    type,
    title,
    detail,
    payload,
  };
}

function parseJsonFromModel(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { message: trimmed, done: true, tool: null };
  }
}

class HybridAgentRuntime {
  constructor({ settingsStore, emitEvent, requestApproval }) {
    this.settingsStore = settingsStore;
    this.emitEvent = emitEvent;
    this.requestApprovalFromUi = requestApproval;
    this.approvalResolvers = new Map();
    this.running = false;
    this.cancelled = false;
    this.supervisor = new SupervisorBridge(settingsStore);
  }

  registerApprovalResolver(id, resolve) {
    this.approvalResolvers.set(id, resolve);
  }

  resolveApproval(id, approved) {
    const resolve = this.approvalResolvers.get(id);
    if (!resolve) return;
    this.approvalResolvers.delete(id);
    resolve(Boolean(approved));
    this.emitEvent(createEvent("approval.resolved", approved ? "Action approved" : "Action denied", undefined, { id }));
  }

  cancel() {
    this.cancelled = true;
  }

  async start(request) {
    if (this.running) throw new Error("An agent run is already active.");
    this.running = true;
    this.cancelled = false;
    const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    void this.run(runId, request).catch((error) => {
      this.emitEvent(
        createEvent("runtime.error", "Runtime error", error instanceof Error ? error.message : "Unknown error"),
      );
      this.running = false;
    });
    return runId;
  }

  async run(runId, request) {
    const workspacePath = request.workspacePath || process.cwd();
    const settings = await this.settingsStore.get();
    const tools = createTools({
      workspacePath,
      settings,
      requestApproval: (approval) => this.requestApproval(approval),
    });
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const monitor = new TriggerMonitor(settings);
    const trajectory = [];

    const messages = [
      {
        role: "system",
        content: this.buildSystemPrompt({ workspacePath, tools }),
      },
      { role: "user", content: request.prompt },
    ];

    this.emitEvent(createEvent("agent.started", "Agent started", `Workspace: ${workspacePath}`, { runId }));

    for (let step = 1; step <= settings.maxSteps; step += 1) {
      if (this.cancelled) break;

      const modelText = await this.callOllama(settings, messages);
      const decision = parseJsonFromModel(modelText);

      if (decision.message) {
        this.emitEvent(createEvent("agent.message", "Worker update", String(decision.message)));
      }

      if (!decision.tool || decision.done) {
        this.emitEvent(createEvent("agent.finished", "Task completed", decision.message || "Done.", { runId }));
        this.running = false;
        return;
      }

      const toolName = decision.tool.name;
      const args = decision.tool.args || {};
      const tool = toolMap.get(toolName);
      if (!tool) {
        messages.push({
          role: "tool",
          content: JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` }),
        });
        trajectory.push({ step, tool: toolName, args, status: "error", error: "Unknown tool" });
        continue;
      }

      this.emitEvent(createEvent("tool.started", `Running ${toolName}`, undefined, args));
      const startedAt = Date.now();
      try {
        const result = await tool.handler(args);
        const entry = {
          step,
          tool: toolName,
          args,
          status: result?.ok === false ? "error" : "success",
          durationMs: Date.now() - startedAt,
          result,
        };
        trajectory.push(entry);
        this.emitEvent(
          createEvent(
            entry.status === "error" ? "tool.error" : "tool.finished",
            `${toolName} ${entry.status}`,
            `${entry.durationMs}ms`,
            result,
          ),
        );
        messages.push({ role: "tool", content: JSON.stringify({ tool: toolName, result }) });
      } catch (error) {
        const entry = {
          step,
          tool: toolName,
          args,
          status: "error",
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : "Unknown tool error",
        };
        trajectory.push(entry);
        this.emitEvent(createEvent("tool.error", `${toolName} failed`, entry.error, entry));
        messages.push({ role: "tool", content: JSON.stringify({ tool: toolName, error: entry.error }) });
      }

      const trigger = monitor.evaluate(trajectory);
      if (trigger) {
        this.emitEvent(createEvent("supervisor.check", "Supervisor audit", trigger.reason, trigger));
        const review = await this.supervisor.review({ messages, trajectory, trigger });
        if (review?.directive) {
          messages.push({ role: "system", content: review.directive });
          this.emitEvent(createEvent("supervisor.directive", "Course Correction Directive", review.directive, review));
        }
      }
    }

    this.emitEvent(createEvent("agent.finished", "Run stopped", "Reached the configured step limit.", { runId }));
    this.running = false;
  }

  async requestApproval(partial) {
    const request = {
      id: `approval-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      ...partial,
    };
    this.emitEvent(createEvent("approval.required", "Approval required", request.reason, request));
    return this.requestApprovalFromUi(request);
  }

  buildSystemPrompt({ workspacePath, tools }) {
    const safeWorkspace = path.resolve(workspacePath);
    return [
      "You are Glitch Worker, a local autonomous agent running inside a guarded Windows desktop app.",
      `Active workspace: ${safeWorkspace}`,
      "Use tools for inspecting files, editing files, shell checks, and git diff. Never claim a file changed unless a tool confirms it.",
      "Risky actions are gated by user approval. If approval is denied, revise the plan and continue safely.",
      "Return strict JSON only with this shape:",
      '{"message":"short user-visible update","tool":{"name":"tool_name","args":{}},"done":false}',
      "When the task is complete, return:",
      '{"message":"final answer","tool":null,"done":true}',
      "Available tools:",
      JSON.stringify(
        tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        null,
        2,
      ),
    ].join("\n\n");
  }

  async callOllama(settings, messages) {
    const response = await fetch(`${settings.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: settings.ollamaModel,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama returned HTTP ${response.status}. ${text.slice(0, 300)}`);
    }

    const data = await response.json();
    return data?.message?.content ?? "";
  }
}

module.exports = { HybridAgentRuntime };
