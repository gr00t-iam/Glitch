import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface NeuralNetworkCanvasProps {
  structure: number[];
  className?: string;
  animationSpeed?: number;
}

export interface NetworkNode {
  id: string;
  layerIndex: number;
  nodeIndex: number;
}

export interface NetworkSynapse {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface NetworkGraph {
  nodes: NetworkNode[][];
  synapses: NetworkSynapse[];
}

interface PositionedNode extends NetworkNode {
  x: number;
  y: number;
  radius: number;
}

interface HoveredNode extends PositionedNode {
  activation: number;
}

function normalizedStructure(structure: number[]): number[] {
  if (structure.length < 2) throw new Error("Neural network structure requires at least two layers.");
  return structure.map((count, index) => {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Layer ${index + 1} must contain a positive whole number of nodes.`);
    }
    return count;
  });
}

function deterministicWeight(layerIndex: number, sourceIndex: number, targetIndex: number): number {
  const value = Math.sin((layerIndex + 1) * 91.17 + (sourceIndex + 1) * 37.31 + (targetIndex + 1) * 17.73);
  return Math.max(-1, Math.min(1, value));
}

export function buildNetworkGraph(structure: number[]): NetworkGraph {
  const layers = normalizedStructure(structure);
  const nodes = layers.map((count, layerIndex) =>
    Array.from({ length: count }, (_, nodeIndex) => ({
      id: `layer-${layerIndex}-node-${nodeIndex}`,
      layerIndex,
      nodeIndex,
    })),
  );
  const synapses: NetworkSynapse[] = [];
  for (let layerIndex = 0; layerIndex < nodes.length - 1; layerIndex += 1) {
    for (const source of nodes[layerIndex]) {
      for (const target of nodes[layerIndex + 1]) {
        synapses.push({
          id: `${source.id}:${target.id}`,
          source: source.id,
          target: target.id,
          weight: deterministicWeight(layerIndex, source.nodeIndex, target.nodeIndex),
        });
      }
    }
  }
  return { nodes, synapses };
}

function activationFor(node: NetworkNode, elapsed: number, speed: number): number {
  return (Math.sin(elapsed * 0.001 * speed + node.layerIndex * 0.9 + node.nodeIndex * 0.57) + 1) / 2;
}

function positionNodes(graph: NetworkGraph, width: number, height: number): PositionedNode[] {
  const horizontalPadding = Math.max(28, width * 0.07);
  const verticalPadding = Math.max(28, height * 0.1);
  const usableWidth = Math.max(1, width - horizontalPadding * 2);
  const usableHeight = Math.max(1, height - verticalPadding * 2);
  const maximumLayerSize = Math.max(...graph.nodes.map((layer) => layer.length));
  const radius = Math.max(5, Math.min(13, usableHeight / Math.max(maximumLayerSize * 3, 1), usableWidth / Math.max(graph.nodes.length * 5, 1)));

  return graph.nodes.flatMap((layer, layerIndex) =>
    layer.map((node, nodeIndex) => ({
      ...node,
      x: horizontalPadding + (usableWidth * layerIndex) / Math.max(graph.nodes.length - 1, 1),
      y: verticalPadding + (usableHeight * (nodeIndex + 1)) / (layer.length + 1),
      radius,
    })),
  );
}

function layerName(index: number, total: number): string {
  if (index === 0) return "Input layer";
  if (index === total - 1) return "Output layer";
  return `Hidden layer ${index}`;
}

export function NeuralNetworkCanvas({ structure, className = "", animationSpeed = 1 }: NeuralNetworkCanvasProps) {
  const signature = structure.join(",");
  const graph = useMemo(() => buildNetworkGraph(structure), [signature]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const positionedNodesRef = useRef<PositionedNode[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const displayedHoverIdRef = useRef<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;
    let frame = 0;
    let width = 0;
    let height = 0;
    let lastTooltipUpdate = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const syncCanvasSize = () => {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const scale = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      positionedNodesRef.current = positionNodes(graph, width, height);
    };

    const draw = (elapsed: number) => {
      context.clearRect(0, 0, width, height);
      const positions = positionedNodesRef.current;
      const nodeById = new Map(positions.map((node) => [node.id, node]));
      const phase = reducedMotion ? 0 : elapsed * 0.001 * animationSpeed;

      for (const synapse of graph.synapses) {
        const source = nodeById.get(synapse.source);
        const target = nodeById.get(synapse.target);
        if (!source || !target) continue;
        const pulse = (Math.sin(phase * 2.2 + synapse.weight * 4 + source.nodeIndex * 0.3) + 1) / 2;
        const strength = Math.abs(synapse.weight);
        context.beginPath();
        context.moveTo(source.x + source.radius, source.y);
        context.lineTo(target.x - target.radius, target.y);
        context.strokeStyle = synapse.weight >= 0
          ? `rgba(45, 212, 191, ${0.08 + strength * 0.28 + pulse * 0.28})`
          : `rgba(251, 191, 36, ${0.07 + strength * 0.22 + pulse * 0.24})`;
        context.lineWidth = 0.5 + strength * 1.3 + pulse * 0.7;
        context.stroke();
      }

      for (const node of positions) {
        const activation = activationFor(node, reducedMotion ? 0 : elapsed, animationSpeed);
        const isHovered = hoveredIdRef.current === node.id;
        context.beginPath();
        context.arc(node.x, node.y, node.radius + (isHovered ? 3 : 0), 0, Math.PI * 2);
        context.fillStyle = isHovered ? "#f8fafc" : `rgba(94, 234, 212, ${0.34 + activation * 0.66})`;
        context.shadowColor = activation > 0.62 ? "rgba(45, 212, 191, 0.7)" : "transparent";
        context.shadowBlur = activation * 13;
        context.fill();
        context.shadowBlur = 0;
        context.lineWidth = 1.5;
        context.strokeStyle = isHovered ? "#fb7185" : "rgba(153, 246, 228, 0.8)";
        context.stroke();
      }

      const pointer = pointerRef.current;
      const hit = pointer
        ? positions.find((node) => Math.hypot(pointer.x - node.x, pointer.y - node.y) <= node.radius + 7) ?? null
        : null;
      const hitId = hit?.id ?? null;
      hoveredIdRef.current = hitId;
      if ((hitId !== displayedHoverIdRef.current || elapsed - lastTooltipUpdate > 180) && hit) {
        lastTooltipUpdate = elapsed;
        displayedHoverIdRef.current = hit.id;
        setHoveredNode({ ...hit, activation: activationFor(hit, reducedMotion ? 0 : elapsed, animationSpeed) });
      } else if (!hit && displayedHoverIdRef.current) {
        displayedHoverIdRef.current = null;
        setHoveredNode(null);
      }

      frame = window.requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(syncCanvasSize);
    observer.observe(container);
    syncCanvasSize();
    frame = window.requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [graph, animationSpeed]);

  function updatePointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  return (
    <section
      className={`relative isolate aspect-[16/9] w-full min-w-0 overflow-visible rounded-lg border border-slate-700 bg-slate-950 shadow-xl ${className}`}
      aria-label={`Neural network architecture with ${graph.nodes.length} layers`}
      ref={containerRef}
      role="region"
    >
      <canvas
        aria-label={`Interactive neural network: ${structure.join(", ")} nodes per layer`}
        className="absolute inset-0 block max-w-full cursor-crosshair touch-none rounded-lg"
        onPointerLeave={() => {
          pointerRef.current = null;
          hoveredIdRef.current = null;
          displayedHoverIdRef.current = null;
          setHoveredNode(null);
        }}
        onPointerMove={updatePointer}
        ref={canvasRef}
        role="img"
      />

      <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300 shadow-lg backdrop-blur-sm">
        <strong className="block text-sm font-semibold text-slate-100">NexusNN topology</strong>
        {structure.join(" → ")}
      </div>

      {hoveredNode ? (
        <div
          className="pointer-events-none absolute z-10 max-w-48 -translate-x-1/2 -translate-y-full rounded-md border border-teal-300/40 bg-slate-900 px-3 py-2 text-xs text-slate-200 shadow-xl"
          role="status"
          style={{ left: hoveredNode.x, top: hoveredNode.y - hoveredNode.radius - 8 }}
        >
          <strong className="block font-semibold text-teal-200">
            {layerName(hoveredNode.layerIndex, graph.nodes.length)}, node {hoveredNode.nodeIndex + 1}
          </strong>
          Activation: {hoveredNode.activation.toFixed(3)}
        </div>
      ) : null}

      <p className="sr-only">
        Network layers contain {structure.join(", ")} nodes. Teal connections represent positive mock weights and amber connections represent negative mock weights.
      </p>
    </section>
  );
}

export default NeuralNetworkCanvas;
