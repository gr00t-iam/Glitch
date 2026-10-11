const CHAT_HISTORY_MEMORY_KEY = "NEXUS_CHAT_HISTORY_PERMANENT_MEMORY";

export function isChatHistoryMemoryEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(CHAT_HISTORY_MEMORY_KEY) !== "false";
}

export function setChatHistoryMemoryEnabled(enabled: boolean): void {
  window.localStorage.setItem(CHAT_HISTORY_MEMORY_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent("nexusharness:memory-preference-changed", { detail: { enabled } }));
}
