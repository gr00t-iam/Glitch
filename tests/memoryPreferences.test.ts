import { isChatHistoryMemoryEnabled, setChatHistoryMemoryEnabled } from "../src/services/MemoryPreferences";

describe("permanent chat memory preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to enabled", () => {
    expect(isChatHistoryMemoryEnabled()).toBe(true);
  });

  it("persists an explicit preference", () => {
    setChatHistoryMemoryEnabled(false);
    expect(isChatHistoryMemoryEnabled()).toBe(false);
    setChatHistoryMemoryEnabled(true);
    expect(isChatHistoryMemoryEnabled()).toBe(true);
  });
});
