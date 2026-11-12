# Notice stability and popup polish

Base: `main` after merged PR #20 (`01bd6b7`). No changes to rules, server authority, private-card projections or room persistence.

## Diagnosed causes

- Every 180ms public-event batch replaced the current label, anchor and highlights, even while it was still being read. The old label lasted only 1.25 seconds.
- Position selection was stateless and recomputed on every scene frame. Near-equal candidates changed sides; a tiny obstacle intersection hid the label immediately and a clear following frame revealed it again.
- Status toasts overwrote one another, and modal errors inserted a row into the form, shifting its contents while actions were being performed.

## Changes

- One timer owner per channel. A visible public notice remains for 2.8–5.2 seconds, depending on text length. Later events are coalesced into the next summary, without an empty frame, with the latest action's actual tile/edge/vertex or actor anchor. Event IDs and total count remain available. Full public details stay in the activity log.
- At most 80 pending public events are retained. An unusually long modal session keeps an omitted-event count in the summary, not an ever-growing queue. No private hand data enters these notices.
- Distinct status messages are read in order and duplicate active/pending text does not reset the clock. Error messages use one native manual popover, above dialogs without moving form fields or stealing focus. They pause while the page is hidden and clear on room exit/switch.
- Public notices pause behind dialogs. Room switch, reconnect, rematch, hidden-page transitions and page teardown cancel stale callbacks. Delayed summaries do not replay camera movement.
- Clear label positions are held within a 72px distance margin. After obstruction, 120ms of clear space is required to reveal again; labels never draw across number-token/HUD obstacles during that interval.
- Dark sea-glass notices, restrained borders/shadows and matching light dialog/build/chat surfaces. No bounce/scale/position animation; map notices and toasts remain pointer-transparent. Existing native modal focus, dismissal and 44px controls are retained.

## Verification

- `npm run test:notices`: 12 deterministic queue/placement tests pass, including 100 rapid actions, 1,000 queued events, duplicate notifications, stale callbacks, modal pause/resume, targetless anchoring, resize and obstacle-edge jitter.
- `npm test`: 204 tests pass, including the integrated robber model.
- `npm run check`, both site builds, Worker dry-run and 11 deployment tests pass on the combined notice/robber changes.
- `git diff --check` and syntax checks of the added/updated browser scripts pass.

## Browser acceptance still required

`BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:notices:browser` was attempted. Chromium exits before opening a page with `socket() failed: Operation not permitted`. The default Playwright browser bundle is also absent. No screenshot, browser-layout, animation-smoothness or physical-phone acceptance is claimed.

The browser script exercises the real entry with shared-rule WebSocket fixtures in desktop/portrait/short-landscape, 2D/3D, mouse and simulated touch: rapid roads, stable notice text/anchor, deduplication, modal error queue, retained focus/geometry, close/Escape/Back, reload and screenshots. Run against a local dev server, e.g. `TEST_URL=http://127.0.0.1:5175 npm run test:notices:browser`. The existing action-feedback and commerce scripts now allow the readable lifetime and pause behind modals. Browser fixtures are local-only and are not production diagnostics hooks.
