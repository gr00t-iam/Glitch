import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActivityLogPanel } from "../src/components/ActivityLog";
import type { ActivityLogEntry } from "../src/components/ActivityLog";

const now = Date.now();
const entries: ActivityLogEntry[] = [
  { id: "1", at: now - 1000, source: "app", message: "Task started", severity: "info" },
  { id: "2", at: now - 2000, source: "model", message: "Task failed with error", severity: "error" },
  { id: "3", at: now - 3000, source: "model", message: "Task failed again", severity: "error" },
];

describe("ActivityLogPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("filters by search and severity", () => {
    render(<ActivityLogPanel entries={entries} onClear={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("Search activity log"), { target: { value: "failed" } });
    fireEvent.change(screen.getByLabelText("Severity filter"), { target: { value: "error" } });

    expect(screen.queryByText("Task started")).not.toBeInTheDocument();
    expect(screen.getAllByText("Task failed with error").length).toBeGreaterThan(0);
  });

  it("requires confirmation to clear and supports undo", () => {
    const onClear = jest.fn();
    render(<ActivityLogPanel entries={entries} onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));
    expect(onClear).toHaveBeenCalledWith();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onClear).toHaveBeenLastCalledWith(entries);
  });

  it("archives visible entries to localStorage", () => {
    render(<ActivityLogPanel entries={entries} onClear={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    const archived = JSON.parse(localStorage.getItem("NEXUS_ACTIVITY_LOG_ARCHIVE") ?? "[]") as ActivityLogEntry[];
    expect(archived).toHaveLength(entries.length);
  });
});
