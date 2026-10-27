/** Street furniture kinds shared by the pipeline and the runtime. */
export const FURNITURE = { tree: 0, lamp: 1, cobra: 2, signal: 3, stop: 4, bench: 5, hydrant: 6 } as const;

export type FurnitureKind = keyof typeof FURNITURE;

export const FURNITURE_NAMES: FurnitureKind[] = Object.entries(FURNITURE)
  .sort((a, b) => a[1] - b[1])
  .map(([k]) => k as FurnitureKind);

/** Rotation about y (radians) that points an object's local +x axis along the world direction (dx, dz). */
export function yawFor(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}
