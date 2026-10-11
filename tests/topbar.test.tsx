import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { TopBar } from "../src/components/TopBar";

describe("TopBar", () => {
  it("does not render context, token velocity, or browser status by default", () => {
    render(<TopBar left={<strong>Workspace</strong>} visibleActions={<button>Action</button>} overflowActions={<button>More</button>} />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.queryByText("Context")).not.toBeInTheDocument();
    expect(screen.queryByText("Token Velocity")).not.toBeInTheDocument();
    expect(screen.queryByText(/Browser not connected/i)).not.toBeInTheDocument();
  });
});
