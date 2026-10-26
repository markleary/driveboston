import type { LonLatBox } from '../src/shared/frame.ts';

export const BOXES: Record<string, LonLatBox> = {
  backbay: { name: 'backbay', south: 42.344, north: 42.357, west: -71.092, east: -71.068 },
  slice: { name: 'slice', south: 42.344, north: 42.366, west: -71.092, east: -71.05 },
};

export function getBox(name: string): LonLatBox {
  const box = BOXES[name];
  if (!box) throw new Error(`unknown box "${name}"; known: ${Object.keys(BOXES).join(', ')}`);
  return box;
}
