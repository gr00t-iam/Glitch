import { buildNetworkGraph } from "../src/components/NeuralNetwork";

describe("NeuralNetworkCanvas graph", () => {
  it("creates nodes and fully connected adjacent layers", () => {
    const graph = buildNetworkGraph([4, 6, 6, 2]);
    expect(graph.nodes.map((layer) => layer.length)).toEqual([4, 6, 6, 2]);
    expect(graph.synapses).toHaveLength(4 * 6 + 6 * 6 + 6 * 2);
    expect(graph.synapses.every((synapse) => synapse.weight >= -1 && synapse.weight <= 1)).toBe(true);
  });

  it("rejects invalid structures", () => {
    expect(() => buildNetworkGraph([4])).toThrow("at least two layers");
    expect(() => buildNetworkGraph([4, 0, 2])).toThrow("positive whole number");
  });
});
