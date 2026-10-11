import { fireEvent, render, screen } from "@testing-library/react";
import { RightSidebarTabs, type RightSidebarTab } from "../src/components/Layout";

describe("RightSidebarTabs", () => {
  it("renders the three execution modules and reports selection changes", () => {
    let activeTab: RightSidebarTab = "browser";
    const onChange = jest.fn((tab: RightSidebarTab) => {
      activeTab = tab;
    });

    const { rerender } = render(<RightSidebarTabs activeTab={activeTab} onChange={onChange} />);

    expect(screen.getByRole("tab", { name: "Live Browser" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "File Explorer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Code Review" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Code Review" }));
    expect(onChange).toHaveBeenCalledWith("review");

    rerender(<RightSidebarTabs activeTab={activeTab} onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "Code Review" })).toHaveAttribute("aria-selected", "true");
  });
});
