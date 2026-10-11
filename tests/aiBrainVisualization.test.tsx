import { act, render, screen } from "@testing-library/react";
import { AI_Brain_Visualization } from "../src/components/NeuralNetwork/AI_Brain_Visualization";

jest.mock("../src/components/NeuralNetwork/LivingBrainCanvas", () => ({
  LivingBrainCanvas: ({ neuronActivity }: { neuronActivity: number[] }) => (
    <div data-testid="living-brain" data-activity={neuronActivity.join(",")} />
  ),
}));

describe("AI_Brain_Visualization", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fills an accessible visualization region and forwards supplied activity", () => {
    render(<AI_Brain_Visualization neuronActivity={[0.2, 0.8]} />);

    expect(screen.getByRole("region", { name: "AI Brain Visualization" })).toBeInTheDocument();
    expect(screen.getByTestId("living-brain")).toHaveAttribute("data-activity", "0.2,0.8");
  });

  it("generates a changing activity feed when no backend values are supplied", () => {
    jest.useFakeTimers();
    render(<AI_Brain_Visualization />);
    const initial = screen.getByTestId("living-brain").getAttribute("data-activity");

    act(() => {
      jest.advanceTimersByTime(850);
    });

    expect(screen.getByTestId("living-brain").getAttribute("data-activity")).not.toBe(initial);
  });
});
