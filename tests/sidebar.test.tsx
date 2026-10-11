import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "../src/components/Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists collapsed panel state", () => {
    render(
      <Sidebar
        storageKey="test-sidebar"
        panels={[
          { id: "threads", title: "Threads", content: <div>Thread body</div> },
          { id: "activity", title: "Activity Log", content: <div>Activity body</div> },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Threads" }));

    const saved = JSON.parse(localStorage.getItem("test-sidebar") ?? "{}");
    expect(saved.collapsed.threads).toBe(true);
    expect(screen.getByText("Thread body")).not.toBeVisible();
  });

  it("persists panel reorder state", () => {
    render(
      <Sidebar
        storageKey="test-sidebar"
        panels={[
          { id: "threads", title: "Threads", content: <div>Thread body</div> },
          { id: "cost", title: "Cost Tracker", content: <div>Cost body</div> },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move Cost Tracker up" }));

    const saved = JSON.parse(localStorage.getItem("test-sidebar") ?? "{}");
    expect(saved.order).toEqual(["cost", "threads"]);
  });
});
