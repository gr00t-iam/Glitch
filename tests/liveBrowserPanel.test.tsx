import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { LiveBrowserPanel } from "../src/components/Browser";

describe("LiveBrowserPanel", () => {
  it("renders accessible runtime controls and log region", () => {
    render(<LiveBrowserPanel startAutoConnectOnMount={false}><div>Browser child</div></LiveBrowserPanel>);

    expect(screen.getByRole("region", { name: "Live Browser Session" })).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Runtime connection logs" })).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: /Start Runtime/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect\/Reconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Diagnostics/i })).not.toBeInTheDocument();
  });

  it("always renders the live browser content without a dry-run restriction", () => {
    render(<LiveBrowserPanel startAutoConnectOnMount={false}><div>Browser child</div></LiveBrowserPanel>);

    expect(screen.getByText("Browser child")).toBeInTheDocument();
    expect(screen.queryByLabelText("Dry-run Preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry-run browser preview")).not.toBeInTheDocument();
  });
});
