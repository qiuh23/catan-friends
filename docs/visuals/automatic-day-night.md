# Automatic shared day/night

## Runtime path

Room start → persisted `record.sceneClock` → allowlisted `room.sceneClock` in each
WebSocket snapshot → `Board.set` → one monotonic client anchor →
`Board.syncScene` → `environment.setCycle` → sky, sea, directional light, warm
windows and harbour lanterns. There is no time-of-day setting and no dependency
on the player's timezone, private cards, random stream, or local wall clock.

A full gameplay day is 12 active minutes. Morning begins immediately; the warm
transition starts around minute 3, sunset is strongest around 4½ minutes, and
full night arrives before minute 6. Dawn returns later in the same cycle. Home
uses the same continuous curve with a 100-second showcase period. These are
artistic scene cycles, not a model of the real sun or the time outside.

The room freezes the clock on pause, after finish, and when every human is
offline. Host departure alone does not freeze a room with peers still present.
Rematch resets it; persisted saves retain it. Legacy saves use only the public
turn number for their initial appearance. Server recovery excludes the offline
gap using the last persisted presence time. Reconnect reads the current server
sample, not a fresh dawn. Transport latency can cause tiny sub-second differences
between screens; the cycle is not separately randomized for each player.

Sun and moon move continuously on the same scenic ellipse and crossfade at the
horizon. The discs intentionally use the diorama backdrop, not an astronomical
camera projection. A shared orbit phase drives their position and the world-space
main light direction. Light intensity/colour, sky, sea and stars interpolate from
the existing palettes. Every changed main-light direction marks the existing
cached shadow map dirty. No new shadow map is added. Desktop samples at up to
30 Hz; mobile/low-power samples at up to 20 Hz and retain the previous no-shadow
quality policy. Hidden/offscreen/disposed boards stop scheduling. Reduced motion
has no autonomous animation timer, and receives current appearance on room
updates. Lobby remains still; home pauses only for hidden/offscreen state, dialogs, or reduced motion. Dragging stops automatic camera orbit/following, but never stops or resets the day/night clock, celestial motion or home building demonstration.

## Local night light

The actual dark teal glazing vertices in all four existing architecture GLBs
receive one shared night coefficient through cloned, cached palette materials.
OwnerTint, walls, roof colours, geometry and source GLB hashes remain unchanged.
Two deterministic harbour positions get small bronze-caged lanterns. Their
emissive glass fades in with night; at desktop quality two short-range shadowless
point lights illuminate nearby ordinary surfaces. Mobile/low-power uses emission
only. This is a runtime adaptation of the approved Blender night preview, not
identical Cycles global illumination: the existing unlit sea has no physical
lantern reflection or indirect emissive lighting.

## Verification and limits

- `npm run check`: JavaScript syntax and TypeScript checks passed.
- `npm test`: rule/privacy/lifecycle, actual GLB parsing, light direction and
  shadow-map refresh tests passed (see final PR for the final count).
- `tests/day-night-runtime.test.js` uses a real local Node server and three actual
  WebSocket clients. It covers start, shared day/dusk/night samples, pause,
  resume, reconnect, and hidden-hand isolation.
- Worker packaging dry-run passed with writable temporary config/log paths; no deployment.
- Global and CN production builds passed. Existing large-chunk warning remains.
- `npm run test:day-night:browser` is a separate real three-browser/UI script with
  desktop/portrait/landscape screenshots. It exercises actual room start/setup,
  smooth motion, pause/reload/resume and reduced-motion scheduling, rather than
  calling a visual preset manually.
- That browser script could not launch Chromium in this execution environment:
  `socket() failed: Operation not permitted`. A permitted elevated launch also
  failed at the same point. **No browser screenshot, visual smoothness, actual
  shadow appearance, mobile GPU frame rate, or browser shader compile pass is
  claimed.** Run the script with installed Playwright Chromium (or
  `BROWSER_EXECUTABLE`) before changing this PR from draft to ready.

No merge or production deployment is performed by this work.
