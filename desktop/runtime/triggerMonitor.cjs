const crypto = require("node:crypto");

class TriggerMonitor {
  constructor(settings) {
    this.settings = settings;
  }

  evaluate(trajectory) {
    const last = trajectory.at(-1);
    if (!last) return null;

    if (last.status === "error") {
      return { reason: "A tool returned an error.", severity: "high" };
    }

    const every = Math.max(1, Number(this.settings.supervisorEverySteps) || 5);
    if (trajectory.length > 0 && trajectory.length % every === 0) {
      return { reason: `Scheduled audit after ${trajectory.length} tool steps.`, severity: "medium" };
    }

    const lastFour = trajectory.slice(-4);
    if (lastFour.length === 4) {
      const signatures = lastFour.map((entry) =>
        crypto
          .createHash("sha1")
          .update(`${entry.tool}:${JSON.stringify(entry.args ?? {})}`)
          .digest("hex"),
      );
      if (new Set(signatures).size === 1) {
        return { reason: "The worker appears to be repeating the same action.", severity: "high" };
      }
    }

    return null;
  }
}

module.exports = { TriggerMonitor };
