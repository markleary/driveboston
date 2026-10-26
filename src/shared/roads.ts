/** Road classes shared by the pipeline and the runtime. Widths are curb to curb in metres. */
export const ROAD_CLASS = {
  motorway: { id: 0, width: 11, lanes: 3, laneWidth: 3.6, parking: false, speedMph: 55, paint: 'highway' },
  motorway_link: { id: 1, width: 6.5, lanes: 1, laneWidth: 4, parking: false, speedMph: 35, paint: 'highway' },
  trunk: { id: 2, width: 10, lanes: 2, laneWidth: 3.5, parking: false, speedMph: 40, paint: 'highway' },
  trunk_link: { id: 3, width: 6, lanes: 1, laneWidth: 4, parking: false, speedMph: 30, paint: 'highway' },
  primary: { id: 4, width: 16, lanes: 4, laneWidth: 3.3, parking: true, speedMph: 25, paint: 'arterial' },
  primary_link: { id: 5, width: 7, lanes: 1, laneWidth: 3.5, parking: false, speedMph: 25, paint: 'arterial' },
  secondary: { id: 6, width: 13, lanes: 2, laneWidth: 3.3, parking: true, speedMph: 25, paint: 'arterial' },
  secondary_link: { id: 7, width: 7, lanes: 1, laneWidth: 3.5, parking: false, speedMph: 25, paint: 'arterial' },
  tertiary: { id: 8, width: 12, lanes: 2, laneWidth: 3.3, parking: true, speedMph: 25, paint: 'street' },
  tertiary_link: { id: 9, width: 7, lanes: 1, laneWidth: 3.5, parking: false, speedMph: 25, paint: 'street' },
  unclassified: { id: 10, width: 10, lanes: 2, laneWidth: 3.3, parking: true, speedMph: 25, paint: 'street' },
  residential: { id: 11, width: 11, lanes: 2, laneWidth: 3.3, parking: true, speedMph: 25, paint: 'street' },
  living_street: { id: 12, width: 8, lanes: 1, laneWidth: 3.3, parking: true, speedMph: 15, paint: 'none' },
  service: { id: 13, width: 6, lanes: 1, laneWidth: 3, parking: false, speedMph: 15, paint: 'none' },
} as const;

export type RoadClassName = keyof typeof ROAD_CLASS;

export const ROAD_CLASS_BY_ID: RoadClassName[] = Object.entries(ROAD_CLASS)
  .sort((a, b) => a[1].id - b[1].id)
  .map(([k]) => k as RoadClassName);

/** Link flag bits stored in the world file. */
export const LINK_FLAG = { oneway: 1, bridge: 2, tunnel: 4, drivable: 8 } as const;

/** Ground classes in the 1 m mask. */
export const GROUND = { lot: 0, road: 1, sidewalk: 2, building: 3, water: 4, grass: 5, paved: 6, rail: 7, parking: 8 } as const;
