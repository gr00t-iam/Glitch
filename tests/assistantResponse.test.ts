import { extractAssistantToolIntent, formatAssistantError, formatAssistantMarkdown } from "../src/services/AssistantResponse";

describe("assistant response formatting", () => {
  it("detects legacy stringified tool arguments", () => {
    expect(extractAssistantToolIntent('{"action":"live_search","arguments":"{\\"query\\":\\"cooking methods\\"}"}')).toEqual({
      name: "live_search",
      arguments: { query: "cooking methods" },
    });
  });

  it("converts a search tool payload into sourced Markdown", () => {
    const output = formatAssistantMarkdown(
      '{"action":"live_search","arguments":{"query":"cooking methods"}}',
      {
        ok: true,
        query: "cooking methods",
        provider: "local-search",
        searchedAt: "2026-07-10T00:00:00.000Z",
        results: [{ title: "Cooking Methods", url: "https://example.com/cooking", snippet: "A guide to common cooking methods.", content: "" }],
      },
    );
    expect(output).toContain("### Web search results");
    expect(output).toContain("[Cooking Methods](https://example.com/cooking)");
    expect(output).not.toContain('"action"');
  });

  it("replaces unknown action payloads with a readable status", () => {
    const output = formatAssistantMarkdown('{"name":"unknown_action","arguments":{}}');
    expect(output).toContain("### Action not completed");
    expect(output).not.toContain("unknown_action");
  });

  it("masks structured failures and secret query parameters", () => {
    expect(formatAssistantError('{"error":"provider failed"}')).toBe("I could not complete that request. Please try again in a moment.");
    expect(formatAssistantError(new Error("Request failed at /health?token=secret-value"))).toContain("token=[hidden]");
  });
});
