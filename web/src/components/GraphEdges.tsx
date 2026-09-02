import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { primaryTag, tagColor, type GraphEdge, type GraphNode } from "shared";
import type { Vec3 } from "../lib/forceLayout";

const vertexShader = /* glsl */ `
  attribute float aT;
  attribute float aStagger;
  attribute float aDim;
  attribute float aPhase;
  attribute float aBirth;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uReduced;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vT;

  void main() {
    float bob = uReduced > 0.5 ? 0.0 : sin(uTime + aPhase) * 0.15;
    vec3 pos = position;
    pos.y += bob;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    float grow = smoothstep(0.0, 0.6, uTime - aBirth);
    float pulse = 0.0;
    if (uReduced < 0.5) {
      float trav = fract(uTime * 0.18 + aStagger);
      pulse = 0.04 * (1.0 - smoothstep(0.0, 0.12, abs(trav - aT)));
    }
    vColor = aColor;
    vOpacity = (0.10 + pulse) * aDim * grow;
    vT = aT;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    gl_FragColor = vec4(vColor, vOpacity);
  }
`;

interface GraphEdgesProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Record<string, Vec3>;
  edgeDim: Float32Array;
  edgeBirths: Float32Array;
  reducedMotion: boolean;
}

export function GraphEdges({
  nodes,
  edges,
  positions,
  edgeDim,
  edgeBirths,
  reducedMotion,
}: GraphEdgesProps) {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const index = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const packed = useMemo(() => {
    const n = edges.length;
    const positionsArr = new Float32Array(n * 2 * 3);
    const colors = new Float32Array(n * 2 * 3);
    const aT = new Float32Array(n * 2);
    const aStagger = new Float32Array(n * 2);
    const aPhase = new Float32Array(n * 2);
    const src = new THREE.Color();
    const dst = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const edge = edges[i]!;
      const a = positions[edge.source] ?? { x: 0, y: 0, z: 0 };
      const b = positions[edge.target] ?? { x: 0, y: 0, z: 0 };
      const i6 = i * 6;
      positionsArr[i6] = a.x;
      positionsArr[i6 + 1] = a.y;
      positionsArr[i6 + 2] = a.z;
      positionsArr[i6 + 3] = b.x;
      positionsArr[i6 + 4] = b.y;
      positionsArr[i6 + 5] = b.z;
      const srcNode = index.get(edge.source);
      const dstNode = index.get(edge.target);
      src.set(tagColor(primaryTag(srcNode?.tags)));
      dst.set(tagColor(primaryTag(dstNode?.tags)));
      colors[i6] = src.r;
      colors[i6 + 1] = src.g;
      colors[i6 + 2] = src.b;
      colors[i6 + 3] = dst.r;
      colors[i6 + 4] = dst.g;
      colors[i6 + 5] = dst.b;
      aT[i * 2] = 0;
      aT[i * 2 + 1] = 1;
      const stagger = (i % 97) / 97;
      aStagger[i * 2] = stagger;
      aStagger[i * 2 + 1] = stagger;
      aPhase[i * 2] = hash(edge.source);
      aPhase[i * 2 + 1] = hash(edge.target);
    }
    return { positionsArr, colors, aT, aStagger, aPhase };
  }, [edges, positions, index]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uReduced: { value: reducedMotion ? 1 : 0 },
    }),
    [reducedMotion],
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
      }),
    [uniforms],
  );

  const aDimBuf = useMemo(
    () => new Float32Array(Math.max(edges.length * 2, 1)),
    [edges.length],
  );

  useLayoutEffect(() => {
    const n = Math.min(aDimBuf.length, edgeDim.length);
    for (let i = 0; i < n; i++) aDimBuf[i] = edgeDim[i]!;
    const attr = geometryRef.current?.getAttribute("aDim");
    if (attr && attr.array instanceof Float32Array) {
      attr.array.set(aDimBuf);
      attr.needsUpdate = true;
    }
  }, [aDimBuf, edgeDim]);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uReduced.value = reducedMotion ? 1 : 0;
  });

  if (edges.length === 0) return null;

  return (
    <lineSegments frustumCulled={false}>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute attach="attributes-position" args={[packed.positionsArr, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[packed.colors, 3]} />
        <bufferAttribute attach="attributes-aT" args={[packed.aT, 1]} />
        <bufferAttribute attach="attributes-aStagger" args={[packed.aStagger, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[packed.aPhase, 1]} />
        <bufferAttribute attach="attributes-aDim" args={[aDimBuf, 1]} />
        <bufferAttribute attach="attributes-aBirth" args={[edgeBirths, 1]} />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </lineSegments>
  );
}

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) / 4294967295) * Math.PI * 2;
}
