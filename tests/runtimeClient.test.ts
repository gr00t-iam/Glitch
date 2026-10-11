import { RuntimeClient } from "../src/services/browserRuntime/runtimeClient";

describe("RuntimeClient", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("waitForHealth resolves when health is ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ status: "ok", version: "1" }) }) as jest.Mock;
    await expect(new RuntimeClient().waitForHealth("http://local", 1000, 10)).resolves.toMatchObject({ status: "ok" });
  });

  it("connectWebSocket performs a tokenized handshake", async () => {
    const sockets: string[] = [];
    class MockWebSocket extends EventTarget {
      constructor(url: string) {
        super();
        sockets.push(url);
        setTimeout(() => this.dispatchEvent(new Event("open")), 0);
      }
    }
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
    const promise = new RuntimeClient().connectWebSocket("ws://runtime/socket", "secret-token");
    jest.runAllTimers();
    await expect(promise).resolves.toBeDefined();
    expect(sockets[0]).toContain("token=secret-token");
    expect(sockets[0]).toContain("version=1");
  });

  it("returns a clear start error when runtime launch fails", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("spawn ENOENT")) as jest.Mock;

    await expect(new RuntimeClient().startLocalRuntime()).resolves.toMatchObject({
      started: false,
      message: "spawn ENOENT",
    });
  });
});
