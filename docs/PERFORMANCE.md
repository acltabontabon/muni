# Performance: what Muni does when nobody touches it

Muni should cost nothing while it sits open. A phone that keeps drawing frames, re-running
timers or re-fetching data for a page nobody is looking at gets warm and drains its battery.
This page says how Muni is measured, what it costs, the rules that keep it quiet, the budgets that
guard it, and how to check a real phone.

## How it's measured

`web/e2e/perf.mjs` runs against a **production build** served by `wrangler dev` with the real
`_headers`, in Playwright's Chromium with phone emulation: 375×812 at 3× pixel density, touch, and
**4× CPU slowdown**. For each screen it waits for the page to settle, then records a Chrome trace
and reports, per second: main-thread busy time, frames produced, paints, style recalculations and
layouts, timer fires, and network requests. It also scrolls the collection, types 200 characters,
and navigates Write ⇄ Sprints twelve times, then checks that listeners, DOM nodes and requests come
back down.

```bash
cd web && npm run build
cd ../worker && pnpm exec wrangler dev --port 8799 --var PUBLIC_ORIGIN:http://localhost:8799
# in another terminal, from web/:
MUNI_URL=http://localhost:8799 node e2e/perf.mjs          # table + "All budgets met" / "Over budget"
MUNI_URL=http://localhost:8799 BUDGET=1 node e2e/perf.mjs # exit 1 over budget
```

It measures the app's own recurring work. It does **not** measure a phone's heat, GPU load or
battery; emulation can't (see *On a real phone* below). Waits in the harness never hold element
handles: a Playwright handle pins the old page and reads as a leak that isn't there.

## What it costs (1.0.0-rc.1, Apple M2 Pro, 10-second windows, busy time at 4× slowdown)

| Screen, left alone | Measured |
| --- | --- |
| Sign-in, light and dark, after its first breath | 0 frames, 0 paints, 0–4 ms/s |
| Workspace ("Sprints") page | 0 frames, 0 paints, 3 ms/s — its evening is drawn once, still |
| Home in all eight worlds, light and dark; a sprint; Account | 0 frames, 0 timers, 0 requests |
| A phone's sign-in, 3–18 s after load | 0.3–0.4 ms/s main thread, 0.5 paints/s; frames only during the ~7 s the duyan rocks |
| Scrolling the collection | composited: 0 main-thread paints |
| Typing | ~100–120 ms/s busy, one style + layout per key |

| Moving around | Measured |
| --- | --- |
| Opening Home | 10 API requests |
| Back to Write from Sprints | 4 API requests |
| Write ⇄ Sprints ×12: listeners / DOM nodes left behind | 0 / +4 |
| Coming back to the app with nothing queued | no request |
| Coming back to the app: service-worker check | at most every 15 minutes |

Workspace sections, with a realistically seeded workspace (13 people, 16 sprints, invitations,
invite codes, two people asking to join) and a Worker that delays each D1 call by 8 ms or 35 ms
(the range measured from the Singapore edge):

| Phone, 4× slowdown (8 ms / 35 ms per D1 call) | Measured |
| --- | --- |
| Sprints → People, first time | content at 207 / 279 ms, whole; settled by 184 / 258 ms |
| People again, or back to Sprints (seen before) | 68–88 ms, no request waited on |
| Frames with the name or navigation missing, per switch | 0 |
| Opening People or Sprints by its link (cold) | 421–440 / 690–703 ms |
| `GET …/sprints` (16 sprints) | 3 D1 calls, 35 / 115 ms |

## What keeps it quiet

- **Motion is a breath, not a loop** (`styles.css`, *The scene*). The shore sways, stars twinkle,
  birds cross and glints shimmer for about fifteen seconds, then everything comes to rest exactly
  where it began and the page stops drawing. Each finished sign-in step lets it breathe again
  (`DuyanScene` restarts the ambient animations with the Web Animations API). CSS animation on SVG
  isn't composited, so a scene that never stopped would restyle, lay out and repaint every frame —
  through the water's ripple filter, at the phone's full pixel density.
- **On a phone the entrance makes one gesture**: the duyan rocks once and the thought appears;
  nothing else moves, and the upright scene has no filter — its reflection is cut into still bands
  painted once. Its shore is drawn in place rather than through `<use>`: a `<use>` copy is a shadow
  tree that descendant selectors can't reach, so motion rules wouldn't apply to it.
- Scenes pause when **scrolled out of view** as well as when the tab is hidden (`useStill` in
  `ui/scene.tsx`, an IntersectionObserver). Nothing animates under a filter: fireflies glow with a
  second, fainter circle, and the sun (moon at night) is a flat disc.
- **Data is read once.** Loaders are keyed by ids, and read the local store through a ref, so an
  object that changes identity (the send queue's state, a re-read account) never refetches.
  Workspace lists compute their per-person fields in the same query as their rows (one D1 call for
  any number of sprints); independent reads go to the database together. Sections read through a
  small in-memory cache per account (`lib/resource.tsx`): what was seen shows at once, is checked
  again after a few seconds, is shared between readers, is keyed by path, and is invalidated by the
  changes that affect it. A first load shows quiet lines after 350 ms and appears once, whole.
- **Nothing to send, nothing sent.** A send pass with an empty queue makes no request; a forced
  pass waits for the one under way and runs its own (`lib/local/passes.ts`). The service worker is
  re-checked at most every 15 minutes.
- **A first visit isn't an install.** On a first visit the service worker is registered only after
  the page has loaded and gone idle, so downloading the app for offline use never competes with the
  first screen's own requests. Its precache leaves out what's fetched on demand anyway: font subsets
  beyond basic Latin, and the large install icons. A send that gets no answer within 20 seconds is
  given up and tried again later, so *Add to sprint* never waits on a stalled connection.
- **A sprint page reads the sprint once on opening** (a plaintext sprint isn't read again when this
  device's keys change, and the room's first "all" right after the page's own read is skipped); the
  retro's socket greeting says the room's version, and only a room ahead of the screen is read again.

Guarded by `web/src/lib/motion.test.ts` (no decorative `infinite` animation in `styles.css` or
`worlds.css` — only an indicator while something is in progress, a pending join; every scene
animation has a finite count and holds its end; none under a filter), `web/src/lib/local/passes.test.ts`
(a save during a pass gets its own pass and result; routine triggers join; a failure doesn't block
the next), `worker/test/lists.test.ts` (one D1 call for a sprint list), and the budgets below.

## Budgets

Measured on the harness above (phone emulation, 4× slowdown). They are regression limits, not
promises about any particular phone.

| | Budget |
| --- | --- |
| Any page left alone (after its first breath) | ≤ 2 frames/s, ≤ 1 paint/s, ≤ 1 timer/s, 0 requests, ≤ 8 ms/s main thread |
| Scene motion after load or a finished step | finite; at rest by ~20 s (a phone's entrance by ~8 s) |
| Write ⇄ Sprints, per round trip | ≤ 8 API requests |
| After 12 round trips | ≤ 20 listeners, ≤ 200 DOM nodes left behind |
| Typing | ≤ 200 ms/s main thread at 4× slowdown |

## The retro

`perf.mjs` (`ONLY=retro`) also holds the retro to a budget: the stage during a topic (1440×900)
and a phone on the same topic. Everything that moves there is finite — the sun rising on the
talk's horizon, an arrival line fading, a face lighting up — so at rest the only work is the topic
clock, which visibly ticks once a second. `useCountdown` wakes only when the shown second changes
(and not at all at zero). Measured: ~1 ms/s main thread, 2 frames/s, 4 small paints/s, 2 timer
fires/s, no requests. A ticking retro screen's budget is ≤2.5 frames/s, ≤5 paints/s and ≤2
timers/s; every other screen keeps the idle budget.

**What each change costs.** `perf.mjs` (`ONLY=retro-reads`) also sets up an encrypted sprint
through the app, with a stage and five phones, and counts the API requests each screen makes to
arrive and for one step. The live retro gathers the room's hints for a moment and reads each part
once, in order; a read already on its way is never repeated, an answer older than the one shown is
dropped, and an action's own response is used rather than read again. Opening the retro reads
everything once, and arriving tells only the facilitator.

| Encrypted sprint, stage + 5 phones | Requests | Budget |
| --- | --- | --- |
| Arriving, the stage | 9 | ≤ 10 |
| Arriving, each phone | 9 | ≤ 10 |
| The stage while five phones arrive | 2 | ≤ 6 |
| Next → Talk, the stage (the command included) | 4 | ≤ 4 |
| Next → Talk, each phone | 3 | ≤ 4 |

On the server, each screen's path is a few database round trips, however much there is:
`requireSprint` is one query, a meeting snapshot reads the room and one D1 batch side by side,
grouping and check-ins are one batch each, and "Next → Talk" is two calls to the room
(`worker/test/roundtrips.test.ts` pins the counts).

## On a real phone

The budgets above come from emulation, which can't show heat, GPU work or battery. The
maintainer checked Muni on real iPhone and Android phones on 2026-09-29. To check again after a
change to the scenes or the retro:

1. **iPhone (Safari, and the home-screen app).** Charge, close other apps, room temperature.
   Open act.munimuni.app signed out, leave the sign-in page on screen for 10 minutes; then sign in
   and leave Home for 10 minutes; then the Sprints page. Note warmth by hand and battery % before
   and after. With a Mac: Safari → Develop → [phone] → Timelines, record 60 s on each page; after
   the first ~20 s there should be no rendering frames.
2. **Android (Chrome).** `chrome://inspect` → Performance, record 60 s on the same pages; the frame
   track should go idle after ~20 s. Settings → Battery usage for Chrome after 20 minutes.
3. **Background and return.** Lock the phone for a minute, unlock, return to Muni: one quick burst
   of requests (Home's data), then nothing.
4. Compare with the previous build if possible.
