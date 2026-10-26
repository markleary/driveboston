# Performance log

One row per measurement. Machine, resolution and quality preset are recorded so
rows are comparable.

| Date | Build | Machine | Resolution | Preset | Scene | fps median | fps p95 frame ms | Heap MB | Load s | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-26 | be16ad9+ (P1 runtime) | Apple M-series laptop, headless Chromium with WebGPU | 1600x900 | default | Back Bay lap by the bot (Comm Ave, Berkeley, Beacon, Mass Ave), 234 s | 60 (vsync capped, 16.7 ms median) | 16.8 | 168 | 2.0 | 186 draw calls, 1.72 M triangles, physics step 0.1 to 0.3 ms, 63 chunks, 5,352 building parts |
