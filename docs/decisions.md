# Decisions

The direction of Drive Boston, in short. Changes go through the log at the end.

## D1. Free and open data only
Sources: MassGIS, USGS 3DEP, Analyze Boston, Cambridge and Somerville open data,
MBTA GTFS, OpenStreetMap. Every input is recorded in a manifest with URL, date,
size, hash and licence. Nothing from any metered map API. Hosting may be paid if
the free limits ever stand between the project and realism; data never is.

## D2. Imagery: aerial on the ground and roofs, procedural facades
The terrain is textured from public-domain MassGIS aerial imagery, blended with
procedural asphalt and concrete on roads and sidewalks so the surface holds up
near the camera. Roofs project the same imagery straight down. Facades are
procedural materials with Boston types and palettes; OpenStreetMap tags for
material, colour and storeys win where present. No street-level photography.

## D3. Physics: Rapier
A dynamic rigid body with a ray-cast vehicle controller for the player car,
tuned for arcade feel. Static world: a heightfield per terrain chunk, curbs as
low boxes, buildings as trimeshes per chunk, bridge decks as trimeshes.
Fixed 60 Hz step with an accumulator.

## D4. Renderer
three.js WebGPURenderer with node materials; WebGL 2 fallback kept working and
tested at every phase gate. WebGPU-only features only behind a capability check.

## D5. Stack
Vite, TypeScript, pinned dependencies, Vitest and Playwright, Node 24, GitHub
Actions to GitHub Pages. No backend.

## D6. Coordinate frame
A local transverse Mercator frame centred on Park Street station (42.3564 N,
71.0625 W): x east, z south, y up in metres NAVD88. All inputs are reprojected
in the pipeline; the frame is frozen in `tools/frame.json`.

## D7. Offline pipeline, committed data
Node scripts in `tools/` download raw data into the ignored `data/raw/` and
write versioned binary files under `data/` (pre-gzipped) and `src/generated/`.
Each step writes a report under `docs/reports/`.

## D8. The car
A generic four-door sedan built procedurally in code, with made-up plates and no
manufacturer marks.

## D9. Audio
Sound assets generated offline and committed; a small Web Audio manager at
runtime. Not in the proof of concept.

## D10. Runtime architecture
TypeScript modules with explicit ownership and no globals. Update order: input,
physics, simulation, camera, UI, render. One seeded random generator.

## D11. Target platform
A desktop or laptop with a capable GPU. Mobile and touch are a bonus, never a
gate. Reference machine: Apple M-series laptop at 1440p.

## D12. Phasing
Proof of concept first: Back Bay only, with real streets and curbs, real
buildings at their heights, aerial ground, one car, a chase camera and a HUD.
Traffic, pedestrians, transit, landmarks, time of day, audio, the map and other
modes follow on the same foundation.

## D13. Licences and attribution
Code MIT. NOTICE.md lists every data source with its licence and attribution.
OSM-derived geometry is marked as an ODbL derivative database.

## D14. Runtime world construction
The 2 m terrain grid is the ground for both rendering and physics: one mesh and
one Rapier heightfield collider per 256 m chunk, with roads burned flat at
their profiles and sidewalks 15 cm higher. Buildings are extruded at load time
from their footprint rings (walls plus an earcut roof) into one mesh and one
triangle-mesh collider per chunk, so the data file stays small. Curbs are a
granite face and a top strip along the traced curb lines. Bridge decks are
separate slabs with parapets and piers that follow the link profile, and the
terrain keeps the real cut or water underneath so underpasses stay drivable.
Tunnels are not drivable in the proof of concept.

## D15. Ground shading by class, imagery only where it helps
The 1 m ground-class mask (stored as road, sidewalk, grass and water weights so
edges blend) picks the surface. Roads are pure procedural asphalt. Sidewalks
and lots are procedural concrete and paving that take only a desaturated hint
of a coarse mip of the imagery: enough to tell a brick block from a concrete
one, too little for parked cars and building shadows to read as ground detail.
Grass and water keep the imagery for its paths and canopies. The first build
used the imagery as the base colour everywhere and kept its bright pixels on
roads as paint; that looked like driving on a satellite photo, which is why the
roads moved to D17.

## D16. Car model in physics
Rapier's raycast vehicle controller on a cuboid chassis with the centre of mass
lowered, the car's forward axis along +x (the controller's default) and the
compass heading mapped onto it. Brake values are Rapier's per-step impulse caps,
not newtons, and are tuned by measurement.

## D17. Road surfaces and paint from the road graph
Each drivable link is a ribbon mesh laid 3 cm above the burned terrain (5 cm on
bridge decks), four vertices across, carrying its half width, lane width, lane
count, one-way flag, distance along the link and its end treatments as vertex
attributes. The material draws the paint analytically from those attributes
with screen-space anti-aliasing: a double yellow centre line on two-way
streets, dashed white lane dividers, a parking-lane edge line where the width
leaves room, zebra crosswalks and stop lines where a link meets a major cross
street, and nothing where the same street simply continues. Ribbons stop short
of a junction by the crossing street's half width so they never overlap, and
the terrain's road class shares one world-space asphalt with the ribbons so the
junction fill matches. There is no paint texture atlas and no geometry per
marking.

## D18. Road widths from lanes and curbs, not width tags
OpenStreetMap width tags in Back Bay are unreliable (Commonwealth Avenue's
spans the mall), so a link's width is its lane count times the class lane width
plus 2.2 m per parking side, and a tag is accepted only within 0.6 to 1.6 times
that. The ground burn then measures the real curb-to-curb width from the
sidewalk data on each side, clamps it, and shifts the centreline sideways by up
to 3 m so the burn and the ribbon sit centred between the curbs (331 links
moved, median 0.8 m). Grass, plaza, parking and rail cells stop the width
measurement so a street cannot swallow a mall.

## D19. Approach decks at cuts
Ground links within 40 m of a bridge node take a straight profile from that
node, and a ground link whose profile rises more than 2.5 m above another road
it overlaps becomes a deck. The Massachusetts Avenue approaches over the
Commonwealth Avenue cut are therefore decks rather than terrain ramps, which
removes the 80 cm steps the burn produced where the ramp met the cut.

## D20. Corridor ownership in the terrain burn
A ground cell belongs to the road whose corridor holds it. Corridors at one
level that overlap, as at a junction, blend their levels by how deep the cell
sits in each, so junction surfaces are continuous; between corridors a cell
belongs to the nearest road. Roads more than a metre apart in level are kept
apart: inside a street's corridor the street keeps its level even when a lower
ramp's centreline is closer; where corridors overlap, as at a tunnel portal,
the higher road wins; the higher road's sidewalk strip claims the lower
corridor's cells beside it, so the wall stands 3 m out from the curb rather
than where the 2 m physics grid would smear it into the edge lane; and the
strip between two such corridors is never filleted into one surface. The first
burn gave every cell the nearest centreline's level and smoothed over 12 m,
which carved the Turnpike on-ramp's trench 5 m deep into Huntington Avenue's
right lane and did the same along the cut at Boylston Street, Clarendon
Street, Dalton Street and Massachusetts Avenue. The pipeline now checks the
burned ground against every road's surface across its full width and reports
the drops, and the test that finds hydro-flattened river cells in the lidar no
longer counts inside road corridors, where a trench at the river's level is a
ramp.

## D21. Real building meshes from the city's 3D model
The Boston Planning Department publishes a citywide 3D building model as OBJ
tiles under the PDDL. The pipeline reads the tiles the box touches, keeps the
models that stand today (Current, Complete or Under Construction; Building,
Structure or Wall), measures the city's State Plane shift from each catalogue
rather than assuming it, measures the vertical datum against the lidar terrain
the same way and lowers models that still float, and packs each model's
triangles into the world file at 2 cm precision about its own origin. The
runtime groups a model's triangles into planar clusters and feeds them to the
same facade shader as the extrusions, so Trinity Church, the Hancock tower and
the Commonwealth Avenue mansards keep their shapes while the brick, stone and
glass stay procedural. Footprint parts a model covers keep their colliders but
are not drawn. The city's data has ramp walls, barriers and misplaced pieces
on the flattened roadways, so a model standing mostly on road cells is dropped
and counted in the report. Facade styles come from the covered footprint, or
from the catalogue name for a few landmarks.

## D22. Street furniture from the inventories
Trees, lamps and traffic signals stand where the city's inventories put them
(BPRD Trees with species and trunk size, Street Lights, Traffic Signals), with
OpenStreetMap nodes filling gaps and supplying stop signs, benches and
hydrants. The pipeline sets each item on the burned ground, moves anything
that lands on the roadway, in a building or in the water onto the nearest open
cell within 3 m or drops it, and turns each signalised intersection point into
one pole with a mast arm per approach at the right-hand curb beside the stop
line. Lamps along the highway ramps and the widest roads are tall cobra heads
leaning over the road; the rest are pedestal lamps, which is what the avenues
have. The runtime draws each kind as one instanced mesh of
merged primitives with vertex colours and gives trunks and posts cylinder
colliders, so the car stops at a tree instead of passing through it.

## D23. Traffic and parked cars on the road graph
Other cars are the cheapest thing that makes a street feel lived in. Traffic
cars follow the road links in a lane offset from the centreline (right of
travel; one-way streets spread their lanes across the width, and the parking
lane stays free), keep a gap to the car ahead on the same link, slow for
turns and for the player when any part of their car is in the lane ahead, and
at each junction pick the next link with a weight that favours carrying
straight on and staying on the same street, never entering a one-way link
against its flow or a link that leaves the box. A car with nowhere to go, or
one stopped for twenty seconds out of the player's sight, reappears on a
random street, weighted by length, away from the player. Each car is a
dynamic body in a collision group that touches only the player, so cars pass
through each other and the kerbside cars at no solver cost; every step its
velocity is set to carry it along its path at the car's speed and sideways at
a capped rate to merge into its lane. The player can bump them: a car pushed
from behind rolls with the push and its path catches up to the body, while a
car pushed backwards or held stops where it is and starts again from rest,
never driving backwards or sideways into the player, so a car the player
leans on is a stopped car, not a bulldozer. Parked cars line both curbs of
every drivable street whose class allows parking and that is at least 9 m
wide, one slot per 6.5 m at half occupancy, facing the flow on their side, as
fixed box colliders and low-detail instanced meshes grouped per 512 m cell so
the frustum culls distant blocks; they cast no shadows (a dark patch under
each stands in) because four thousand shadow casters doubled the triangle
count. Rejected: kinematic bodies for traffic (the first build; a kinematic
car meeting the player's wheels threw the player to 190 mph), forces or
joints to drive the bodies (the set velocity is stable in numbers and the
path keeps every car exactly in its lane), a lane graph from OpenStreetMap
lanes tags (too thin in Back Bay), and streaming parked cars around the
player (deferred until the fixed colliders cost more than the 3 ms physics
step they do now).

## D24. Minimap from the ground mask, ambient occlusion, and a controls line
The minimap is the ground mask drawn once at one pixel per metre and blitted
heading-up around the car every other frame, with traffic as dots and the car
as a chevron. It needs no extra data and shows exactly what the ground
collides as, so a road on the map is a road under the wheels. The HUD keeps
to three things the player needs while driving (speed, street, next cross
street) plus a controls line that fades after fourteen seconds and comes back
with the HUD toggle. On the WebGPU path one scene pass also writes normals
and depth for ground-truth ambient occlusion at half resolution, multiplied
into the colour, which darkens the creases where walls meet the ground and
cars meet the road that the sun's shadow map leaves flat (`?ao=0` turns it
off). That pass cannot be multisampled, since WebGPU has no gather from a
multisampled depth texture, so with occlusion on the edges are smoothed by
FXAA after tone mapping instead of by MSAA. Rejected: a tile map (another
download and licence for no more truth), street-name labels on the minimap
(unreadable at this size).

## D25. Sound generated once, played from files
The engine is two ElevenLabs loops (idle and mid revs) crossfaded and pitched
by a simulated five-speed gearbox that shifts with speed, over a road-noise
loop that rises with speed, a tyre scrub loop while cornering hard or sliding
on the handbrake, two impact thuds scaled by the change in velocity, a horn
and a neighbourhood ambience bed that drops at speed. The eight clips were
generated with the API key from the local environment and committed as MP3s
with their prompts, lengths and checksums in `public/audio/provenance.json`,
so the game needs no key and no service at runtime; the audio model is
adapted from the owner's other Boston prototype. Web Audio starts on the first
key or pointer gesture, as browsers require, and the master gain closes while
the tab is hidden or the game is paused or muted. Rejected: synthesised engine
audio (oscillators never sound like a car), per-car traffic audio (dozens of
sources for little gain; the ambience bed stands in).

## Log

| Date | Change | Why |
|---|---|---|
| 2026-10-26 | Initial decisions | Project start |
| 2026-10-26 | Proof of concept scoped to Back Bay with the basics only | Get something playable early, then grow it |
| 2026-10-26 | Road graph built from OpenStreetMap ways first; city centreline and MassDOT joins deferred | OSM carries node topology, one-way flags and bridge and tunnel tags in one network |
| 2026-10-26 | Paid hosting acceptable if free limits constrain realism; desktop GPU is the target platform | Owner's direction |
| 2026-10-26 | Runtime: heightfield terrain, runtime building extrusion, bridge decks, imagery-plus-class ground shading | Back Bay demo (P1) built and driven by the bot |
| 2026-10-26 | Driving browser tests run only on a machine with a GPU; hosted CI keeps the smoke tests, served from the production build, with long waits | GitHub runners render in software below 1 fps, so the fixed-step simulation falls into slow motion and timed driving means nothing there; the 28-minute run also burned Actions minutes |
| 2026-10-26 | Roads became ribbons with analytic paint; widths from lanes and measured curbs with recentring; approach decks at the Mass Ave cut; imagery kept only for grass, water, roofs and a tint | Owner's review of the demo: the roads read as a satellite photo, with terrain where the surface should be flat |
| 2026-10-27 | Terrain burn resolves roads at different levels by corridor ownership, with walls between them; road-surface scan in the pipeline report | The owner fell into a 5 m pit on Huntington Avenue where the Turnpike on-ramp's trench had been burned into the street |
| 2026-10-27 | Real building meshes from the city's 3D model replace the extrusions they cover; models standing on the roadway are dropped | The owner compared the demo with a second prototype whose landmarks read as themselves; extruded footprints could not |
| 2026-10-27 | Street furniture placed from the city inventories and OpenStreetMap, instanced at runtime | Visible layer: the streets were bare |
| 2026-10-27 | Traffic on the road graph as velocity-driven dynamic bodies, and parked cars along the curbs, instanced | Visible layer: empty streets read as a model, not a city; kinematic bodies launched the car |
| 2026-10-27 | Heading-up minimap from the ground mask; ambient occlusion on WebGPU; controls line in the HUD | Visible layer: no sense of place beyond the street name, and flat creases |
| 2026-10-27 | Engine, skid, impact, horn and ambience sounds generated with ElevenLabs and played through Web Audio | Visible layer: silence |
