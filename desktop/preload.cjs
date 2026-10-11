const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nexusDesktop", {
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  startAgent: (request) => ipcRenderer.invoke("agent:start", request),
  resolveApproval: (id, approved) => ipcRenderer.invoke("agent:approval", id, approved),
  cancelAgent: () => ipcRenderer.invoke("agent:cancel"),
  onAgentEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:event", listener);
    return () => ipcRenderer.removeListener("agent:event", listener);
  },
  onApprovalRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:approval-request", listener);
    return () => ipcRenderer.removeListener("agent:approval-request", listener);
  },
});
