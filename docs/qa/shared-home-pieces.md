# Shared home and match pieces

Based on main `4a26441bc98f903d6aedcc44b30969f845ff0693`.

The home scene previously called `addRoad` on independent unit-length segments.
That skipped the match's `roadConnections`, trimmed endpoints and mitered
junctions. Both scenes now call `addRoadNetwork` and `addBoardBuildings`.
Only the home reveal transforms and timeline differ. No game rules, legal moves,
network messages, room state or server files change.

The deterministic example follows six board edges through four nonadjacent
building sites. Four villages are built in sequence; two upgrade to cities.
Same-owner roads share all five real junctions. Reduced motion and 2D show the
settled two-city/two-village state. Model reloads preserve the current pose.
The existing 30-second loop, orbit, modal/hidden-page pauses, day/night cycle,
layout and progressive loading remain in place.

Road and junction instances share at most eight draws. Animation updates pooled
instance transforms rather than rebuilding geometry. Buildings use the existing
model cache and request only the variants the example needs. Cleanup releases
all owned model handles and instances, leaving shared board assets alive.

## Verification

- Full `npm test`: 265 passed, including home/match geometry equivalence for both
  fallback pieces and the actual GLBs, same/mixed ownership, opponent blocking,
  delayed corner reveal, 12 replay loops, model-cache selection, repeated cleanup,
  reduced motion and reload stability.
- `npm run check`, both `build:cn` and `build:global`, and Worker dry-run passed.
  The dry-run used project-local Wrangler logs/config because the default home
  config directory is unavailable. Existing Vite chunk-size warning remains.
- The existing Checks workflow includes the focused home and road regressions.
- Actual runtime geometry was exported and inspected with an offline CPU render:
  six roads connect at consistent widths; all four building placements are clear.
  This is a geometry inspection, not a browser screenshot or animation test.
- `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:home` was attempted. Chromium
  exited before opening a page: `socket() failed: Operation not permitted`.
  No workaround was attempted. Browser/WebGL, device performance, touch gestures,
  live transition smoothness and physical-phone acceptance remain **unverified**.
  The browser script is updated for four buildings and the current constructor.

The final source and validation records are checkpointed before publication.
Publication status is tracked by the pull request and the existing dual-backend
release workflow, not asserted by this pre-publication record.
