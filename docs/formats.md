# Data formats

Every binary file under `data/` uses one container:

```
bytes 0..3    magic "DBW1" (Drive Boston World, version 1)
bytes 4..7    uint32 little-endian: byte length of the JSON header
bytes 8..     JSON header (UTF-8), padded with spaces to a multiple of 4 bytes
then          payload typed arrays, each 4-byte aligned, in the order the header lists them
```

The header always carries `format`, `version`, `box` (name and lon/lat bounds),
`frame` (origin and projection), `created` (ISO date) and `sources` (manifest
hashes), plus a `arrays` list of `{ name, type, length, byteOffset }` entries
with offsets relative to the start of the payload. Readers check `format` and
`version` and refuse anything they do not know.

Files are committed gzipped (`.bin.gz`) and inflated in the browser with
`DecompressionStream`.

Individual formats are documented here as they are added by the pipeline.

## World file: `public/data/<box>/world.bin.gz`, format `driveboston-world` version 3

One file per box with everything the runtime needs except the imagery.

Header fields: `box` (name and lon/lat bounds), `frame` (origin and projection
string), `rect` (local rectangle in metres, snapped to chunks), `chunkM` (256),
`chunks` (count in x and z), `terrain` (`cellM` 2, `vertsX`, `vertsZ`,
`heightUnit` cm), `maskGrid` (`cellM` 1, `width`, `height`), `waterLevel`
(metres NAVD88), `datumShift` (metres subtracted from the city's building
elevations), `names` (string table for street names), `spawns` (name, x, y, z,
headingDeg, street), `imagery` (dir, pixelsPerChunk, zoom, format), `models`
(`positionUnitM`, the source and release of the city's 3D building models and
the measured `shift` in State Plane feet and metres), `counts`.

Arrays, in order:

| Array | Type | Meaning |
|---|---|---|
| `heights` | i16 | Terrain vertex heights in centimetres, row-major `vertsZ` rows of `vertsX`; vertex (I, J) sits at x = rect.minX + 2I, z = rect.minZ + 2J. Roads are burned flat at their profile, sidewalks 15 cm above, water 40 cm below its plane |
| `mask` | u8 | Ground class per 1 m cell, row-major; cell (i, j) is centred at rect.minX + i + 0.5, rect.minZ + j + 0.5. Classes: 0 lot, 1 road, 2 sidewalk, 3 building, 4 water, 5 grass, 6 paved, 7 rail, 8 parking |
| `nodeXYZ` | f32 | Road graph nodes, x y z per node |
| `linkNodes` | u32 | Node index pairs (a, b) per link |
| `linkPointStart` | u32 | Start index into `linkPoints` per link, plus a final total |
| `linkPoints` | f32 | Link polylines, x y z per point, in the link's digitising direction (one-way links flow from a to b) |
| `linkClass` | u8 | Road class id (`ROAD_CLASS` in `src/shared/roads.ts`) |
| `linkFlags` | u8 | Bit 1 one-way, bit 2 bridge, bit 4 tunnel, bit 8 drivable |
| `linkWidth` | f32 | Curb-to-curb width in metres |
| `linkLanes` | u8 | Lane count |
| `linkName` | u16 | Index into `names` |
| `linkSpeed` | f32 | Speed limit in metres per second |
| `curbStart` | u32 | Start index into `curbPoints` per curb line, plus a final total |
| `curbPoints` | f32 | Curb polylines, x y z per point, y at road level (the curb top is 15 cm higher) |
| `partRingStart` | u32 | Start index into `ringStart` per building part, plus a final total |
| `ringStart` | u32 | Start index into `ringXZ` per ring, plus a final total; the first ring of a part is the outer ring |
| `ringXZ` | f32 | Ring vertices, x z per vertex. Outer rings have positive signed area in (x, z), holes negative |
| `partBase` | f32 | Bottom of the walls (metres), 40 cm below the lowest ground along the outline |
| `partRoof` | f32 | Roof elevation (metres) |
| `partStyle` | u8 | Facade style: 0 red brick, 1 brown brick, 2 brownstone, 3 limestone, 4 granite, 5 painted, 6 glass, 7 concrete, 8 plain (no windows) |
| `partSeed` | u16 | Per-part random seed |
| `partFlags` | u8 | Bit 1: covered by a building model; the part keeps its collider but is not drawn |
| `modelVertexStart` | u32 | Start vertex index into `modelXYZ` per building model, plus a final total |
| `modelIndexStart` | u32 | Start index into `modelIndex` per model, plus a final total |
| `modelXYZ` | i16 | Model vertices, x y z per vertex in units of `models.positionUnitM` (2 cm) relative to the model's origin |
| `modelIndex` | u16 | Triangle vertex indices local to each model, counter-clockwise seen from outside |
| `modelOrigin` | f32 | Origin per model, x y z; y is the lowest terrain under the model, where the facade's metres-up start |
| `modelStyle` | u8 | Facade style as for parts |
| `modelSeed` | u16 | Per-model random seed |
| `modelName` | u16 | Index into `names` (the city's catalogue name, usually an address) |
| `furnKind` | u8 | Street furniture kind: 0 tree, 1 pedestal lamp, 2 cobra-head lamp, 3 traffic signal, 4 stop sign, 5 bench, 6 hydrant |
| `furnXYZ` | f32 | Position per item, x y z; y is the burned ground height |
| `furnYaw` | f32 | Rotation about y in radians; the object's local +x faces this way (a signal or stop face looks at the traffic it addresses, a cobra arm reaches over the road) |
| `furnSize` | f32 | Tree height in metres, 1 for everything else |
| `furnSeed` | u16 | Per-item random seed |

Building models come from the Boston Planning Department's citywide 3D model
(OBJ release). Models whose status is Current, Complete or Under Construction
and whose type is Building, Structure or Wall are kept. Their coordinates are
State Plane feet with the city's shift applied; the pipeline measures that shift
from each catalogue as the median difference between the lon/lat centroids and
the shifted centroids, and measures the vertical datum the same way against the
lidar terrain. A model whose projected footprint lies mostly on road cells of
the ground mask is dropped, since the roadway there has been flattened. The
runtime groups each model's triangles into planar clusters
and derives the facade coordinates from them (`src/world/models.ts`).

Street furniture comes from the city's tree, street light and traffic signal
inventories and from OpenStreetMap nodes (trees, lamps, stop signs, benches,
hydrants). Signals are one pole per approach at every signalised junction, at
the right-hand curb beside the stop line. Items that would stand on the
roadway, in a building or in the water are moved onto the nearest open ground
within 3 m or dropped; `counts.furniture` is the item total. The runtime draws
each kind as one instanced mesh of merged primitives (`src/world/furniture.ts`).

## Imagery: `public/data/<box>/img/<cx>_<cz>.webp`

One square WebP per terrain chunk, `pixelsPerChunk` on a side, north at the
top, pixel (0, 0) at the chunk's minimum x and z. Warped from the MassGIS tile
service into the local frame, so a pixel maps to world coordinates affinely.
