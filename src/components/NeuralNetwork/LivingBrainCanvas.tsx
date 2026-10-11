import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export interface LivingBrainCanvasProps {
  neuronActivity: number[];
  className?: string;
  compact?: boolean;
}

export interface NeuralPathData {
  activityIndex: number;
  controlPoints: THREE.Vector3[];
  intensity: number;
}

export interface NeuralWebData {
  coreNodes: THREE.Vector3[];
  paths: NeuralPathData[];
}

interface BuiltPath extends NeuralPathData {
  curve: THREE.CatmullRomCurve3;
  line: THREE.Line;
}

const outerBlue = new THREE.Color("#075985");
const fiberBlue = new THREE.Color("#0ea5e9");
const electricTeal = new THREE.Color("#2dd4bf");
const hotOrange = new THREE.Color("#fb923c");
const hotRed = new THREE.Color("#ef4444");

export function normalizeNeuronActivity(values: number[]): number[] {
  const normalized = values.filter(Number.isFinite).map((value) => THREE.MathUtils.clamp(value, 0, 1));
  return normalized.length ? normalized : [0];
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDirection(random: () => number): THREE.Vector3 {
  const azimuth = random() * Math.PI * 2;
  const vertical = random() * 2 - 1;
  const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  return new THREE.Vector3(Math.cos(azimuth) * radial, vertical, Math.sin(azimuth) * radial);
}

export function buildNeuralWeb(activityCount: number, pathCount = 132, seed = 7319): NeuralWebData {
  const safeActivityCount = Math.max(1, activityCount);
  const random = seededRandom(seed);
  const coreNodes = Array.from({ length: 14 }, (_, index) => {
    const angle = (index / 14) * Math.PI * 2 + random() * 0.35;
    const radius = 0.08 + random() * 0.34;
    return new THREE.Vector3(
      Math.cos(angle) * radius * 1.2,
      (random() - 0.5) * 0.5,
      Math.sin(angle) * radius,
    );
  });

  const paths = Array.from({ length: pathCount }, (_, pathIndex) => {
    const activityIndex = pathIndex % safeActivityCount;
    const start = coreNodes[pathIndex % coreNodes.length].clone();
    const direction = randomDirection(random);
    const reach = 1.45 + random() * 0.9;
    const end = direction.multiplyScalar(reach);
    end.x *= 1.08;
    end.y *= 0.82;
    end.z *= 0.9;
    const controlPoints = Array.from({ length: 8 }, (_, pointIndex) => {
      const progress = pointIndex / 7;
      const point = start.clone().lerp(end, progress);
      const branchNoise = Math.sin(progress * Math.PI) * (0.12 + progress * 0.28);
      const curl = new THREE.Vector3(
        (random() - 0.5) * branchNoise,
        (random() - 0.5) * branchNoise,
        (random() - 0.5) * branchNoise,
      );
      if (pointIndex > 0 && pointIndex < 7) point.add(curl);
      return point;
    });
    return { activityIndex, controlPoints, intensity: 0.35 + random() * 0.65 };
  });

  return { coreNodes, paths };
}

function buildLine(path: NeuralPathData, activity: number): BuiltPath {
  const curve = new THREE.CatmullRomCurve3(path.controlPoints, false, "centripetal", 0.45);
  const points = curve.getPoints(44);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const colors = new Float32Array(points.length * 3);
  const coreColor = new THREE.Color().copy(electricTeal).lerp(hotOrange, activity);
  if (activity > 0.76) coreColor.lerp(hotRed, (activity - 0.76) / 0.24);
  for (let index = 0; index < points.length; index += 1) {
    const progress = index / Math.max(points.length - 1, 1);
    const color = coreColor.clone().lerp(progress > 0.5 ? outerBlue : fiberBlue, Math.pow(progress, 0.72));
    const brightness = 0.8 + activity * (1 - progress) * 1.5;
    colors[index * 3] = color.r * brightness;
    colors[index * 3 + 1] = color.g * brightness;
    colors[index * 3 + 2] = color.b * brightness;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.18 + path.intensity * 0.38 + activity * 0.24,
    transparent: true,
    vertexColors: true,
    toneMapped: false,
  });
  return { ...path, curve, line: new THREE.Line(geometry, material) };
}

function NeuralFibers({ neuronActivity }: Pick<LivingBrainCanvasProps, "neuronActivity">) {
  const groupRef = useRef<THREE.Group>(null);
  const activitySignature = neuronActivity.join(",");
  const activity = useMemo(() => normalizeNeuronActivity(neuronActivity), [activitySignature]);
  const web = useMemo(() => buildNeuralWeb(activity.length), [activity.length]);
  const builtPaths = useMemo(
    () => web.paths.map((path) => buildLine(path, activity[path.activityIndex] ?? 0)),
    [activitySignature, web],
  );

  useEffect(() => () => {
    for (const path of builtPaths) {
      path.line.geometry.dispose();
      (path.line.material as THREE.Material).dispose();
    }
  }, [builtPaths]);

  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.045;
    groupRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.12) * 0.08;
  });

  return (
    <group ref={groupRef} rotation={[0.1, -0.2, -0.08]}>
      {builtPaths.map((path, index) => <primitive key={index} object={path.line} />)}
      <CoreNodes activity={activity} positions={web.coreNodes} />
      <PropagationPulses activity={activity} paths={builtPaths} />
    </group>
  );
}

function CoreNodes({ activity, positions }: { activity: number[]; positions: THREE.Vector3[] }) {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry().setFromPoints(positions);
    next.setAttribute("color", new THREE.BufferAttribute(new Float32Array(positions.length * 3), 3));
    return next;
  }, [positions]);
  const workingColor = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const colorAttribute = geometry.getAttribute("color") as THREE.BufferAttribute;
    let peak = 0;
    for (let index = 0; index < positions.length; index += 1) {
      const activation = activity[index % activity.length] ?? 0;
      peak = Math.max(peak, activation);
      const flash = activation > 0.68 ? (Math.sin(clock.elapsedTime * (5 + activation * 11) + index) + 1) / 2 : 0;
      workingColor.copy(fiberBlue).lerp(hotOrange, activation);
      if (activation > 0.72) workingColor.lerp(hotRed, flash * activation);
      if (index % 4 === 0) workingColor.lerp(electricTeal, 0.55 + flash * 0.35);
      const brightness = 1.2 + activation * 2.1 + flash;
      colorAttribute.setXYZ(index, workingColor.r * brightness, workingColor.g * brightness, workingColor.b * brightness);
    }
    colorAttribute.needsUpdate = true;
    (points.material as THREE.PointsMaterial).size = 0.065 + peak * 0.045 + Math.sin(clock.elapsedTime * 5) * peak * 0.008;
  });

  return (
    <points ref={pointsRef} geometry={geometry} renderOrder={5}>
      <pointsMaterial
        blending={THREE.AdditiveBlending}
        depthTest={false}
        size={0.08}
        sizeAttenuation
        toneMapped={false}
        transparent
        vertexColors
      />
    </points>
  );
}

function PropagationPulses({ activity, paths }: { activity: number[]; paths: BuiltPath[] }) {
  const pointsRef = useRef<THREE.Points>(null);
  const pulsePaths = useMemo(() => paths.filter((_, index) => index % 3 === 0), [paths]);
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pulsePaths.length * 3), 3));
    next.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pulsePaths.length * 3), 3));
    return next;
  }, [pulsePaths]);
  const point = useMemo(() => new THREE.Vector3(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const positionAttribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colorAttribute = geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let index = 0; index < pulsePaths.length; index += 1) {
      const path = pulsePaths[index];
      const activation = activity[path.activityIndex] ?? 0;
      const progress = (clock.elapsedTime * (0.055 + activation * 0.22) + index * 0.173) % 1;
      path.curve.getPointAt(progress, point);
      positionAttribute.setXYZ(index, point.x, point.y, point.z);
      color.copy(electricTeal).lerp(hotOrange, activation);
      if (activation > 0.78) color.lerp(hotRed, (activation - 0.78) / 0.22);
      const brightness = 1.8 + activation * 3.2;
      colorAttribute.setXYZ(index, color.r * brightness, color.g * brightness, color.b * brightness);
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry} renderOrder={6}>
      <pointsMaterial
        blending={THREE.AdditiveBlending}
        depthTest={false}
        size={0.075}
        sizeAttenuation
        toneMapped={false}
        transparent
        vertexColors
      />
    </points>
  );
}

function Stardust() {
  const pointsRef = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const random = seededRandom(9917);
    const positions: number[] = [];
    const colors: number[] = [];
    for (let index = 0; index < 620; index += 1) {
      const direction = randomDirection(random);
      const radius = 2.8 + random() * 3.8;
      positions.push(direction.x * radius, direction.y * radius, direction.z * radius);
      const brightness = 0.25 + random() * 0.75;
      colors.push(0.02 * brightness, 0.42 * brightness, 0.8 * brightness);
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    next.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return next;
  }, []);

  useFrame((_, delta) => {
    if (pointsRef.current) pointsRef.current.rotation.y -= delta * 0.008;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        opacity={0.58}
        size={0.018}
        sizeAttenuation
        toneMapped={false}
        transparent
        vertexColors
      />
    </points>
  );
}

function LivingBrainScene({ neuronActivity }: Pick<LivingBrainCanvasProps, "neuronActivity">) {
  return (
    <>
      <color attach="background" args={["#000000"]} />
      <Stardust />
      <NeuralFibers neuronActivity={neuronActivity} />
      <EffectComposer multisampling={0}>
        <Bloom intensity={1.75} luminanceThreshold={0.18} luminanceSmoothing={0.3} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export function LivingBrainCanvas({ neuronActivity, className = "", compact = false }: LivingBrainCanvasProps) {
  return (
    <section
      aria-label="NexusHarness living brain visualization"
      className={`relative h-full w-full min-h-0 min-w-0 overflow-clip bg-black ${compact ? "rounded-md" : "rounded-lg"} ${className}`}
      role="img"
    >
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 100, position: [0, 0, 5.8] }}
        className="absolute inset-0 h-full w-full"
        dpr={[1, 2]}
        gl={{ alpha: false, antialias: true, powerPreference: "high-performance" }}
      >
        <LivingBrainScene neuronActivity={neuronActivity} />
      </Canvas>
      {!compact && <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 text-xs text-slate-300">
        <div className="rounded-md border border-cyan-300/20 bg-black/70 px-3 py-2 backdrop-blur-sm">
          <strong className="block text-sm font-semibold text-white">Living Memory Core</strong>
          Persistent conversations · active neural propagation
        </div>
        <span className="rounded-full border border-orange-300/25 bg-black/70 px-3 py-1.5 text-orange-200">
          {neuronActivity.length} active signals
        </span>
      </div>}
      <p className="sr-only">
        An organic spherical web of neural pathways. Cool blue outer fibers converge on orange, red, and teal firing nodes while pulse particles travel outward through the network.
      </p>
    </section>
  );
}

export default LivingBrainCanvas;
