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

## Log

| Date | Change | Why |
|---|---|---|
| 2026-10-26 | Initial decisions | Project start |
| 2026-10-26 | Proof of concept scoped to Back Bay with the basics only | Get something playable early, then grow it |
| 2026-10-26 | Road graph built from OpenStreetMap ways first; city centreline and MassDOT joins deferred | OSM carries node topology, one-way flags and bridge and tunnel tags in one network |
| 2026-10-26 | Paid hosting acceptable if free limits constrain realism; desktop GPU is the target platform | Owner's direction |
