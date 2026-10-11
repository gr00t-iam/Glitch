class SupervisorBridge {
  constructor(settingsStore) {
    this.settingsStore = settingsStore;
  }

  async review({ messages, trajectory, trigger }) {
    const settings = await this.settingsStore.get();
    if (settings.mode !== "hybrid") {
      return null;
    }

    const secrets = await this.settingsStore.getSecrets();
    const apiKey = secrets.supervisorApiKey || process.env.OPENROUTER_API_KEY || process.env.NEXUS_SUPERVISOR_API_KEY;
    if (!apiKey) {
      return {
        directive:
          "Course Correction Directive: Hybrid supervisor is enabled but no supervisor API key is configured. Continue locally, reduce scope, and ask the user before risky actions.",
        source: "local-fallback",
      };
    }

    const endpoint = `${settings.supervisorBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const supervisorPrompt = [
      "You are Glitch Supervisor, an automated auditor for a local autonomous worker.",
      "Inspect the latest trajectory for hallucination, loops, unsafe file changes, and bad shell behavior.",
      "Return only one concise Course Correction Directive that the local worker can follow next.",
      "Do not include secrets. Do not ask the user to use a terminal unless absolutely necessary.",
    ].join("\n");

    const body = {
      model: settings.supervisorModel,
      messages: [
        { role: "system", content: supervisorPrompt },
        {
          role: "user",
          content: JSON.stringify(
            {
              trigger,
              recentMessages: messages.slice(-8),
              trajectory: trajectory.slice(-15),
            },
            null,
            2,
          ),
        },
      ],
      temperature: 0.2,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://local.glitch",
        "X-Title": "Glitch Desktop",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        directive: `Course Correction Directive: Supervisor check failed with HTTP ${response.status}. Continue locally, inspect the failed tool result, and avoid repeating the same action. ${text.slice(0, 240)}`,
        source: "supervisor-error",
      };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    return {
      directive: content || "Course Correction Directive: Continue with the safest next verified step.",
      source: "cloud",
    };
  }
}

module.exports = { SupervisorBridge };
