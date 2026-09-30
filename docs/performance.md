# Performance

For contributors. Muni should cost nothing while it sits open: a phone that keeps drawing frames,
firing timers or re-fetching data for a page nobody is looking at gets warm and drains its
battery. This page covers how that is measured, the budgets, and the rules that keep Muni quiet.

## How it is measured

`web/e2e/perf.mjs` runs against a production build served by `wrangler dev` with the real
`_headers`. It uses Playwright's Chromium with phone emulation (375×812, 3× pixel density, touch)
and a 4× CPU slowdown. For each screen it waits for the page to settle, records a Chrome trace, and
reports per second: main-thread busy time, frames, paints, timer fires and network requests. It
also scrolls the collection, types 200 characters, and navigates Write ⇄ Sprints 12 times, then
checks that listeners, DOM nodes and requests come back down.

```bash
cd web && npm run build
cd ../worker && pnpm exec wrangler dev --port 8799 --var PUBLIC_ORIGIN:http://localhost:8799
# in another terminal, from web/:
MUNI_URL=http://localhost:8799 node e2e/perf.mjs          # table, then "All budgets met." or "Over budget"
MUNI_URL=http://localhost:8799 BUDGET=1 node e2e/perf.mjs # exits 1 over budget
```

Options:

- `ONLY=signin,home,pages,retro,retro-reads,typing,scroll,navigate` runs only those parts.
- `GUIDE=on` measures pages after the first evening's firefly has settled.
- `IDLE_S` sets the recording window (15 seconds by default).

The harness measures the app's own recurring work. It does not measure a phone's heat, GPU load or
battery, which emulation cannot show (see [On a real phone](#on-a-real-phone)). It never holds
element handles while waiting: a Playwright handle pins the old page and reads as a leak that is
not there. Chrome's trace is browser-wide, so `perf.mjs` counts only the renderer process that
draws the page being measured.

## Budgets

Budgets are regression limits at 4× slowdown, not promises about any phone.

| Measure | Budget |
| --- | --- |
| Any page left alone, after its first breath | ≤ 2 frames/s, ≤ 1 paint/s, ≤ 1 timer/s, 0 requests, ≤ 8 ms/s main thread |
| A live retro screen (the topic clock ticks once a second) | ≤ 2.5 frames/s, ≤ 5 paints/s, ≤ 2 timers/s, 0 requests, ≤ 8 ms/s |
| Write ⇄ Sprints, per round trip | ≤ 8 API requests |
| After 12 round trips | ≤ 20 listeners, ≤ 200 DOM nodes left behind |
| Typing | ≤ 200 ms/s main thread |

API requests in an encrypted sprint with a stage and five phones (`ONLY=retro-reads`):

| Screen | Budget |
| --- | --- |
| Arriving, the stage or a phone | ≤ 10 |
| The stage while five phones arrive | ≤ 6 |
| Next → Talk, the stage or a phone (the command included) | ≤ 4 |

## What keeps Muni quiet

- **Motion is a breath, not a loop.** Scene animations run for a finite time, then rest exactly
  where they began, and the page stops drawing. Each finished sign-in step restarts them with the
  Web Animations API (`DuyanScene`). CSS animation on SVG is not composited, so a scene that
  never stopped would restyle, lay out and repaint every frame.
- **Nothing animates under a filter.** The phone's entrance makes one gesture, with no filter.
  Its shore is drawn in place rather than through `<use>`, because a `<use>` copy is a shadow
  tree that descendant selectors cannot reach.
- **Scenes pause when scrolled out of view** as well as when the tab is hidden (`useStill` in
  `ui/scene.tsx`).
- **Data is read once.** Loaders are keyed by ids and read the local store through a ref, so an
  object that changes identity never refetches. Workspace lists compute per-person fields in the
  same query as their rows, and independent reads run together. An in-memory cache per account
  (`lib/resource.tsx`) shows what was seen at once, rechecks it, shares it between readers, and
  invalidates it on the changes that affect it.
- **Nothing to send, nothing sent.** A send pass with an empty queue makes no request, and a
  forced pass waits for the one under way (`lib/local/passes.ts`). A send with no answer after 20
  seconds is abandoned and retried later. The service worker is rechecked at most every 15 minutes.
- **A first visit is not an install.** The service worker registers after the page has loaded and
  gone idle. Its precache leaves out what is fetched on demand: font subsets beyond basic Latin,
  and the large install icons.
- **One ticking clock per retro screen.** `useCountdown` wakes only when the shown second changes.
  The facilitator's cue waits on a single timer for the moment time is up (`useTimeUp`).
- **The retro reads once.** The live retro gathers the room's hints, reads each part once in order,
  never repeats a read already under way, drops an answer older than the one shown, and uses an
  action's own response instead of reading again.
- **Server round trips are fixed.** Each screen's path is a few D1 round trips however much data
  there is: `requireSprint` is one query, a meeting snapshot is one room read plus one D1 batch, and
  Next → Talk is two calls to the room.

Tests that guard these rules:

- `web/src/lib/motion.test.ts`: no decorative `infinite` animation, every scene animation has a
  finite count and holds its end, and none runs under a filter.
- `web/src/lib/local/passes.test.ts`: a save during a pass gets its own pass and result.
- `worker/test/lists.test.ts` and `worker/test/roundtrips.test.ts`: database round-trip counts.

## On a real phone

Emulation cannot show heat, GPU work or battery. The maintainer checked Muni on real iPhone and
Android phones on 2026-09-29. To check again after changing the scenes or the retro:

1. **iPhone (Safari and the home-screen app).** Charge the phone, close other apps, and keep it at
   room temperature. Leave the signed-out sign-in page on screen for 10 minutes, then sign in and
   leave Home for 10 minutes, then the Sprints page. Note warmth and battery before and after. On a
   Mac, use Safari → Develop → [phone] → Timelines and record 60 seconds per page. After about 20
   seconds there should be no rendering frames.
2. **Android (Chrome).** In `chrome://inspect` → Performance, record 60 seconds on the same pages.
   The frame track should go idle after about 20 seconds. Check Settings → Battery usage for Chrome
   after 20 minutes.
3. **Background and return.** Lock the phone for a minute, unlock, and return to Muni. Expect one
   burst of requests (Home's data), then nothing.
