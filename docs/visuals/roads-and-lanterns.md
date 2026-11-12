# Paved roads and warm roadside lanterns

Road and lantern preview based on `ee2db34e672b030a0d0fb56eebd71e793964c337`.
This change does not deploy, alter model loading or change gameplay/server code.

## Visual treatment

- Low stone bedding follows the existing level shared-edge corridor. Twelve
  slightly varied, bevelled pavers form each road; continuous player-coloured
  curbs preserve ownership readability. Junctions remain open for buildings.
- A small bronze caged lantern sits on each built road's shoulder. Empty/legal
  roads never get lamps. Its warm glass and a narrow soft pool fade with the
  existing authoritative day/night amount, not with a separate clock.
- Lanterns follow the home demonstration's road reveal/hide cycle. They do not
  capture pointer or keyboard hits. Two-dimensional roads are unchanged.

## Cost and ownership

All road pavers share one geometry. All gameplay lanterns together use three
InstancedMeshes (frames, glass, pools), independent of the road count. There
are no new PointLights, shadow maps, textures, GLB downloads or timers.
Daylight hides the pool draw; low-power mode reduces its strength. Road and
lantern geometry totals 594 triangles per road, or 53,460 at the six-player
inventory limit of 90 roads. This is a geometry budget, not measured FPS.

The warm road pool is a shallow, depth-tested additive surface effect. It does
not illuminate nearby trees/buildings like a real dynamic point light. This
keeps mobile cost bounded and avoids light leaking across the entire island.

The assets, materials and instance buffers are Board-owned, reused through
day/night changes, and released on rebuild/dispose. All 109 possible expanded
board edges are covered by a worst-case instancing test, even though the piece
inventory prevents all 109 being occupied in one ordinary game.

## Verification

- `npm run check`: passed (including TypeScript).
- `npm test`: 209 passed, including five new road/lamp tests.
- `npm run build:cn` and `npm run build:global`: passed. The existing Three.js
  bundle-size warning remains.
- `git diff --check`: passed.
- Actual current terrain GLBs on all 72 homepage edges: downward rays at each
  lamp foot found no scenery obstruction; highest terrain surface was .267500013.
- Day and night offline model renders completed and were visually inspected.
- Tests cover the road corridor, reversed endpoints, all map edge directions,
  owner colours, built-only placement, 109-edge batching, no dynamic lights,
  dusk/night/dawn interpolation, low-power strength, demonstration reveal,
  unchanged inputs and repeated cleanup/rebuild.

Browser/GPU/phone acceptance is still pending. Local Chromium fails before a
page opens with `socket() failed: Operation not permitted`, including the
approved execution retry. The available cloud browser falls back to 2D, so it
cannot verify this 3D effect. Do not call the Blender renders browser screenshots
or claim shader/FPS/mobile-interaction acceptance from them.

`scripts/road-preview-export.mjs` exports actual runtime terrain/building/road/
lantern geometry. `scripts/road-preview-render.py` makes labelled-by-filename
day/night model previews in `test-results/roads/`; its offline Cycles lighting
and material approximation are not the runtime WebGL lighting.

Approved model previews: [day](../qa/roads/road-detail-day.png) and
[night](../qa/roads/road-detail-night.png). These are offline model renders,
not browser screenshots or performance evidence.

Before marking the draft ready or releasing, inspect desktop/phone day and night, legal road and
building picking, maximum road counts, lower viewing angles, pause/resume,
home/room transitions, 2D/3D switches, interrupted model loading and GPU memory.
