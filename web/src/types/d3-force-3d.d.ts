declare module "d3-force-3d" {
  export interface SimNode {
    id: string;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    folder?: string;
    [key: string]: unknown;
  }

  export interface SimLink {
    source: string | SimNode;
    target: string | SimNode;
  }

  export interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[]) => void;
    strength(s: number | ((d: N) => number)): this;
    distance(d: number | ((d: SimLink) => number)): this;
    id(fn: (d: N) => string): this;
    radius(r: number): this;
  }

  export interface Simulation<N extends SimNode> {
    force(name: string, force: Force<N> | ((alpha: number) => void) | null): this;
    stop(): this;
    tick(iterations?: number): this;
    nodes(): N[];
    numDimensions(n: number): this;
    alpha(n: number): this;
  }

  export function forceSimulation<N extends SimNode>(
    nodes?: N[],
    numDimensions?: number,
  ): Simulation<N>;
  export function forceManyBody<N extends SimNode>(): Force<N>;
  export function forceLink<N extends SimNode>(links?: SimLink[]): Force<N>;
  export function forceCenter<N extends SimNode>(
    x?: number,
    y?: number,
    z?: number,
  ): Force<N>;
  export function forceRadial<N extends SimNode>(
    radius: number,
    x?: number,
    y?: number,
    z?: number,
  ): Force<N>;
}
