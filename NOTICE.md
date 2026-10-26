# Notices and attribution

Drive Boston's code is MIT licensed (LICENSE). The world data under `data/` and
`src/generated/` is derived from the public sources below and carries their
terms. Nothing here is endorsed by any of the organisations named.

## Sources used by the Back Bay demo

| Source | Used for | Licence and attribution |
|---|---|---|
| OpenStreetMap | Street network (topology, names, one-way, classes, bridges, tunnels), water and park outlines | © OpenStreetMap contributors, Open Database License (ODbL) 1.0, https://www.openstreetmap.org/copyright. The derived road graph in this repository is a derivative database under the ODbL. |
| MassGIS 2025 Aerial Imagery (Bureau of Geographic Information, Commonwealth of Massachusetts, Executive Office of Technology and Security Services) | Ground and roof textures | Public records with no restrictions on use; MassGIS asks for acknowledgement. https://www.mass.gov/info-details/massgis-data-2025-aerial-imagery |
| USGS 3D Elevation Program, 1 m DEM (MA_CentralEastern_2021_B21) | Terrain | US Government work, public domain. https://www.usgs.gov/3d-elevation-program |
| City of Boston, Analyze Boston: Buildings with Roof Breaks, Sidewalk Inventory | Building footprints with ground and roof elevations; sidewalk polygons and curb lines | Open Data Commons Public Domain Dedication and License (PDDL). https://data.boston.gov |

## Sources planned for later phases

Boston street segments (SAM), MassDOT roads, Cambridge GIS, Somerville open
data, Boston Planning Department 3D models, Boston tree, hydrant, meter and
street light inventories, MassGIS hydrography, open space, land cover and MBTA
rapid transit lines, and MBTA GTFS. Each will be added to the table above with
its licence before any derived file is committed. GTFS-derived files will be
kept in their own folder under the MassDOT Developers License Agreement and the
game will carry no MBTA or MassDOT logos or trademarks.

## Software

three.js (MIT), Rapier (Apache-2.0), lil-gui (MIT), Vite (MIT), proj4js (MIT),
geotiff.js (MIT), earcut (ISC), sharp (Apache-2.0).
