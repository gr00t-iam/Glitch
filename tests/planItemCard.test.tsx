import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { PlanItemCard } from "../src/components/ExecutionPlan";
import { planEventBus } from "../src/services/planEventBus";

const baseProps = {
  id: "plan-1",
  title: "Review deployment",
  assignedTo: "AI Helper",
  status: "queued" as const,
  progress: 10,
  eta: "2m",
  steps: ["Inspect", "Run"],
  lastUpdated: Date.now(),
};

describe("PlanItemCard", () => {
  it("renders as a live region", () => {
    render(<PlanItemCard {...baseProps} />);

    const region = screen.getByRole("region", { name: "Plan item Review deployment" });
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("receives live status and progress updates from the event bus", () => {
    render(<PlanItemCard {...baseProps} />);

    act(() => {
      planEventBus.publish({ type: "plan:update", itemId: "plan-1", status: "active", progress: 65, lastUpdated: Date.now() });
    });

    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByLabelText("65% complete")).toBeInTheDocument();
  });

  it("invokes claim and release handlers", () => {
    const onClaim = jest.fn();
    const onRelease = jest.fn();
    render(<PlanItemCard {...baseProps} onClaim={onClaim} onRelease={onRelease} />);

    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    fireEvent.click(screen.getByRole("button", { name: "Release" }));

    expect(onClaim).toHaveBeenCalledWith("plan-1");
    expect(onRelease).toHaveBeenCalledWith("plan-1");
  });
});
