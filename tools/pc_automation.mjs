/**
 * Safe local PC automation tool.
 * Every action returns a pending confirmation request unless a trusted runtime context executes it.
 */
export default {
  name: "pc_automation",
  description: "Run confirmed local keyboard, mouse, or whitelisted shell automation on the host machine.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["keyboard", "mouse", "shell"],
        description: "Automation channel.",
      },
      action: {
        type: "string",
        description: "Keyboard/mouse action such as type, press, move, or click.",
      },
      text: {
        type: "string",
        description: "Text to type when kind is keyboard and action is type.",
      },
      key: {
        type: "string",
        description: "Allowed key to press when kind is keyboard and action is press.",
      },
      x: {
        type: "number",
        description: "Screen X coordinate for mouse actions.",
      },
      y: {
        type: "number",
        description: "Screen Y coordinate for mouse actions.",
      },
      commandId: {
        type: "string",
        enum: ["pwd", "ls", "git_status", "npm_build"],
        description: "Whitelisted shell command identifier.",
      },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  async handler(args, context) {
    const kind = String(args.kind);
    const payload =
      kind === "shell"
        ? { commandId: String(args.commandId ?? "") }
        : kind === "keyboard"
          ? { action: String(args.action ?? ""), text: args.text, key: args.key }
          : { action: String(args.action ?? ""), x: args.x, y: args.y };

    return context.requestAutomationConfirmation({
      kind,
      payload,
      reason: describeAction(kind, payload),
    });
  },
};

function describeAction(kind, payload) {
  if (kind === "shell") return `run whitelisted command ${payload.commandId}`;
  if (kind === "keyboard") return `perform keyboard action ${payload.action}`;
  if (kind === "mouse") return `perform mouse action ${payload.action}`;
  return "run local automation";
}
