# Performance: what Muni does when nobody touches it

Muni should cost nothing while it sits open. A phone that keeps drawing frames, re-running
timers or re-fetching data for a page nobody is looking at gets warm and drains its battery.
This page records what was measured, what was fixed, the budgets that guard it, and what
still needs a real phone.

## How it's measured

`web/e2e/perf.mjs` runs against a **production build** (`npm run build`, served by `wrangler dev`
with the real `_headers`), in Playwright's Chromium with phone emulation: 375×812 at 3× pixel
density, touch, and **4× CPU slowdown**. For each screen it waits for the page to settle, then
records a Chrome trace and reports, per second: main-thread busy time, frames produced, paints,
style recalculations and layouts, timer fires, and network requests. It also scrolls the
collection, types 200 characters, and navigates Write ⇄ Sprints twelve times, then checks that
listeners, DOM nodes and requests come back down.

```bash
MUNI_URL=http://localhost:8799 node e2e/perf.mjs          # table + "All budgets met" / "Over budget"
MUNI_URL=http://localhost:8799 BUDGET=1 node e2e/perf.mjs # exit 1 over budget
```

It measures the app's own recurring work. It does **not** measure a phone's heat, GPU load or
battery; desktop emulation can't (see *On a real phone* below).

## What was found (2026-09-27)

Before and after, same harness, same machine (Apple M2 Pro), 10-second windows. "Busy" is at 4×
slowdown.

| Screen, left alone | Before | After |
| --- | --- | --- |
| Sign-in (light), after 26 s | **60 frames/s, 44 paints/s, 22 layouts/s, 57 ms/s busy — forever** | **0 frames, 0 paints, 0 ms/s** |
| Sign-in (dark), after 26 s | **60 frames/s, 60 paints/s, 94 ms/s busy — forever** | **0 frames, 0 paints, 4 ms/s** |
| Workspace ("Sprints") page, after 26 s | **60 frames/s, 19 paints/s, 23 ms/s busy — forever** | **0 frames, 0 paints, 3 ms/s** |
| Sign-in / workspace, first 13 s | 60 frames/s | 60 frames/s (the scene's motion, which is finite: see below) |
| Home in all eight worlds, light and dark; a sprint; Account | 0 frames, 0 timers, 0 requests | unchanged |
| Opening Home (API requests) | 18 (capture-target ×5, auth/me ×3, sprints ×2, experiments ×2, …) | 10 |
| Back to Write from Sprints (API requests) | 6 | 4 |
| Write ⇄ Sprints ×12: listeners / DOM nodes left behind | 0 / 0 | 0 / +4 |
| Coming back to the app with nothing queued | a send pass (`/api/auth/me` + queue) every time | no request |
| Coming back to the app (service-worker check) | `/sw.js` every time | at most every 15 minutes |
| Typing (per second, 4×) | ~100–120 ms busy, one style + layout per key | unchanged |
| Scrolling the collection | composited: 0 main-thread paints | unchanged |

### Root causes

1. **The evening scene never stopped.** The sign-in scene (also on invitations, joining, the
   workspace page's postcard, Outcomes and the stage) animated forever: palms, hammock, slipper,
   thought bubble, stars, birds, glints and fireflies. These are CSS animations on SVG elements,
   which browsers don't composite, so every frame recalculated style, laid out and repainted the
   scene. Worse, the water shows the shore mirrored through an `feTurbulence` + `feDisplacementMap`
   ripple filter; because the mirrored shore was the moving one, the filter re-ran every frame, at
   the phone's full pixel density. In dark mode the fireflies also moved under `drop-shadow`
   filters, re-rasterised every frame. This is the only continuous work found anywhere in the app,
   and the most likely source of the heat reported on phones. Checked on real phones on 2026-09-29.

2. **Home fetched the same data several times.** Its loaders depended on the local store's object,
   which changes identity on every send-queue update, so each update re-ran `capture-target`; the
   workspace effect depended on a workspace object rebuilt whenever the account was re-read, and
   on an `offline` flag that flipped from `undefined` to `false`.

3. **Every return to the app made requests even with nothing to send**: a send pass always began
   by asking the server who is signed in, and the service worker was re-checked on every switch.

4. **A save during another send pass reported the wrong outcome** ("Kept in this tab. Keep Muni
   open until it's sent") although it was sent moments later: the pass under way made the save's
   own pass a no-op. Found because it made `e2e/capture.mjs` fail about two runs in three.

A "memory leak" that the first navigation measurement showed (+530 DOM nodes per round trip) was
the harness itself: Playwright's `waitForSelector` returns an element handle that pins the old
page. Measured with handle-free waits, nothing is left behind.

### Fixes

- **Motion is a breath, not a loop** (`styles.css`, *The scene*). The shore sways, stars twinkle,
  birds cross and glints shimmer for about fifteen seconds, then everything comes to rest exactly
  where it began and the page stops drawing. Each finished sign-in step lets it breathe again
  (`DuyanScene` restarts the ambient animations with the Web Animations API). The rest pose is
  the drawing as designed: palms, hammock, the thought bubble, stars and moon at night.
- **On a phone the entrance makes one gesture** (2026-09-27): the duyan rocks once and the thought
  appears; nothing else moves, and the upright scene has no filter — its reflection is cut into
  still bands that are painted once. Its shore is drawn in place rather than through `<use>`: a
  `<use>` copy is a shadow tree that descendant selectors can't reach, so the phone's motion rules
  never applied to it and its palms and tsinelas kept moving for ~19 s. Signed-out phone, 3–18 s
  after load: 34–44 → 0.3–0.4 ms/s main thread, 35–52 → 0.5 paints/s, frames only during the
  ~7 s rock (`e2e/perf.mjs`, emulation).
- Scenes pause when **scrolled out of view** as well as when the tab is hidden (`useStill` in
  `ui/scene.tsx`, an IntersectionObserver).
- Fireflies glow with a second, fainter circle instead of a filter.
- The sun (moon at night) is a flat disc, not a shaded sphere.
- Home's loaders read the local store through a ref and key the workspace effect by id.
- A send pass with an empty queue makes no request; a forced pass waits for the one under way and
  runs its own (`lib/local/passes.ts`).
- The service worker is re-checked at most every 15 minutes.

### Guarded by

- `web/src/lib/motion.test.ts`: no decorative `infinite` animation anywhere in `styles.css` or
  `worlds.css` (only an indicator that exists while something is in progress: a pending join);
  every scene animation has a finite count and holds its end; no scene animation under a filter.
- `web/src/lib/local/passes.test.ts`: a save during a pass gets its own pass and result; routine
  triggers join; a failure doesn't block the next.
- `web/e2e/perf.mjs` budgets, below.

## Switching workspace sections (2026-09-27)

Opening People (and switching between Sprints, People and Settings) was slow and awkward. Measured
before changing anything, with a realistically seeded workspace (13 people, 16 sprints, invitations,
invite codes, two people asking to join), the same machine, phone emulation at 4× slowdown, and a
copy of the Worker that delays each D1 call by a fixed amount and counts them. Two delays bracket
production: from the Singapore edge, `GET /api/auth/me` with an unknown session cookie (one D1 read)
takes a median 18 ms longer than with no cookie (no read), so 8 ms and 35 ms per call were used. The harness itself lives
outside the repo; `e2e/workspace.mjs` keeps the behaviour it checked.

**Causes, in order of weight:**

1. **The sprint list was one query per sprint, three times.** `GET /workspaces/:id/sprints` read the
   rows, then — one after another — each sprint's participant count, facilitator and the reader's own
   participation: 51 D1 calls for 16 sprints, growing with the archive (≈0.55 s at 8 ms, ≈1.9 s at
   35 ms). People and Settings fetched this list too (for sprint names), so it kept them changing
   long after they appeared. The sprint record did the same (12 calls in sequence).
2. **Every section was its own page.** Each rendered its own header and read the workspace from
   scratch with nothing kept, so every switch — including back to a section just seen — took the
   workspace's name, band and navigation down to a spinner and rebuilt them (the band's evening
   scene restarting its motion each time).
3. **People loaded in a waterfall.** The requests and invite-code lists only started once the
   workspace had arrived, then each appeared on its own: 5–6 visible states per visit.
4. Sprints read the current sprint only after the list, and requests from a section already left
   kept running (a second copy of the sprint list on the next page).

Code loading wasn't a factor (one bundle, already loaded), and rendering a section costs ~70 ms at
4× slowdown.

**Fixes.** The list's per-person fields are computed in the same query as its rows (one D1 call
for any number of sprints; `worker/test/lists.test.ts`), and the other reads of the workspace, the
sprint record, invite codes and join requests go to the database together rather than in turn. The
workspace is one route with a persistent opening built from who you are (no request). Sections read
through a small in-memory cache per account (`lib/resource.tsx`): what was seen shows at once,
is checked again after a few seconds, is shared between readers, is keyed by path so one workspace's
answer can't land in another, and is invalidated by the changes that affect it. A section's first
load shows quiet lines in the section only, after 350 ms, and appears once, whole.

| Phone, 4× slowdown | Before (8 ms / 35 ms per D1 call) | After (8 ms / 35 ms) |
| --- | --- | --- |
| Sprints → People, first time: content | 245 / 388 ms, then 4 more changes | 207 / 279 ms, whole |
| Sprints → People, first time: page still changing until | 716 / 561 ms | 184 / 258 ms |
| People again (seen before): content | 139–142 / 270–282 ms | 79 / 79–81 ms, no request waited on |
| People → Sprints (seen before): content | settled at 0.76 s / content at 2.1–2.5 s | 79–88 / 68–75 ms |
| Frames with the name or navigation missing, per switch | 3–5 (People), 33–144 (Sprints) | 0 |
| Layout shift arriving on Sprints | 0.125 | 0 |
| Opening People by its link (cold): settled | 849 ms / 2.42 s | 421 / 690 ms |
| Opening Sprints by its link (cold): content | 909 ms / 2.47 s | 440 / 703 ms |
| `GET …/sprints` (16 sprints) | 51 D1 calls, 0.55 / 1.9 s | 3 calls, 35 / 115 ms |
| `GET /sprints/:id` | 12 calls in sequence | 9 calls, 2 rounds |

The workspace page left alone: 0 frames and 0 paints from the start (the opening's evening is drawn
once, still); before, the band's scene moved for its first ~15 s after every switch.

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

## The retro (2026-09-29)

`perf.mjs` (`ONLY=retro`) also holds the retro to a budget: the stage during a topic
(1440×900) and a phone on the same topic. Everything that moves there is finite — the sun rising
on the talk's horizon, an arrival line fading, a face lighting up — so at rest the only work is
the topic clock, which visibly ticks once a second. `useCountdown` wakes only when the shown
second changes (and not at all at zero). Measured: ~1 ms/s main
thread, 2 frames/s, 4 small paints/s, 2 timer fires/s, no requests. The budget for a ticking
retro screen is stated separately in `perf.mjs` (≤2.5 frames/s, ≤5 paints/s, ≤2 timers/s); every
other screen keeps the idle budget.

## On a real phone

The budgets above come from emulation, which can't show heat, GPU work or battery. The maintainer
checked Muni on real iPhone and Android phones on 2026-09-29. To check again after a change to the
scenes or the retro, where it matters:

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

Report the thermal issue fixed only once these show it; until then it's "the only continuous
work found is gone".
