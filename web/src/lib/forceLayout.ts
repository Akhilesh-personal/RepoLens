import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimNode,
} from "d3-force-3d";
import type { LayoutEdge, LayoutNode, Vec3 } from "shared";

export type { LayoutEdge, LayoutNode, Vec3 };

const TICKS = 300;
const SEED_SPAN = 4;

function folderCenters(folders: string[], radius: number): Map<string, Vec3> {
  const centers = new Map<string, Vec3>();
  const n = Math.max(folders.length, 1);
  folders.forEach((folder, i) => {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / n);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    centers.set(folder, {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi),
    });
  });
  return centers;
}

function seedOffset(): number {
  return (Math.random() - 0.5) * SEED_SPAN;
}

function finiteCoord(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sanitizePositions(
  ids: string[],
  raw: Record<string, Vec3> | null | undefined,
): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const id of ids) {
    const src = raw?.[id];
    out[id] = {
      x: finiteCoord(src?.x, seedOffset()),
      y: finiteCoord(src?.y, seedOffset()),
      z: finiteCoord(src?.z, seedOffset()),
    };
  }
  return out;
}

export function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Record<string, Vec3> {
  if (nodes.length === 0) return {};

  const small = nodes.length < 50;
  const charge = small ? -60 : -180;
  const linkDistance = small ? 18 : 40;
  const radial = small ? 10 : 28;
  const folderRadius = small ? 12 : 36;

  const simNodes: Array<SimNode & { folder: string; sx: number; sy: number; sz: number }> =
    nodes.map((node) => {
      const x = seedOffset();
      const y = seedOffset();
      const z = seedOffset();
      return {
        id: node.id,
        folder: node.folder,
        x,
        y,
        z,
        sx: x,
        sy: y,
        sz: z,
        vx: 0,
        vy: 0,
        vz: 0,
      };
    });

  const idSet = new Set(nodes.map((n) => n.id));
  const simLinks = edges
    .filter((edge) => idSet.has(edge.source) && idSet.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const tops = [
    ...new Set(simNodes.map((node) => node.folder.split("/")[0] || "_root")),
  ];
  const centers = folderCenters(tops, folderRadius);

  const simulation = forceSimulation(simNodes, 3)
    .numDimensions(3)
    .force("charge", forceManyBody().strength(charge))
    .force("link", forceLink(simLinks).id((d) => d.id).distance(linkDistance))
    .force("center", forceCenter(0, 0, 0))
    .force("radial", forceRadial(radial).strength(0.04))
    .force("folder", (alpha: number) => {
      const k = 0.06 * alpha;
      for (const node of simNodes) {
        const key = node.folder.split("/")[0] || "_root";
        const c = centers.get(key);
        if (!c) continue;
        node.vx += (c.x - node.x) * k;
        node.vy += (c.y - node.y) * k;
        node.vz += (c.z - node.z) * k;
      }
    })
    .alpha(1)
    .stop();

  for (let i = 0; i < TICKS; i++) simulation.tick();

  const positions: Record<string, Vec3> = {};
  for (const node of simNodes) {
    const x = finiteCoord(node.x, node.sx);
    const y = finiteCoord(node.y, node.sy);
    const z = finiteCoord(node.z, node.sz);
    if (x !== node.x || y !== node.y || z !== node.z) {
      console.warn("[layout] non-finite position", node.id, node.x, node.y, node.z);
    }
    positions[node.id] = { x, y, z };
  }
  return positions;
}
