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

## World file: `public/data/<box>/world.bin.gz`, format `driveboston-world` version 1

One file per box with everything the runtime needs except the imagery.

Header fields: `box` (name and lon/lat bounds), `frame` (origin and projection
string), `rect` (local rectangle in metres, snapped to chunks), `chunkM` (256),
`chunks` (count in x and z), `terrain` (`cellM` 2, `vertsX`, `vertsZ`,
`heightUnit` cm), `maskGrid` (`cellM` 1, `width`, `height`), `waterLevel`
(metres NAVD88), `datumShift` (metres subtracted from the city's building
elevations), `names` (string table for street names), `spawns` (name, x, y, z,
headingDeg, street), `imagery` (dir, pixelsPerChunk, zoom, format), `counts`.

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
| `partStyle` | u8 | Facade style: 0 red brick, 1 brown brick, 2 brownstone, 3 limestone, 4 granite, 5 painted, 6 glass, 7 concrete |
| `partSeed` | u16 | Per-part random seed |

## Imagery: `public/data/<box>/img/<cx>_<cz>.webp`

One square WebP per terrain chunk, `pixelsPerChunk` on a side, north at the
top, pixel (0, 0) at the chunk's minimum x and z. Warped from the MassGIS tile
service into the local frame, so a pixel maps to world coordinates affinely.
