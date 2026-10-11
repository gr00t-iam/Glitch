const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const { HybridAgentRuntime } = require("./runtime/agentLoop.cjs");
const { SettingsStore } = require("./runtime/settingsStore.cjs");

let mainWindow = null;
let runtime = null;
let settingsStore = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0c1118",
    title: "NexusHarness",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();

  const devUrl = process.env.NEXUS_DESKTOP_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

app.whenReady().then(() => {
  settingsStore = new SettingsStore(app.getPath("userData"));
  runtime = new HybridAgentRuntime({
    settingsStore,
    emitEvent: (event) => sendToRenderer("agent:event", event),
    requestApproval: (request) => {
      sendToRenderer("agent:approval-request", request);
      return new Promise((resolve) => runtime.registerApprovalResolver(request.id, resolve));
    },
  });

  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a NexusHarness workspace",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("settings:get", async () => settingsStore.get());
  ipcMain.handle("settings:save", async (_event, update) => settingsStore.save(update));

  ipcMain.handle("agent:start", async (_event, request) => {
    try {
      const runId = await runtime.start(request);
      return { ok: true, runId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent failed to start.";
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("agent:approval", async (_event, id, approved) => {
    runtime.resolveApproval(id, Boolean(approved));
  });

  ipcMain.handle("agent:cancel", async () => {
    runtime.cancel();
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
