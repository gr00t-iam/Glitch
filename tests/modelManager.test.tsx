import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModelCard, ModelManager, dedupeModels } from "../src/components/ModelManager";
import type { LocalModelInfo } from "../src/components/AdminHub";

const models: LocalModelInfo[] = [
  { id: "llama3:8b", name: "llama3:8b", size: 1_000, details: { family: "llama", parameterSize: "8B" } },
  { id: "mirror/llama3:8b", name: "mirror llama", size: 1_000, details: { family: "llama", parameterSize: "8B" } },
];

describe("ModelManager", () => {
  it("deduplicates models by checksum metadata", () => {
    const deduped = dedupeModels(models);

    expect(deduped[0].duplicateOf).toBeUndefined();
    expect(deduped[1].duplicateOf).toBe("llama3:8b");
  });

  it("invokes ModelCard actions", () => {
    const onTest = jest.fn();
    const onRemove = jest.fn();
    render(<ModelCard id="m1" name="Model 1" source="ollama://m1" onTest={onTest} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Model 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Remove" }));

    expect(onTest).toHaveBeenCalledWith("m1");
    expect(onRemove).toHaveBeenCalledWith("m1");
  });

  it("opens the sandbox modal from the Test action", () => {
    render(
      <ModelManager
        activeModel="none"
        models={models}
        onRefresh={jest.fn()}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Test" })[0]);

    expect(screen.getByRole("dialog", { name: /Sandbox test/ })).toBeInTheDocument();
  });
});
