# Pipeline report: backbay

Generated 2026-10-27. Box 42.344, 42.357, -71.092, -71.068; local rectangle x -2560..-256, z -256..1536 (9 x 7 chunks of 256 m).

## Terrain

- local 1 m grid 2304 x 1792, heights -4.0 to 31.7 m NAVD88, 0 cells filled
- water surface (modal height) 0.20 m

## Road graph

- 872 drivable OSM ways -> 1173 links, 884 nodes
- links by class: trunk_link 12, primary 367, residential 332, secondary 147, service 183, motorway_link 43, motorway 36, unclassified 14, trunk 20, primary_link 13, tertiary 2, secondary_link 4
- bridges 55, tunnels 27, one-way 775
- width from tag 435, lanes 584, class 154
- 3164 paths, 660 polygons (water 14, grass 512, paved 69, parking 58, rail 7), 28 rail lines
- 3 bridge nodes have no ground connection in the box (profile falls back to the DEM)
- 10 ground links beside bridges cross over a lower road and become decks

## Ground mask and curbs

- widths measured against sidewalks or walls on 749 of 1091 ground links
- 331 centrelines recentred between their curbs, median shift 0.8 m, largest 3.0 m
- 1702 sidewalk polygons, 7291 DEM water cells at 0.20 m, 1117 of them inside road corridors or sidewalk strips put back to lot
- road cells 775937, corner fill cells 25820, 5604 cells kept as walls between roads at different levels, 389 curb lines totalling 129.4 km
- ground under road surfaces: 15 of 1091 ground links have a drop of more than 0.4 m somewhere across their width, worst 0.83 m on (unnamed) at (-764, 937); 18 rise more than 0.4 m above the road along its centreline, worst 5.16 m on (unnamed) at (-1295, 900)
- 0 ground links pass more than 2.5 m over another road without a bridge tag, which dams the lower road
- ground classes: lot 11.2%, road 18.8%, sidewalk 6.8%, building 26.8%, water 20.6%, grass 11.7%, paved 2.7%, rail 0.6%, parking 0.8%

## Buildings

- 5465 source parts: 5352 kept, 27 skipped by type, 2 too small or low, 84 outside the box
- elevation datum: source ground (feet to metres) minus DEM has median -0.05 m, 10th to 90th percentile spread 1.27 m, over 4982 parts
- 61 parts without a city height take OpenStreetMap heights; 317 use 12 m; largest footprints without any height: 2853 m2, 1172 m2, 1100 m2, 582 m2, 562 m2
- styles: brickRed 2009, brickBrown 562, brownstone 1727, limestone 684, granite 115, painted 101, glass 101, concrete 53, plain 0

## Building models

- 6 tiles, 7679 catalogue rows, 2773 in the box (status: Current 2672, History 69, Approved Demo 15, Board Approved 7, Complete 6, Under Construction 4; type: Wall 1639, Building 1100, Bridge 17, Dock 17)
- 2648 models kept (Current, Complete or Under Construction; Building, Structure or Wall), 0 without usable geometry
- State Plane shift measured from the catalogue: east 731099.8 ft, north 2902903.2 ft (2nd to 98th percentile spread 4.1 and 4.2 ft)
- vertical datum: model ground (feet to metres) minus DEM has median -2.20 m, 10th to 90th percentile spread 2.54 m over 2648 models; 1957 floating models lowered onto the terrain
- 53 models standing mostly on the roadway dropped (60% or more of their footprint on road cells; 2619 m2 of road under them, tallest 27.9 m)
- 2595 models packed with 244807 vertices and 396212 triangles; 0 too large to quantise
- 4914 of 5352 footprint parts are covered by a model and will not be drawn (218 more are partly covered); 1757 models cover no footprint part
- styles: plain 1479, brickRed 426, brownstone 260, limestone 149, brickBrown 130, painted 65, granite 37, concrete 30, glass 19
- styled by name: Prudential Redevelopment (Parcel 4 and 6) (glass); John Hancock Tower: Restaurant/Retail/Parking (glass); 1 Dalton Street (glass); 1 Dalton Street (glass); Christian Science Church (limestone); Old South Church (brownstone); Trinity Church (brownstone); Boston Public Library (granite); 50 DALTON ST (glass); 67 CHURCH ST (brownstone); Arlington Street Church (brownstone); Liberty Mutual (glass); 52 CHURCH ST (brownstone); 16 CHURCH ST (brownstone); 45 CHURCH ST (brownstone); 34 CHURCH ST (brownstone)

## Street furniture

- 13566 items: tree 7189, lamp 3973, cobra 1330, signal 272, stop 79, bench 531, hydrant 192
- trees: 5373 from the city inventory (1741 in parks, 148 empty or planned sites skipped), 1816 more from OpenStreetMap
- lamps: 5143 from the city street light inventory, 160 more from OpenStreetMap; cobra heads over motorway, motorway_link, trunk, trunk_link and roads at least 13.5 m wide
- signals: 107 city intersections (4 without a junction within 30 m), 43 more from OpenStreetMap; 116 junctions, 272 poles
- 79 stop signs, 531 benches, 192 hydrants from OpenStreetMap
- 1842 items moved off the roadway, buildings or water (up to 3 m), 433 dropped

## Imagery

- 63 chunk textures of 512 px (0.50 m per pixel) from 357 tiles at zoom 18, 0 missing, 2.9 MB WebP

## Spawns

- spawn "Commonwealth Avenue at Dartmouth Street" -> Commonwealth Avenue from Dartmouth Street (one-way), heading 250
- spawn "Newbury Street at Exeter Street" -> Newbury Street from Exeter Street (one-way), heading 250
- spawn "Copley Square" -> Boylston Street from Dartmouth Street (one-way), heading 70
- spawn "Beacon Street at Clarendon Street" -> Beacon Street from Clarendon Street (one-way), heading 250
- spawn "Marlborough Street at Fairfield Street" -> Marlborough Street from Fairfield Street (one-way), heading 70
- spawn "Massachusetts Avenue at Marlborough Street" -> Massachusetts Avenue from Marlborough Street (two-way), heading 341
- spawn "Huntington Avenue at Belvidere Street" -> Huntington Avenue from Belvidere Street (one-way), heading 222
- spawn "Boylston Street at Berkeley Street" -> Boylston Street from Berkeley Street (one-way), heading 70
- spawn "Storrow Drive at the Esplanade" -> Storrow Drive (one-way), 0.3 m from the authored point, heading 244

## World file

- world file 11.34 MB raw, 4.05 MB gzipped
- arrays: heights 2020 kB, mask 4032 kB, nodeXYZ 10 kB, linkNodes 9 kB, linkPointStart 5 kB, linkPoints 72 kB, linkClass 1 kB, linkFlags 1 kB, linkWidth 5 kB, linkLanes 1 kB, linkName 2 kB, linkSpeed 5 kB, curbStart 2 kB, curbPoints 168 kB, partRingStart 21 kB, ringStart 21 kB, ringXZ 486 kB, partBase 21 kB, partRoof 21 kB, partStyle 5 kB, partSeed 10 kB, partFlags 5 kB, modelVertexStart 10 kB, modelIndexStart 10 kB, modelXYZ 1434 kB, modelIndex 2322 kB, modelOrigin 30 kB, modelStyle 3 kB, modelSeed 5 kB, modelName 5 kB, furnKind 13 kB, furnXYZ 159 kB, furnYaw 53 kB, furnSize 53 kB, furnSeed 26 kB
