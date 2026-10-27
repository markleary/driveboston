/**
 * Read-only state published on `window.__DRIVE_BOSTON__` for the browser tests
 * and the canvas inspector. Nothing in the game reads from it.
 */
export interface Diagnostics {
  ready: boolean;
  backend: string;
  frame: number;
  fps: { median: number; p95: number };
  car: { x: number; y: number; z: number; speedMph: number; headingDeg: number; street: string };
  render: { calls: number; triangles: number };
  physics: { bodies: number; colliders: number; stepMs: number };
  traffic: { cars: number; parked: number };
  errors: string[];
}

export interface TestHooks {
  teleport(x: number, z: number, headingDeg?: number): void;
  teleportTo(name: string): void;
  setCamera(mode: string): void;
  listSpawns(): string[];
  /** Overrides the keyboard with a scripted driving intent; null gives control back. */
  setIntent(intent: { throttle: number; steer: number; handbrake?: boolean; boost?: boolean } | null): void;
  /** Snaps the car back onto the nearest road. */
  resetToRoad(): void;
  /** x, z, dx, dz per traffic car. */
  trafficPoses(): number[];
  /** Ground mask class at a world position (1 is road). */
  groundClassAt(x: number, z: number): number;
  /** Raycasts from the game camera through a point in normalised device coordinates; the nearest hits, for debugging. */
  pick(nx: number, ny: number): { name: string; distance: number; point: [number, number, number]; faceIndex: number }[];
}

declare global {
  interface Window {
    __DRIVE_BOSTON__?: Diagnostics;
    __DRIVE_BOSTON_HOOKS__?: TestHooks;
  }
}

export function createDiagnostics(backend: string): Diagnostics {
  const d: Diagnostics = {
    ready: false,
    backend,
    frame: 0,
    fps: { median: 0, p95: 0 },
    car: { x: 0, y: 0, z: 0, speedMph: 0, headingDeg: 0, street: '' },
    render: { calls: 0, triangles: 0 },
    physics: { bodies: 0, colliders: 0, stepMs: 0 },
    traffic: { cars: 0, parked: 0 },
    errors: [],
  };
  window.__DRIVE_BOSTON__ = d;
  window.addEventListener('error', (e) => d.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => d.errors.push(String(e.reason)));
  return d;
}
