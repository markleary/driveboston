/**
 * Facade styles the runtime material understands, shared by the pipeline
 * (which assigns them) and the renderer. `plain` is a wall without windows or
 * trim: garden walls, sheds, parapets and other low structures.
 */
export const STYLE = { brickRed: 0, brickBrown: 1, brownstone: 2, limestone: 3, granite: 4, painted: 5, glass: 6, concrete: 7, plain: 8 } as const;

export type StyleName = keyof typeof STYLE;

export function styleName(id: number): StyleName | 'unknown' {
  for (const [name, value] of Object.entries(STYLE)) if (value === id) return name as StyleName;
  return 'unknown';
}

/** Per-part flag bits in the world file's `partFlags`. */
export const PART_FLAG = {
  /** A city building model covers this footprint: keep the collider, do not draw the extrusion. */
  covered: 1,
} as const;
