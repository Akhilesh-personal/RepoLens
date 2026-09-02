import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { fitDistance, type GraphFit } from "../lib/graphFit";

export type CameraCommand = {
  nonce: number;
  mode: "node" | "overview";
  x?: number;
  y?: number;
  z?: number;
};

interface CameraRigProps {
  command: CameraCommand | null;
  reducedMotion: boolean;
  fit: GraphFit;
  hasSelection: boolean;
}

function bezierEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.16;
  const y1 = 1;
  const x2 = 0.3;
  const y2 = 1;
  let x = t;
  for (let i = 0; i < 8; i++) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const slope = 3 * ax * x * x + 2 * bx * x + cx;
    const current = ((ax * x + bx) * x + cx) * x;
    if (Math.abs(current - t) < 1e-5 || Math.abs(slope) < 1e-6) break;
    x -= (current - t) / slope;
  }
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return ((ay * x + by) * x + cy) * x;
}

function perspective(camera: THREE.Camera): THREE.PerspectiveCamera | null {
  if (camera instanceof THREE.PerspectiveCamera) return camera;
  return null;
}

function applyClipAndZoom(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl,
  fit: GraphFit,
): number {
  const distance = fitDistance(fit.radius, camera.fov);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 10;
  camera.updateProjectionMatrix();
  controls.minDistance = fit.radius * 0.4;
  controls.maxDistance = distance * 3;
  return distance;
}

function snapToFit(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl,
  fit: GraphFit,
  distance: number,
): void {
  camera.position.set(fit.center.x, fit.center.y, fit.center.z + distance);
  camera.lookAt(fit.center.x, fit.center.y, fit.center.z);
  controls.target.set(fit.center.x, fit.center.y, fit.center.z);
  controls.update();
}

export function CameraRig({ command, reducedMotion, fit, hasSelection }: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera } = useThree();
  const fromPos = useRef(new THREE.Vector3());
  const toPos = useRef(new THREE.Vector3());
  const fromTarget = useRef(new THREE.Vector3());
  const toTarget = useRef(new THREE.Vector3());
  const tmp = useRef(new THREE.Vector3());
  const flying = useRef(false);
  const start = useRef(0);
  const lastNonce = useRef(-1);
  const appliedKey = useRef<string | null>(null);
  const [controlsReady, setControlsReady] = useState(false);
  const [zoom, setZoom] = useState({ min: 6, max: 160 });

  const assignControls = useCallback((node: OrbitControlsImpl | null) => {
    controlsRef.current = node;
    setControlsReady(Boolean(node));
  }, []);

  const fitKey = `${fit.center.x.toFixed(3)}|${fit.center.y.toFixed(3)}|${fit.center.z.toFixed(3)}|${fit.radius.toFixed(3)}`;

  useLayoutEffect(() => {
    const persp = perspective(camera);
    const controls = controlsRef.current;
    if (!persp || !controls) return;
    const distance = applyClipAndZoom(persp, controls, fit);
    setZoom((prev) => {
      const min = fit.radius * 0.4;
      const max = distance * 3;
      if (prev.min === min && prev.max === max) return prev;
      return { min, max };
    });
    if (appliedKey.current === fitKey) return;
    appliedKey.current = fitKey;
    if (hasSelection) return;
    snapToFit(persp, controls, fit, distance);
    flying.current = false;
  }, [camera, controlsReady, fit, fitKey, hasSelection]);

  useLayoutEffect(() => {
    if (!command || command.nonce === lastNonce.current) return;
    lastNonce.current = command.nonce;
    const controls = controlsRef.current;
    const persp = perspective(camera);
    if (!controls || !persp) return;

    fromPos.current.copy(camera.position);
    fromTarget.current.copy(controls.target);

    switch (command.mode) {
      case "overview": {
        const distance = applyClipAndZoom(persp, controls, fit);
        toPos.current.set(fit.center.x, fit.center.y, fit.center.z + distance);
        toTarget.current.set(fit.center.x, fit.center.y, fit.center.z);
        break;
      }
      case "node": {
        const node = tmp.current.set(command.x ?? 0, command.y ?? 0, command.z ?? 0);
        toTarget.current.copy(node);
        const dir = camera.position.clone().sub(node);
        if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
        dir.normalize().multiplyScalar(Math.max(fit.radius * 0.5, 4));
        toPos.current.copy(node).add(dir);
        break;
      }
      default: {
        const _exhaustive: never = command.mode;
        return _exhaustive;
      }
    }

    if (reducedMotion) {
      camera.position.copy(toPos.current);
      controls.target.copy(toTarget.current);
      controls.update();
      flying.current = false;
      return;
    }

    flying.current = true;
    start.current = -1;
  }, [command, camera, reducedMotion, fit]);

  useFrame((state) => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.enabled = true;
    if (!flying.current) return;
    if (start.current < 0) start.current = state.clock.elapsedTime;
    const t = (state.clock.elapsedTime - start.current) / 0.9;
    const e = bezierEase(Math.min(1, t));
    camera.position.lerpVectors(fromPos.current, toPos.current, e);
    controls.target.lerpVectors(fromTarget.current, toTarget.current, e);
    controls.update();
    if (t >= 1) flying.current = false;
  });

  return (
    <OrbitControls
      ref={assignControls}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      minDistance={zoom.min}
      maxDistance={zoom.max}
    />
  );
}
