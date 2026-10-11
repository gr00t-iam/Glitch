import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalDock } from "../src/components/Terminal";

const logs = [
  {
    id: "log_1",
    source: "app" as const,
    message: "Runtime ready",
    at: 1_700_000_000_000,
  },
];

describe("TerminalDock", () => {
  it("renders runtime logs when open", () => {
    render(<TerminalDock open mode="bottom" logs={logs} onToggleOpen={jest.fn()} onModeChange={jest.fn()} />);

    expect(screen.getByRole("region", { name: "Runtime terminal" })).toHaveClass("bottom");
    expect(screen.getByText(/Runtime ready/)).toBeInTheDocument();
  });

  it("requests floating mode from the dock toggle", () => {
    const onModeChange = jest.fn();
    render(<TerminalDock open mode="bottom" logs={[]} onToggleOpen={jest.fn()} onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Undock" }));

    expect(onModeChange).toHaveBeenCalledWith("floating");
  });
});
