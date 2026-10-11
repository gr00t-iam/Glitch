import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { ContextStoreProvider } from "../src/components/Context";
import { ResourcePanel } from "../src/components/ResourcePanel";

describe("ResourcePanel", () => {
  it("renders Context and Token Velocity above Cost Tracker with live regions", () => {
    render(
      <ContextStoreProvider>
        <ResourcePanel tokenVelocity={8} tokensUsed={1200} tokenPercent={12} />
      </ContextStoreProvider>,
    );

    const statuses = screen.getAllByRole("status");
    expect(statuses[0]).toHaveTextContent("Context");
    expect(statuses[0]).toHaveAttribute("aria-live", "polite");
    expect(statuses[1]).toHaveTextContent("Token Velocity");
    expect(statuses[1]).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("region", { name: "Cost Tracker" })).toBeInTheDocument();
  });
});
