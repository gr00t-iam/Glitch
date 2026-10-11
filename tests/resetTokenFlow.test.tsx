import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResetTokenFlow } from "../src/components/Usage";

describe("ResetTokenFlow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("requires typed confirmation before reset", async () => {
    const onReset = jest.fn().mockResolvedValue(undefined);
    render(<ResetTokenFlow onReset={onReset} />);

    expect(screen.getByRole("button", { name: "Reset Thread" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type RESET to confirm"), { target: { value: "RESET" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Thread" }));

    expect(onReset).toHaveBeenCalledWith("Thread");
    expect(await screen.findByRole("status")).toHaveTextContent("Undo is available");
  });

  it("supports scope selection and undo toast", async () => {
    const onReset = jest.fn().mockResolvedValue(undefined);
    render(<ResetTokenFlow onReset={onReset} />);

    fireEvent.change(screen.getByLabelText("Reset Scope"), { target: { value: "Global" } });
    fireEvent.change(screen.getByLabelText("Type RESET to confirm"), { target: { value: "RESET" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Global" }));

    expect(onReset).toHaveBeenCalledWith("Global");
    expect(await screen.findByRole("status")).toHaveTextContent("Undo is available");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
