import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { ThinkingState } from "../src/components/Conversation/ThinkingState";

describe("ThinkingState", () => {
  it("shows an accessible helper status only while a response is pending", () => {
    const { rerender } = render(<ThinkingState isThinking />);

    expect(screen.getByRole("status", { name: "Helper is thinking" })).toHaveTextContent("Thinking...");
    expect(screen.getByText("Helper")).toBeInTheDocument();

    rerender(<ThinkingState isThinking={false} />);

    expect(screen.queryByRole("status", { name: "Helper is thinking" })).not.toBeInTheDocument();
  });
});
