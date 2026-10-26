# Pipeline report: backbay

Generated 2026-10-26. Box 42.344, 42.357, -71.092, -71.068; local rectangle x -2560..-256, z -256..1536 (9 x 7 chunks of 256 m).

## Terrain

- local 1 m grid 2304 x 1792, heights -4.0 to 31.7 m NAVD88, 0 cells filled
- water surface (modal height) 0.20 m

## Road graph

- 872 drivable OSM ways -> 1173 links, 884 nodes
- links by class: trunk_link 12, primary 367, residential 332, secondary 147, service 183, motorway_link 43, motorway 36, unclassified 14, trunk 20, primary_link 13, tertiary 2, secondary_link 4
- bridges 45, tunnels 27, one-way 775
- width from tag 1014, lanes 65, class 94
- 3164 paths, 660 polygons (water 14, grass 512, paved 69, parking 58, rail 7), 28 rail lines
- 3 bridge nodes have no ground connection in the box (profile falls back to the DEM)

## Ground mask and curbs

- widths measured against sidewalks or walls on 787 of 1101 ground links
- 1702 sidewalk polygons, 805275 DEM water cells at 0.20 m
- road cells 955023, corner fill cells 12956, 329 curb lines totalling 116.7 km
- ground classes: lot 10.4%, road 23.1%, sidewalk 5.6%, building 26.6%, water 20.5%, grass 10.4%, paved 2.3%, rail 0.4%, parking 0.7%

## Buildings

- 5465 source parts: 5352 kept, 27 skipped by type, 2 too small or low, 84 outside the box
- elevation datum: source ground (feet to metres) minus DEM has median -0.05 m, 10th to 90th percentile spread 1.27 m, over 4982 parts
- 61 parts without a city height take OpenStreetMap heights; 317 use 12 m; largest footprints without any height: 2853 m2, 1172 m2, 1100 m2, 582 m2, 562 m2
- styles: brickRed 2004, brickBrown 564, brownstone 1726, limestone 688, granite 117, painted 100, glass 100, concrete 53

## Imagery

- 63 chunk textures of 512 px (0.50 m per pixel) from 357 tiles at zoom 18, 0 missing, 2.9 MB WebP

## Spawns

- spawn "Commonwealth Avenue at Dartmouth Street" -> Commonwealth Avenue from Dartmouth Street (one-way), heading 250
- spawn "Newbury Street at Exeter Street" -> Newbury Street from Exeter Street (one-way), heading 250
- spawn "Copley Square" -> Boylston Street from Dartmouth Street (one-way), heading 70
- spawn "Beacon Street at Clarendon Street" -> Beacon Street from Clarendon Street (one-way), heading 250
- spawn "Marlborough Street at Fairfield Street" -> Marlborough Street from Fairfield Street (one-way), heading 70
- spawn "Massachusetts Avenue at Marlborough Street" -> Massachusetts Avenue from Marlborough Street (two-way), heading 340
- spawn "Huntington Avenue at Belvidere Street" -> Huntington Avenue from Belvidere Street (one-way), heading 222
- spawn "Boylston Street at Berkeley Street" -> Boylston Street from Berkeley Street (one-way), heading 70
- spawn "Storrow Drive at the Esplanade" -> Storrow Drive (one-way), 0.3 m from the authored point, heading 244

## World file

- world file 7.05 MB raw, 1.70 MB gzipped
- arrays: heights 2020 kB, mask 4032 kB, nodeXYZ 10 kB, linkNodes 9 kB, linkPointStart 5 kB, linkPoints 72 kB, linkClass 1 kB, linkFlags 1 kB, linkWidth 5 kB, linkLanes 1 kB, linkName 2 kB, linkSpeed 5 kB, curbStart 1 kB, curbPoints 129 kB, partRingStart 21 kB, ringStart 21 kB, ringXZ 486 kB, partBase 21 kB, partRoof 21 kB, partStyle 5 kB, partSeed 10 kB
