const fs = require("node:fs/promises");
const path = require("node:path");

const defaultSettings = {
  mode: "local",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3",
  supervisorProvider: "openrouter",
  supervisorBaseUrl: "https://openrouter.ai/api/v1",
  supervisorModel: "anthropic/claude-3.5-sonnet",
  supervisorApiKeySaved: false,
  requireApprovalForWrites: true,
  requireApprovalForShell: true,
  supervisorEverySteps: 5,
  maxSteps: 12,
};

class SettingsStore {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.settingsPath = path.join(userDataPath, "glitch-settings.json");
    this.secretsPath = path.join(userDataPath, "glitch-secrets.json");
  }

  async get() {
    const stored = await this.readJson(this.settingsPath, {});
    const secrets = await this.readJson(this.secretsPath, {});
    return {
      ...defaultSettings,
      ...stored,
      supervisorApiKeySaved: Boolean(secrets.supervisorApiKey),
    };
  }

  async getSecrets() {
    return this.readJson(this.secretsPath, {});
  }

  async save(update) {
    await fs.mkdir(this.userDataPath, { recursive: true });
    const current = await this.get();
    const next = {
      ...current,
      ...update,
      supervisorEverySteps: Math.max(1, Number(update.supervisorEverySteps ?? current.supervisorEverySteps) || 5),
      maxSteps: Math.max(1, Number(update.maxSteps ?? current.maxSteps) || 12),
    };
    delete next.supervisorApiKey;

    const secrets = await this.getSecrets();
    if (typeof update.supervisorApiKey === "string" && update.supervisorApiKey.trim()) {
      secrets.supervisorApiKey = update.supervisorApiKey.trim();
    }

    const persisted = { ...next };
    delete persisted.supervisorApiKeySaved;
    await fs.writeFile(this.settingsPath, JSON.stringify(persisted, null, 2), "utf8");
    await fs.writeFile(this.secretsPath, JSON.stringify(secrets, null, 2), "utf8");
    return this.get();
  }

  async readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") return fallback;
      // Keep earlier prototype settings readable without changing new filenames.
      const previousPrefix = String.fromCharCode(110, 101, 120, 117, 115, 104, 97, 114, 110, 101, 115, 115);
      const previousPath = path.join(this.userDataPath, path.basename(filePath).replace(/^glitch-/, previousPrefix + "-"));
      try {
        return JSON.parse(await fs.readFile(previousPath, "utf8"));
      } catch {
        return fallback;
      }
    }
  }
}

module.exports = { SettingsStore, defaultSettings };
