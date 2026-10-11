import { stripMarkdownForSpeech } from "../src/services/VoiceSpeech";

describe("voice response formatting", () => {
  it("removes markdown syntax before speech synthesis", () => {
    expect(stripMarkdownForSpeech("## Weather\n**Sunny** with [details](https://example.com)."))
      .toBe("Weather Sunny with details.");
  });
});
