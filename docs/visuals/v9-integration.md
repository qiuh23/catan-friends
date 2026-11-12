# Catan V9 Blender integration

Historical integration record. The fixed-day behaviour and terrain sizes below are superseded by [automatic day/night](automatic-day-night.md) and [continuous relief](continuous-relief.md). The original V9 hashes remain in Git history; current terrain hashes are in the runtime manifest.

## Scope

Based on main `f8b37ea`. This change preserves the current React immersive UI, authoritative rules, networking, private player data, camera limits, 2D board and deployment configuration.

Runtime assets come from the supplied 2026-11-12 V9 pack. V9 preserves the V7 models and lighting and updates the background stars. Only Catan assets needed by the current game are shipped:

- All 17 whole-tile variants: three each for forest, wheat, sheep, ore and clay, and two deserts.
- Two villages, two cities, and the detailed pier. Optional lighthouse, cargo, harbor house and standalone terrain props are intentionally not loaded or added to gameplay lanes.
- No `.blend` sources, preview PNGs, Wizard or Athlete assets are runtime dependencies. The supplied Space files remain the editable source delivery.

The runtime GLBs occupy about 6.7 MiB total. A board requests only its selected terrain variants plus the five architecture models. The source manifests and tests verify the original SHA-256 values. `architecture-source-manifest.json` is the source inventory, not an assertion that every listed optional asset is shipped.

## Wiring and ownership

`src/visuals/board-models.js` uses the installed Three.js GLTFLoader, a per-Board URL/Promise cache and instanced primitives attached directly to `land`/`pieces`. Cosmetic choices derive from sorted stable map data plus `tile.id`; they never consume the gameplay RNG. Each instance applies its own rotation and keeps its owning tile ID. Each selected variant replaces the old hex/scenery for that tile. Coast edges, roads, robber and number/port labels remain procedural.

Buildings retain the supplied vertex colours and PBR materials; only `OwnerTint` uses independent instance colours. Pier placement derives from the existing port arms. Number sprites keep `depthTest:false`, and the original invisible pick surfaces, player-colour harbor strips, city-upgrade parent checks and screen-space interaction remain in place.

Loading failures leave procedural terrain/buildings/piers usable. Completion checks both Board disposal and a map generation token before rebuilding. A cosmetic refresh does not reset a manually moved camera or restart the home presentation. Instance parts and their baked geometries are released per layer; the URL cache belongs to one Board and waits for pending loads when disposed. No Board frees another Board's resources.

`src/visuals/board-environment.js` owns one hemisphere fill and one directional light, the existing finite sea disk, and one background triangle. The original lights are removed from construction. Copied vendor modules retain their approved parameters and Three MIT attribution. No extra renderer, permanent RAF, reflection target, bloom or weather service is added.

Default is fixed `day` / `clear`. `board.setEnvironment({phase:'night', weather:'clear', transitionSeconds:0.8})` drives the same finite eased transition across sky, sea and light using the existing render scheduler. `board.update(deltaSeconds)` remains available to an explicit host driver; do not advance the same transition from a second loop. Paused/reduced-motion/hidden states settle to a stable endpoint. Source direction is world-fixed and shared by sky and directional light; no camera alignment or forced sun/moon placement is used.

`board.setQuality({lowPower:true})` disables shadows and lowers sky detail. Resize also applies mobile quality. Static shadows are dirtied for changed models, pieces, demo transforms and environment, not ordinary orbit movement. `clear` / `overcast` are lighting presets, not rain, live weather or multiplayer weather synchronization.

The normal UI is unchanged and no new menu or server field was added. A future shared environment configuration can call the explicit interface without a client-local clock.

## Checks actually completed in the cloud workspace

- `npm ci`: passed with a workspace-local npm cache. The first attempt failed because the default `/home/agent/.npm` path was unavailable; no dependency or lockfile changes were needed.
- `npm run check`: passed, including TypeScript.
- `npm test`: 180 passed, including 8 new actual-GLB/Three CPU tests. These cover all 17 GLBs and their hashes/vertex colours/PBR, five architecture hashes, 19/30-tile multi-seed stability, shuffled tile order, per-instance rotation, direct parents, owner-colour isolation, load failure fallback, pending-load disposal and deterministic environment/quality transitions.
- `python3 -m unittest ops/test_deploy.py`: 11 passed.
- `npm run build:cn` and `npm run build:global`: passed. Vite reports the existing style of large-chunk warning; the Three chunk is about 746 kB before gzip. This is not a runtime performance measurement.
- `npm run worker:check`: passed with writable temporary config/log locations. This was the existing `wrangler deploy --dry-run` command, not a deployment.
- `git diff --check`: passed.

## Browser validation blocker and remaining acceptance

Chromium launch for the unchanged baseline failed before opening a page with `socket() failed: Operation not permitted`. An approved local-test escalation returned the same error. The available cloud browser could not reach the local server (`ERR_CONNECTION_REFUSED`). No before/after game screenshots, actual WebGL shader acceptance, GPU draw-call measurements or frame-rate claim is made.

`scripts/visual-assets-browser.mjs` is provided for a browser-capable environment. Run `npm run dev`, then `TEST_URL=http://127.0.0.1:5175 npm run test:visuals:browser`. It uses the real root entry with test-only response instrumentation, generates desktop/portrait/landscape day/dusk/night and clear/overcast screenshots, checks repeated rebuild memory counts and low quality, records renderer stats, and exercises blocked-asset fallback. `BROWSER_EXECUTABLE` or `BROWSER_CHANNEL` can select an installed browser. This new browser script has been syntax-checked but has not completed a browser run here.

Before merging, complete this script plus the repository's terrain, map-polish, viewport, home, polish, migration and multiplayer/reconnect suites. Visually inspect the lowest allowed angle, number/port label crowding, building/upgrade picking, player colours and shadow grounding. Repeated full Board entry/exit, interrupted loads, actual phone Safari, pause/resume, and GPU geometry/texture/program counts still need browser/device verification. `renderMs` records synchronous CPU render-call duration only, not GPU frame time or FPS.

## Deployment boundary

No merge, manual deployment, credentials, environment variables, Worker bindings, server protocol or release workflow was changed. Keep this PR in draft until browser acceptance is completed. Existing GitHub checks and deployment gates remain the release path; a successful local build does not establish production publication.
