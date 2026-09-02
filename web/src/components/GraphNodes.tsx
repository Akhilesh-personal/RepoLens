import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { primaryTag, tagColor, type GraphNode } from "shared";
import type { Vec3 } from "../lib/forceLayout";

const vertexShader = /* glsl */ `
  attribute float aPhase;
  attribute float aDim;
  attribute float aScale;
  attribute float aHighlight;
  attribute float aBirth;
  attribute vec3 aColor;
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform float uReduced;
  uniform float uFitRadius;
  varying vec3 vColor;
  varying float vOpacity;

  void main() {
    float bob = uReduced > 0.5 ? 0.0 : sin(uTime + aPhase) * aScale * 0.2;
    float grow = smoothstep(0.0, 0.6, uTime - aBirth);
    float scale = aScale * mix(1.0, 1.35, aHighlight) * mix(0.2, 1.0, grow);
    vec3 transformed = position * scale;
    vec4 world = instanceMatrix * vec4(transformed, 1.0);
    world.y += bob;
    gl_Position = projectionMatrix * viewMatrix * world;

    float dist = length(world.xyz - uCamPos);
    float nearD = uFitRadius * 0.5;
    float farD = max(uFitRadius * 8.0, nearD + 1.0);
    float fade = clamp(1.0 - (dist - nearD) / (farD - nearD), 0.14, 1.0);
    float desat = clamp(1.0 - (dist - nearD) / (farD - nearD), 0.0, 1.0);
    vec3 gray = vec3(dot(aColor, vec3(0.299, 0.587, 0.114)));
    vColor = mix(gray, aColor, desat);
    vOpacity = fade * aDim * grow;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    gl_FragColor = vec4(vColor, vOpacity);
  }
`;

const haloVertex = /* glsl */ `
  attribute float aPhase;
  attribute float aDim;
  attribute float aScale;
  attribute float aHighlight;
  attribute float aBirth;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uReduced;
  varying vec3 vColor;
  varying float vOpacity;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    float bob = uReduced > 0.5 ? 0.0 : sin(uTime + aPhase) * aScale * 0.2;
    float grow = smoothstep(0.0, 0.6, uTime - aBirth);
    vec3 worldCenter = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    worldCenter.y += bob;
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float s = aScale * mix(2.0, 2.5, aHighlight) * mix(0.2, 1.0, grow);
    vec3 world = worldCenter + (camRight * position.x + camUp * position.y) * s;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    vColor = aColor;
    vOpacity = aDim * 0.55 * grow;
  }
`;

const haloFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vOpacity;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    float alpha = smoothstep(1.0, 0.15, d) * vOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

interface GraphNodesProps {
  nodes: GraphNode[];
  positions: Record<string, Vec3>;
  dim: Float32Array;
  highlight: Float32Array;
  births: Float32Array;
  reducedMotion: boolean;
  meshRef: RefObject<THREE.InstancedMesh | null>;
  graphRadius: number;
  pickable?: boolean;
}

export function GraphNodes({
  nodes,
  positions,
  dim,
  highlight,
  births,
  reducedMotion,
  meshRef,
  graphRadius,
  pickable = true,
}: GraphNodesProps) {
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uReduced: { value: reducedMotion ? 1 : 0 },
      uFitRadius: { value: graphRadius },
    }),
    [reducedMotion],
  );

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const haloGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: true,
      }),
    [uniforms],
  );
  const haloMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  const extras = useMemo(() => {
    const count = nodes.length;
    const aColor = new Float32Array(count * 3);
    const aPhase = new Float32Array(count);
    const aScale = new Float32Array(count);
    const aDim = new Float32Array(count);
    const aHighlight = new Float32Array(count);
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const node = nodes[i]!;
      color.set(tagColor(primaryTag(node.tags)));
      aColor[i * 3] = color.r;
      aColor[i * 3 + 1] = color.g;
      aColor[i * 3 + 2] = color.b;
      aPhase[i] = hash(node.id) * Math.PI * 2;
      aScale[i] = radiusFor(node.size, graphRadius);
      aDim[i] = 1;
    }
    return { aColor, aPhase, aScale, aDim, aHighlight, count };
  }, [nodes, graphRadius]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    const halo = haloRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < nodes.length; i++) {
      const pos = positions[nodes[i]!.id] ?? { x: 0, y: 0, z: 0 };
      const x = Number.isFinite(pos.x) ? pos.x : 0;
      const y = Number.isFinite(pos.y) ? pos.y : 0;
      const z = Number.isFinite(pos.z) ? pos.z : 0;
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      halo?.setMatrixAt(i, dummy.matrix);
      color.set(tagColor(primaryTag(nodes[i]!.tags)));
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (halo) halo.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [nodes, positions, meshRef]);

  useLayoutEffect(() => {
    const n = Math.min(extras.aDim.length, dim.length);
    for (let i = 0; i < n; i++) extras.aDim[i] = dim[i]!;
    const hn = Math.min(extras.aHighlight.length, highlight.length);
    for (let i = 0; i < hn; i++) extras.aHighlight[i] = highlight[i]!;
    writeFloatAttr(meshRef.current, "aDim", extras.aDim);
    writeFloatAttr(haloRef.current, "aDim", extras.aDim);
    writeFloatAttr(meshRef.current, "aHighlight", extras.aHighlight);
    writeFloatAttr(haloRef.current, "aHighlight", extras.aHighlight);
    const colorAttr = meshRef.current?.instanceColor;
    if (colorAttr) colorAttr.needsUpdate = true;
  }, [dim, highlight, extras, meshRef]);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uCamPos.value.copy(state.camera.position);
    uniforms.uReduced.value = reducedMotion ? 1 : 0;
    uniforms.uFitRadius.value = graphRadius;
  });

  const count = Math.max(nodes.length, 1);

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, count]}
        frustumCulled={false}
        raycast={pickable && nodes.length ? undefined : () => undefined}
      >
        <instancedBufferAttribute attach="geometry-attributes-aColor" args={[extras.aColor, 3]} />
        <instancedBufferAttribute attach="geometry-attributes-aPhase" args={[extras.aPhase, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aScale" args={[extras.aScale, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aDim" args={[extras.aDim, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aHighlight" args={[extras.aHighlight, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aBirth" args={[births, 1]} />
      </instancedMesh>
      <instancedMesh
        ref={haloRef}
        args={[haloGeom, haloMat, count]}
        frustumCulled={false}
        raycast={() => undefined}
      >
        <instancedBufferAttribute attach="geometry-attributes-aColor" args={[extras.aColor, 3]} />
        <instancedBufferAttribute attach="geometry-attributes-aPhase" args={[extras.aPhase, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aScale" args={[extras.aScale, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aDim" args={[extras.aDim, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aHighlight" args={[extras.aHighlight, 1]} />
        <instancedBufferAttribute attach="geometry-attributes-aBirth" args={[births, 1]} />
      </instancedMesh>
    </>
  );
}

function radiusFor(sizeBytes: number, graphRadius: number): number {
  const logScale = Math.log(Math.max(sizeBytes, 1)) / Math.log(1e5);
  const value = graphRadius * 0.008 * Math.max(logScale, 0.5);
  return clamp(graphRadius * 0.004, value, graphRadius * 0.02);
}

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function writeFloatAttr(
  mesh: THREE.InstancedMesh | null,
  name: string,
  data: Float32Array,
): void {
  if (!mesh) return;
  const attr = mesh.geometry.getAttribute(name);
  if (!attr || !(attr.array instanceof Float32Array)) return;
  const n = Math.min(attr.array.length, data.length);
  for (let i = 0; i < n; i++) attr.array[i] = data[i]!;
  attr.needsUpdate = true;
}

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h >>> 0) / 4294967295;
}
