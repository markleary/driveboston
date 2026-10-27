# Performance log

One row per measurement. Machine, resolution and quality preset are recorded so
rows are comparable.

| Date | Build | Machine | Resolution | Preset | Scene | fps median | fps p95 frame ms | Heap MB | Load s | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-26 | be16ad9+ (P1 runtime) | Apple M-series laptop, headless Chromium with WebGPU | 1600x900 | default | Back Bay lap by the bot (Comm Ave, Berkeley, Beacon, Mass Ave), 234 s | 60 (vsync capped, 16.7 ms median) | 16.8 | 168 | 2.0 | 186 draw calls, 1.72 M triangles, physics step 0.1 to 0.3 ms, 63 chunks, 5,352 building parts |
| 2026-10-26 | 75b6952+ (road ribbons) | Apple M-series laptop, headless Chromium with WebGPU | 1600x900 | default | Back Bay lap by the bot (Comm Ave, Berkeley, Beacon, Mass Ave), 235 s | 60 (vsync capped, 16.7 ms median) | 16.8 | 177 | 2.2 | 230 draw calls, 1.83 M triangles, physics step 0.1 to 0.3 ms; the road ribbons add 44 draw calls and 0.11 M triangles over the previous row |
| 2026-10-27 | 464a97e+ (city building meshes) | Apple M-series laptop, headless Chromium with WebGPU | 1600x900 | default | Back Bay lap by the bot (Comm Ave, Berkeley, Beacon, Mass Ave), 235 s | 60 (vsync capped, 16.7 ms median) | 16.8 | 203 | 3.5 | 271 draw calls, 1.95 M triangles, physics step 0.1 to 0.3 ms; 2,595 city models (396 k source triangles) drawn in place of 4,914 covered footprint extrusions; one 617 ms hitch in a p95 window during the lap; world file 3.84 MB, was 1.8 MB |
