# Resource readability, larger robber, connected roads

Local change based on main `385a98d3bd188f85c89be7b5e2a391909affa42c` (build-dock PR #25). This change is separate from that merged UI fix. The approved visual revision is prepared for submission separately from that merged UI fix. Publication status is tracked by its pull request and release checks.

## Changes

- Existing resource GLBs are reused; source bytes, palettes, resource/number assignments, variants, board topology and asset download sizes remain unchanged.
- Resource relief/silhouette height above the common surface grows by family: forest 24%, wheat 65%, sheep 55%, ore 30%, clay 48%, desert 25%. Decorations widen about their own groups, up to 18%, 20%, 55%, 50%, 50%, 30% respectively. Bounds reduce individual widths where needed. The number clearing remains at least .35 world units; the edge decoration margin remains .10; vertex/building clearance is at least .25 or its original value when originally tighter. No extra terrain triangles or draw calls.
- Width groups are calculated offline, not discovered on players' phones. `terrain-decoration-layout.js` is a small generated lookup. Runtime applies the mapping once per loaded variant and updates normals/bounds.
- The hooded robber is uniformly 45% larger. Its own material has a stronger warm rim (day 1.6, night 2.2) and a small depth-tested foot ring, without bloom, point lights or a new animation timer. A thin gold back-face shell outlines only the cloak and hood; it excludes face/accessory details, respects depth, casts no shadow, and is not pickable. This adds one local instanced draw and is disposed with the robber layer. The fallback piece is also larger and softly emissive. Placement is baked for all 17 terrain variants and six rotations using the enlarged footprint and actual enhanced terrain. Number/edge clearance and grounded support are regression-tested.
- Two or three adjacent roads owned by the same player meet in a mitered connector with the same road width and surface height. The player-colored curbs and their highlight strips follow each turn/branch continuously; paving seams carry across the connector. The earlier circular/octagonal junction pad is removed. Two- and three-arm geometries are cached once and instanced (six components each). Open ends remain inset. Different owners are separated; an opponent building breaks the join. Roads can continue under their owner's building. Existing road lights stay at their original positions; no new lights or shadow lights are added.
- A legal settlement hint is drawn just above a joined pavement so it stays visible/clickable. Pick radii, ray/occlusion algorithms, legal-move rules and longest-road scoring are unchanged.
- Overview bounds include taller silhouettes and low pier feet, preventing short-landscape cropping while preserving manual-view behavior.

## Rebuild / inspect

```sh
node scripts/bake-terrain-readability.mjs
node scripts/bake-robber-support.mjs
npm run check
npm test
npm run build:global
npm run build:cn
node scripts/readability-preview-export.mjs
blender -b --python scripts/readability-preview-render.py
```

The geometry tests cover all 17 assets; robber support covers 102 variant/rotation combinations. Projection tests pass actual instanced terrain and port vertices through the production fit workflow at 390×844, 844×390 and 320×640, for both 19- and 30-tile boards. Road tests cover turns and branches at all six rotations, surface/curb continuity across each connector portal, differing owners, opponent buildings, reversed endpoint order, unchanged lamp positions and settlement-hint occlusion. Robber tests also cover outline disposal, unpickability, face exclusion and number/edge clearance at all baked poses.

## Preview limits

`test-results/readability/comparison/` contains same-camera before/after day/night roads, robber, and 390×844 / 844×390 whole-board **offline renders of exported runtime geometry**. The reference scene is the earlier local revision `3dac2169fed3dee70fa2b294d7d1945c0bd6e1ea`, copied to `comparison/before.glb`; `PREVIEW_VARIANT=before` selects it. `PREVIEW_VIEWS=roads,robber,mobile,mobile-landscape` limits the render to the requested comparisons. These are review images, not randomized A/B tests or phone screenshots. The number discs are clearance references, not the game's always-on-top sprite UI. Blender lighting and the reproduced rim are illustrative, not an exact WebGL shader capture. The exporter uses a deterministic public demonstration map and does not connect to a live room.

The installed Chromium could not start because this execution environment blocks its local socket. No browser interaction, real iPhone/Android GPU, frame-rate, touch, UI overlap, or physical-device rotation acceptance is claimed. The low-end-device quality setting and existing 2D/model-failure fallback behavior are retained. These items still require a functioning browser/device before production visual acceptance.

## Validation

All 246 tests, type checking and both regional builds pass. The road-day and robber-day/night review images are regenerated from this source and compared pixel-for-pixel with the approved revision. The published renderer and runtime use the same geometry; this comparison does not replace the browser/device acceptance described above.
