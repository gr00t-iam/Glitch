import { buildNeuralWeb, normalizeNeuronActivity } from "../src/components/NeuralNetwork";

describe("LivingBrainCanvas data mapping", () => {
  it("normalizes backend activity values", () => {
    expect(normalizeNeuronActivity([-1, 0.25, 2, Number.NaN])).toEqual([0, 0.25, 1]);
    expect(normalizeNeuronActivity([])).toEqual([0]);
  });

  it("builds an organic neural web and maps every path to activity", () => {
    const data = buildNeuralWeb(5, 40, 12);
    expect(data.coreNodes).toHaveLength(14);
    expect(data.paths).toHaveLength(40);
    expect(data.paths.every((path) => path.controlPoints.length === 8)).toBe(true);
    expect(data.paths.every((path) => path.activityIndex < 5)).toBe(true);
  });
});
