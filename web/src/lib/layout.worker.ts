import { computeLayout } from "./forceLayout";
import type { LayoutEdge, LayoutNode } from "shared";

type LayoutRequest = { nodes: LayoutNode[]; edges: LayoutEdge[] };

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const positions = computeLayout(event.data.nodes, event.data.edges);
  self.postMessage({ positions });
};
