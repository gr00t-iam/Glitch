import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MicButton } from "../src/components/ComposerTools";

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onresult = null;
  start = jest.fn();
  stop = jest.fn();

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

describe("MicButton", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockSpeechRecognition.instances = [];
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockSpeechRecognition });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("stays pressed and restarts recognition after a browser-ended segment", async () => {
    render(<MicButton onTranscript={jest.fn()} />);
    const button = screen.getByRole("button", { name: "Start voice dictation" });

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(MockSpeechRecognition.instances[0].continuous).toBe(true));

    act(() => MockSpeechRecognition.instances[0].onend?.(new Event("end")));
    act(() => jest.advanceTimersByTime(150));

    expect(MockSpeechRecognition.instances).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Stop voice dictation" })).toHaveAttribute("aria-pressed", "true");
  });

  it("stops on a second click or an external send signal", async () => {
    const { rerender } = render(<MicButton onTranscript={jest.fn()} stopSignal={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));
    await waitFor(() => expect(MockSpeechRecognition.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop voice dictation" }));
    expect(MockSpeechRecognition.instances[0].stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start voice dictation" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));
    await waitFor(() => expect(MockSpeechRecognition.instances).toHaveLength(2));
    const activeRecognition = MockSpeechRecognition.instances.at(-1)!;
    rerender(<MicButton onTranscript={jest.fn()} stopSignal={1} />);
    expect(activeRecognition.stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start voice dictation" })).toHaveAttribute("aria-pressed", "false");
  });

  it("auto-submits the completed sentence after 1.5 seconds of silence", async () => {
    const onAutoSubmit = jest.fn();
    render(<MicButton onAutoSubmit={onAutoSubmit} onTranscript={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start voice dictation" }));
    await waitFor(() => expect(MockSpeechRecognition.instances).toHaveLength(1));
    const recognition = MockSpeechRecognition.instances[0] as MockSpeechRecognition & {
      onresult: ((event: Event & { resultIndex: number; results: unknown }) => void) | null;
    };
    act(() => recognition.onresult?.({
      resultIndex: 0,
      results: { 0: { 0: { transcript: "What is the weather today?" }, isFinal: true }, length: 1 },
    } as unknown as Event & { resultIndex: number; results: unknown }));
    act(() => jest.advanceTimersByTime(1500));
    expect(onAutoSubmit).toHaveBeenCalledWith("What is the weather today?");
    expect(screen.getByRole("button", { name: "Start voice dictation" })).toHaveAttribute("aria-pressed", "false");
  });
});
