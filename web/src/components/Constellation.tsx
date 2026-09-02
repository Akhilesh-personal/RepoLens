import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  Vignette,
} from "@react-three/postprocessing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { computeLayout, sanitizePositions, type Vec3 } from "../lib/forceLayout";
import { boundingSphere } from "../lib/graphFit";
import {
  canonicalTag,
  fileName,
  type GraphNode,
  type GraphResponse,
  type Tag,
  type TagKey,
} from "shared";
import { CameraRig, type CameraCommand } from "./CameraRig";
import { GraphEdges } from "./GraphEdges";
import { GraphNodes } from "./GraphNodes";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

interface ConstellationProps {
  data: GraphResponse | null;
  interactive?: boolean;
  atmosphere?: boolean;
  ambient?: boolean;
  nodePicking?: boolean;
  selectedId?: string | null;
  hoveredId?: string | null;
  highlightTags?: ReadonlySet<TagKey>;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  onReset?: () => void;
  empty?: boolean;
}

export function Constellation(props: ConstellationProps) {
  const drag = useRef({ x: 0, y: 0, moved: false });
  const sceneReset = useRef<(() => void) | null>(null);
  return (
    <div
      className="relative h-full w-full"
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        if (dx * dx + dy * dy > 25) drag.current.moved = true;
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 8, 48], fov: 50, near: 0.1, far: 20000 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onPointerMissed={(event) => {
          if (drag.current.moved) return;
          if ("button" in event && event.button !== 0) return;
          const detail = "detail" in event ? Number(event.detail) : 1;
          if (detail >= 2) {
            sceneReset.current?.();
            return;
          }
          props.onReset?.();
        }}
      >
        <Scene {...props} sceneReset={sceneReset} />
      </Canvas>
      <HoverLabel />
    </div>
  );
}

const labelStore: { text: string; x: number; y: number; visible: boolean } = {
  text: "",
  x: 0,
  y: 0,
  visible: false,
};

function HoverLabel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        el.textContent = labelStore.text;
        el.style.opacity = labelStore.visible ? "1" : "0";
        el.style.transform = `translate3d(${labelStore.x}px, ${labelStore.y}px, 0) translate(-50%, -120%)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-10 font-mono text-[11px] text-[var(--text)] transition-opacity duration-150"
    />
  );
}

function placeholderNodes(): GraphNode[] {
  const tags: Tag[] = ["ai", "api", "ui", "data", "config", "util"];
  return Array.from({ length: 12 }, (_, i) => ({
    id: `void-${i}`,
    path: `star-${i}`,
    name: "",
    role: "",
    tags: [tags[i % tags.length]!],
    size: 800,
    folder: `region-${i % 4}`,
    depth: 1,
  }));
}

function Scene({
  data,
  interactive = true,
  atmosphere = false,
  ambient = false,
  nodePicking,
  selectedId = null,
  hoveredId = null,
  highlightTags,
  onHover,
  onSelect,
  onReset,
  empty = false,
  sceneReset,
}: ConstellationProps & { sceneReset: { current: (() => void) | null } }) {
  const picking = nodePicking ?? interactive;
  const reduced = usePrefersReducedMotion();
  const nodes = data?.nodes?.length ? data.nodes : empty || atmosphere ? placeholderNodes() : [];
  const edges = data?.nodes?.length ? (data.edges ?? []) : [];
  const [positions, setPositions] = useState<Record<string, Vec3> | null>(null);
  const [command, setCommand] = useState<CameraCommand | null>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastClick = useRef(0);
  const groupRef = useRef<THREE.Group>(null);
  const chroma = useMemo(() => new THREE.Vector2(0.0004, 0.0004), []);
  const birthsRef = useRef(new Map<string, number>());
  const proj = useRef(new THREE.Vector3());
  const hadSelection = useRef(false);

  const layoutKey = useMemo(
    () => `${nodes.map((n) => n.id).join("|")}|${edges.length}`,
    [nodes, edges.length],
  );

  useEffect(() => {
    if (nodes.length === 0) {
      setPositions({});
      return;
    }
    let cancelled = false;
    const payload = {
      nodes: nodes.map((n) => ({ id: n.id, folder: n.folder })),
      edges: edges.map((e) => ({ source: e.source, target: e.target })),
    };
    const ids = payload.nodes.map((n) => n.id);
    const apply = (raw: Record<string, Vec3>) => {
      const next = sanitizePositions(ids, raw);
      console.log(
        "[layout] sample",
        ids.slice(0, 3).map((id) => ({ id, ...next[id] })),
      );
      setPositions(next);
    };
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL("../lib/layout.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ positions: Record<string, Vec3> }>) => {
        if (!cancelled) apply(event.data.positions);
      };
      worker.onerror = () => {
        if (!cancelled) apply(computeLayout(payload.nodes, payload.edges));
      };
      worker.postMessage(payload);
    } catch {
      apply(computeLayout(payload.nodes, payload.edges));
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [layoutKey, nodes, edges]);

  const timeRef = useRef(0);

  const births = useMemo(() => {
    const t = timeRef.current;
    const arr = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i]!.id;
      if (!birthsRef.current.has(id)) {
        birthsRef.current.set(id, t);
      }
      arr[i] = birthsRef.current.get(id)!;
    }
    return arr;
  }, [nodes]);

  const { dim, highlight, edgeDim, edgeBirths } = useMemo(() => {
    const dimArr = new Float32Array(nodes.length);
    const hi = new Float32Array(nodes.length);
    const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const focusing = Boolean(highlightTags && highlightTags.size > 0);
    const ambientDim = ambient ? 0.35 : 1;
    const active = new Float32Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const matches = !focusing || nodeMatchesTags(node, highlightTags!);
      active[i] = matches ? 1 : 0;
      let d = focusing ? (matches ? 1 : 0.06) : ambientDim;
      if (hoveredId === node.id) d = 1;
      dimArr[i] = d;
      hi[i] = hoveredId === node.id ? 1 : 0;
    }
    const eDim = new Float32Array(Math.max(edges.length * 2, 1));
    const eBirth = new Float32Array(Math.max(edges.length * 2, 1));
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]!;
      const ai = idToIndex.get(edge.source);
      const bi = idToIndex.get(edge.target);
      const hoverEdge = hoveredId != null && (edge.source === hoveredId || edge.target === hoveredId);
      let d = ambientDim;
      if (focusing) {
        const aOn = ai != null && active[ai] === 1;
        const bOn = bi != null && active[bi] === 1;
        d = aOn && bOn ? 1 : 0.06;
      }
      if (hoverEdge) d = 3.2;
      eDim[i * 2] = d;
      eDim[i * 2 + 1] = d;
      const birth = Math.max(
        birthsRef.current.get(edge.source) ?? timeRef.current,
        birthsRef.current.get(edge.target) ?? timeRef.current,
      );
      eBirth[i * 2] = birth;
      eBirth[i * 2 + 1] = birth;
    }
    return { dim: dimArr, highlight: hi, edgeDim: eDim, edgeBirths: eBirth };
  }, [nodes, edges, hoveredId, highlightTags, ambient]);

  const fit = useMemo(() => boundingSphere(positions ?? {}), [positions]);

  const flyTo = useCallback(
    (id: string) => {
      const pos = positions?.[id];
      if (!pos) return;
      setCommand({ nonce: Date.now(), mode: "node", x: pos.x, y: pos.y, z: pos.z });
    },
    [positions],
  );

  useEffect(() => {
    if (!positions) return;
    if (selectedId && positions[selectedId]) {
      hadSelection.current = true;
      flyTo(selectedId);
      return;
    }
    if (!selectedId && hadSelection.current) {
      hadSelection.current = false;
      setCommand({ nonce: Date.now(), mode: "overview" });
    }
  }, [selectedId, positions, flyTo]);

  const handleReset = useCallback(() => {
    setCommand({ nonce: Date.now(), mode: "overview" });
    onReset?.();
  }, [onReset]);

  useEffect(() => {
    sceneReset.current = handleReset;
    return () => {
      sceneReset.current = null;
    };
  }, [handleReset, sceneReset]);

  useEffect(() => {
    if (!interactive) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCommand({ nonce: Date.now(), mode: "overview" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive]);

  useFrame((state, delta) => {
    timeRef.current = state.clock.elapsedTime;
    if (groupRef.current && !reduced && !selectedId) {
      groupRef.current.rotation.y += 0.02 * delta;
    }
    const hover = hoveredId ? nodes.findIndex((n) => n.id === hoveredId) : -1;
    if (hover >= 0 && positions) {
      const pos = positions[nodes[hover]!.id];
      if (pos) {
        proj.current.set(pos.x, pos.y, pos.z);
        if (groupRef.current) {
          proj.current.sub(groupRef.current.position);
          proj.current.applyQuaternion(groupRef.current.quaternion);
          proj.current.add(groupRef.current.position);
        }
        proj.current.project(state.camera);
        labelStore.visible = picking && Boolean(nodes[hover]!.name);
        labelStore.text = fileName(nodes[hover]!.path);
        labelStore.x = (proj.current.x * 0.5 + 0.5) * state.size.width;
        labelStore.y = (-proj.current.y * 0.5 + 0.5) * state.size.height;
      }
    } else {
      labelStore.visible = false;
    }
  });

  const onMeshClick = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive) return;
    event.stopPropagation();
    const nowClick = performance.now();
    if (nowClick - lastClick.current < 300) {
      handleReset();
      lastClick.current = 0;
      return;
    }
    lastClick.current = nowClick;
    const idx = event.instanceId;
    if (idx == null) return;
    const node = nodes[idx];
    if (node) {
      onSelect?.(node.id);
      flyTo(node.id);
    }
  };

  const onMeshMove = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    event.stopPropagation();
    const idx = event.instanceId;
    const id = idx == null ? null : (nodes[idx]?.id ?? null);
    onHover?.(id);
  };

  if (!positions) return null;

  return (
    <>
      <color attach="background" args={["#05060A"]} />
      <CameraRig
        command={command}
        reducedMotion={reduced}
        fit={fit}
        hasSelection={Boolean(selectedId)}
      />
      <group
        ref={groupRef}
        position={[fit.center.x, fit.center.y, fit.center.z]}
        scale={atmosphere ? 0.92 : 1}
      >
        <group position={[-fit.center.x, -fit.center.y, -fit.center.z]}>
          <group
            onClick={picking ? onMeshClick : undefined}
            onPointerMove={picking ? onMeshMove : undefined}
            onPointerOut={picking ? () => onHover?.(null) : undefined}
            onDoubleClick={
              picking
                ? (event) => {
                    event.stopPropagation();
                    handleReset();
                  }
                : undefined
            }
          >
            <GraphNodes
              nodes={nodes}
              positions={positions}
              dim={dim}
              highlight={highlight}
              births={births}
              reducedMotion={reduced}
              meshRef={meshRef}
              graphRadius={fit.radius}
              pickable={picking}
            />
          </group>
          <GraphEdges
            nodes={nodes}
            edges={edges}
            positions={positions}
            edgeDim={edgeDim}
            edgeBirths={edgeBirths}
            reducedMotion={reduced}
          />
        </group>
      </group>
      <EffectComposer enableNormalPass={false}>
        <Bloom intensity={0.6} luminanceThreshold={0.4} mipmapBlur />
        <DepthOfField focusDistance={0.02} bokehScale={3} />
        <ChromaticAberration offset={chroma} />
        <Vignette darkness={0.4} offset={0.3} />
      </EffectComposer>
    </>
  );
}

function nodeMatchesTags(node: GraphNode, activeTags: ReadonlySet<TagKey>): boolean {
  if (node.tags.length === 0) return activeTags.has("util");
  for (const tag of node.tags) {
    if (activeTags.has(canonicalTag(tag))) return true;
  }
  return false;
}

