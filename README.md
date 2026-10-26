# Drive Boston

A browser driving game set in the real streets of Boston. The street network,
curbs, building footprints and heights come from public geographic data; the
ground and roofs are textured with public-domain aerial imagery; facades are
procedural. The car is a generic sedan on a rigid-body vehicle model.

Play it at https://markleary.github.io/driveboston/

## Status

Proof of concept: Back Bay only, daytime only, no traffic. See
[docs/decisions.md](docs/decisions.md) for the direction and
[docs/perf-log.md](docs/perf-log.md) for measurements.

## Controls

| Key | Action |
|---|---|
| W / S or arrows | Throttle and brake or reverse |
| A / D or arrows | Steer |
| Shift | Boost |
| Space | Handbrake |
| R | Reset the car to the nearest road |
| V | Cycle camera (chase, first person) |
| Mouse drag and wheel | Orbit and zoom the chase camera |
| ` (backtick) | Developer overlay and tuning panel |

## Running locally

Requires Node 24.

```bash
npm ci
npm run dev
```

The dev server runs at http://127.0.0.1:5188/driveboston/.

Other commands: `npm test` (unit tests), `npm run test:e2e` (browser smoke test
and screenshots, needs `npx playwright install chromium` once), `npm run build`
(static site in `dist/`), `npm run check` (refuses secrets and other forbidden
content), `npm run geo -- --box backbay` (rebuilds the world data from the
downloaded sources, see `tools/`).

## Technology

three.js (WebGPU renderer with a WebGL 2 fallback, node materials), Rapier
physics, Vite, TypeScript, Vitest and Playwright. No backend; the whole game is
a static site.

## Data and attribution

Every data source, its licence and the required attribution is listed in
[NOTICE.md](NOTICE.md). Map data © OpenStreetMap contributors (ODbL). Aerial
imagery and elevation from MassGIS and the USGS 3D Elevation Program. Building
and street data from the City of Boston (Analyze Boston, PDDL).

## Licence

Code is MIT licensed (see LICENSE). Derived data files carry the licences of
their sources as described in NOTICE.md.
