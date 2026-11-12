# Approved continuous terrain relief

The 17 terrain GLBs and their manifest in `public/assets/v9/catan/variants/`
replace the original V9 tile terrain with the user-approved continuous relief.
The existing variant filenames/selection, hex radius (.985), centre surface
(.2675), centre clear radius (.34), edge decoration margin (.09), vertex colours,
roughness (.72), two static primitives per tile, and Y-up contract are preserved.
All five architecture GLBs are unchanged.

The editable Blender source and generator/export scripts are separately delivered
as the terrain source bundle. `source_generator` in the manifest refers to paths
inside that source bundle, not runtime files or a required build step here.

## Checks performed

The supplied asset verification is retained in `relief-validation/`:
- Actual binary GLB parse through the same Three.js GLTFLoader, hash, vertex
  colours/materials and primitive checks passed for all 17 assets.
- Centre/edge triangle samples, 48 centre ray samples per asset, all six integer
  hex rotations, and 40 actual 19/30-tile map selections passed.
- This repository's actual asset/instancing/owner-colour/fallback/disposal tests
  passed again after replacement. The game board/rules/random stream are unchanged.

## Geometry budget and limits

The faithful exported library contains 248,870 triangles and 13,034,352 bytes;
individual tiles range from 3,156 to 25,942 triangles. There is no new decimation,
LOD, Draco or meshopt compression. A further CPU budget check over 100 actual
maps per edition measured:

- 19 hexes: 280,138–282,706 terrain triangles; up to 30 instanced terrain parts
  and 12,000,188 bytes of distinct terrain assets.
- 30 hexes: 439,984–443,378 terrain triangles; up to 34 instanced terrain parts
  and 13,034,352 bytes of distinct terrain assets.

These are geometry/input counts, not FPS, total-frame draw calls, or GPU memory.
Architecture, pieces, markers and sea are additional. The larger files (about
three times the previous terrain library) and changed silhouettes need real
browser/phone acceptance before merge. Existing instancing, demand loading,
mobile DPR cap, disabled mobile dynamic shadows and reduced detail remain.

The separate finite-angle diagnostic tests *hypothetical horizontal physical
number discs*, not the runtime sprite labels. Of 102 variant/rotation cases,
3 at polar .78 and 12 at polar 1.12 had partial core occlusion, with a worst-case
100% core occlusion. This is disclosed rather than hidden. Runtime numbers and
probability dots still use the original always-on-top SpriteMaterial at y=.43
with `depthTest:false`; that strategy was not replaced. The approved fixed
19-tile preview had all 58 probability dots clear. Neither check substitutes for
actual browser screenshots and mobile GPU/interaction verification, which remain
blocked by the current Chromium environment.
