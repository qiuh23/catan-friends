# Hooded robber

The owner approved the character preview on 2026-11-12 and requested a little more highlight. The shipped GLB is the exact approved candidate geometry and vertex colours, renamed `hooded.glb`; its digest is in the adjacent asset manifest. Original hood, mask, scarf, boots, sack and scale are retained. This is a static model with no embedded animation; existing scene/day-night/action animations remain unchanged.

- 137,072 bytes, one mesh/material, 1,763 triangles; no textures, skinning, extra light, bloom pass or shadow map.
- A restrained warm Fresnel rim and small depth-tested gold ellipse distinguish the dark green character, with a slight increase at night. Depth testing remains enabled, and existing always-on-top number/probability sprites are unchanged.
- Placement uses the authoritative robber tile. Six positions around the existing 0.4-radius offset were checked against the actual ground/scenery of every approved terrain variant and its six rotations. The least obstructed grounded pose is baked, keyed by source hash, so phone interactions do not perform triangle raycasts or rebuild geometry every frame.
- All 102 variant/rotation combinations are compared against fresh mesh raycasts in tests. Maximum sampled ground spread: 0.020433 world units; sampled scenery obstruction: zero. This is finite geometric sampling, not exhaustive collision or rendering proof.
- Reconnect, new islands and late model loading use the existing generation guard. Missing assets keep the procedural robber; shared material/geometry disposal follows the existing Board-owned cache.

Automated tests check actual GLB bytes/counts/origin, baked support geometry, tile relocation, material scope, depth-tested accent, fallback and disposal. Chromium cannot launch in the current environment (`socket() failed: Operation not permitted`), so final in-game appearance, all camera angles and physical-phone GPU acceptance remain unverified. No new browser screenshot is claimed.
