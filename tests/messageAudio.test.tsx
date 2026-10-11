import { act, render, screen } from "@testing-library/react";
import { MessageAudio } from "../src/components/Conversation/MessageAudio";
import { releasePiperPlayback } from "../src/services/PiperSpeech";

describe("MessageAudio", () => {
  beforeEach(() => {
    releasePiperPlayback();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:nexus-audio") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
  });

  afterEach(() => releasePiperPlayback());

  it("autoplays a new response URL", () => {
    const play = jest.fn().mockResolvedValue(undefined);
    const pause = jest.fn();
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: jest.fn().mockImplementation(() => ({ play, pause, src: "", preload: "", onended: null, onerror: null })),
    });
    render(<MessageAudio audioBase64="UklGRg==" />);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
  });

  it("shows controls when autoplay is blocked", async () => {
    let rejectPlay: ((reason?: unknown) => void) | undefined;
    const play = jest.fn().mockReturnValue(new Promise<void>((_resolve, reject) => { rejectPlay = reject; }));
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: jest.fn().mockImplementation(() => ({ play, pause: jest.fn(), src: "", preload: "", onended: null, onerror: null })),
    });
    render(<MessageAudio audioBase64="UklGRg==" />);
    await act(async () => rejectPlay?.(new Error("blocked")));
    expect(screen.getByText("Voice playback needs your permission.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Voice response playback" }).querySelector("audio")).toHaveAttribute("controls");
  });

  it("does not interrupt playback when the parent callback changes", () => {
    const play = jest.fn().mockResolvedValue(undefined);
    const pause = jest.fn();
    Object.defineProperty(window, "Audio", {
      configurable: true,
      value: jest.fn().mockImplementation(() => ({ play, pause, src: "", preload: "", onended: null, onerror: null })),
    });
    const { rerender } = render(<MessageAudio audioBase64="UklGRg==" onPlaybackEnd={jest.fn()} />);
    rerender(<MessageAudio audioBase64="UklGRg==" onPlaybackEnd={jest.fn()} />);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
});
