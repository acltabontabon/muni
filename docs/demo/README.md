# The release demo

`muni-demo.mp4` (1920×1200 at 60 fps) and `muni-demo.gif` (620 wide, for the release page) are a
75-second reel of the real app. Every app frame in it is this build of Muni running locally, driven through
its own UI by [`web/e2e/demo.mjs`](../../web/e2e/demo.mjs), and never retouched. The reel around the
footage is added by [`web/e2e/demo-reel.mjs`](../../web/e2e/demo-reel.mjs): Muni's paper, a
chapter title per scene in Muni's type, the app in a window (a phone beside it where one was
filmed), a slow camera that moves closer to what matters, the evening's horizon along the top with
the sun travelling it, and the closing card. The people (a team called Harbor: Maya Reyes, Jonas
Weber, Priya Nair, Tomás Ibarra, Aiko Tanaka and Sam O’Neill) and everything they write are made up.

The release workflow uploads these two committed files as they are. It never records anything, and
it never touches production. To change the demo, rebuild it with the steps below and commit the
new files.

## The journey, from both sides

`muni-journey.mp4` and `muni-journey.gif` are a separate 30-second film: the retro's steps — Look
back, Choose, Talk, Agree and the recap — with the stage and a phone side by side and what the
facilitator and everyone else do at each. It's filmed from the marketing site's own journey section
(`site/index.html`, `#demo`) by [`web/e2e/journey-film.mjs`](../../web/e2e/journey-film.mjs), which
also encodes it: `python3 -m http.server 4321 --directory site`, then `cd web && node e2e/journey-film.mjs`.

## What it shows

| # | Chapter | Footage | Page |
| - | ------- | ------- | ---- |
| — | The entrance, signed out (~3.6 s) | full bleed, a slow push in | `/signin` |
| 01 | *Keep the thought while it’s fresh.* Priya adds a thought on her laptop; beside it, Tomás adds one on his phone | laptop and phone, the camera closes in on the writer | `/sprints/:id` (collecting) |
| 02 | *Make the page your own.* The same page in four characters’ rooms: Kape, Biyahe, Himig, Sibol | still frames, crossfaded, the room named in the window's bar | `/sprints/:id` in each world |
| 03 | *Close collection whenever you’re ready.* Maya closes collection from the sprint bar: what it will do, then the closed state and *Start the retro…* | the camera moves to the control, then the confirmation | `/sprints/:id` (facilitator) |
| 04 | *Gather them into themes.* Maya ticks four slips about staging, then names the theme in the empty pile waiting on the right, and it appears there with them inside | the camera follows the ticking, then crosses to the pile | `/sprints/:id/prepare` |
| 05 | *Everyone arrives, on any screen.* The retro opens on Look back: the four steps at a glance; as Jonas, Tomás, Priya, Aiko and Sam open it, their faces light up in the rail and each arrival is said once | the camera moves up to the rail, where the faces and arrival lines are | `/sprints/:id/stage` (Look back) |
| 06 | *Choose what matters most.* Why the team votes, in a line; beside the stage, Tomás spends his votes on his phone while the facilitator's count reaches 6 of 6; Maya moves on, which counts the vote and opens the top topic | the stage set aside, Tomás's phone beside it, in step | `/sprints/:id/stage` (Choose → Talk) and `/room` |
| 07 | *Everyone answers. Nobody has to speak first.* “Who owns staging?”, the sun on the talk's horizon: Tomás answers the check-in on his phone and adds a line; the count reaches five; sharing turns the answers into counts and lines | stage and phone, in step | `/sprints/:id/stage` (Talk) and `/room` |
| 08 | *Agree what to try next.* Maya turns the idea from the talk into an experiment and names Tomás; his phone asks, he says yes, and the stage says he owns it | stage and phone, in step | `/sprints/:id/stage` (Agree) and `/room` |
| — | The mark, *Keep the thought. Bring it to the conversation.*, act.munimuni.app | drawn by the reel | |

Chapters overlap by half a second. Everything behind them happens off camera, through the same UI.
Six accounts are created with passkeys: Chromium's virtual authenticator, with PRF (Tomás's
browser is a phone). The sprint is encrypted, as sprints are by default, so each person writes
their own thoughts in their own browser. The facilitator closes collection, groups the thoughts
into themes on camera (the first) and off it (the other three), writes the opening questions, then
runs the retro on the stage in its four steps while the team opens it on their own screens. Where a
chapter shows a phone beside the stage, both were filmed at the same moment, and the reel plays them
in step (the capture writes `offsets.json`: when each phone shot started, measured from its stage
shot). She asks a check-in (answered in each teammate's own browser, so the lines are sealed),
shares it, writes what the room will remember and an idea to try, turns it into an experiment, and
ends the retro after a second one off camera. Plain API calls are used only for things with no
content in them: the workspace and its invitations, choosing characters, the other teammates'
votes and the second owner's yes.

## Rebuilding it

You need Node and the web dependencies (`cd web && npm ci`), Playwright's Chromium
(`npx playwright install chromium`), and ffmpeg with libx264 (`brew install ffmpeg`).

**1 · A fresh local server** serving a production build. Use an empty database, so there is no
other data and no other accounts:

```sh
cd web && npm run build && cp -R dist /tmp/muni-demo-dist   # a frozen copy of the build
cd worker
npx wrangler d1 migrations apply muni --local --persist-to /tmp/muni-demo/d1
npx wrangler dev --port 8870 --ip 127.0.0.1 --persist-to /tmp/muni-demo/d1 \
  --assets /tmp/muni-demo-dist --var PUBLIC_ORIGIN:http://localhost:8870
```

The local worker sends email to its dev inbox (`/api/dev/inbox`), which is how the capture script
accepts invitations.

**2 · Capture** (about two minutes; writes frames, an ffconcat list and a meta.json per shot):

```sh
cd web && DEMO_OUT=/tmp/muni-demo/capture MUNI_URL=http://localhost:8870 node e2e/demo.mjs
```

Shots are filmed at 1280×800 CSS pixels at 2× (the stage at 1152×720, a little closer, so four
themes fit in a row; the phone at 390×844), as back-to-back 2× screenshots in Chromium's new
headless mode, about 20 a second, each stamped with the moment it was taken. The rooms are single
frames. A drawn cursor (and a soft mark where a finger taps, on the phone) follows real input
events, so hover and press states are the app's own.

**3 · The reel** (a few minutes; 2560×1600 frames at 60 a second):

```sh
cd web && DEMO_OUT=/tmp/muni-demo/capture node e2e/demo-reel.mjs
```

Each output frame is drawn for its moment and screenshotted, so the pacing is identical every
time. Footage is captured at about 20 frames a second, so between two captured frames the reel
crossfades them by how far its moment lies between their timestamps: motion (the cursor, scrolling,
the camera) stays smooth at 60 instead of stepping. A chapter can start into its shot (`from`) and
end before it (`cut`), to leave out idle moments. Set `REEL_FPS` to render at another rate. Titles, timings and camera moves are in the `CHAPTERS` list at the top of the script.

**4 · Export** (rebuilds both files in this folder):

```sh
docs/demo/export.sh /tmp/muni-demo/capture
```

- `muni-demo.mp4`: 1920×1200, H.264 High, yuv420p (BT.709, limited range), CRF 22 at the `veryslow` preset, `+faststart`,
  no audio.
- `muni-demo.gif`: 620 wide at 15 fps, one 128-colour palette for the whole film (palettegen with
  `stats_mode=diff`, paletteuse with Bayer dithering at scale 4 and `diff_mode=rectangle`), loops
  forever. The release page shows it at 620. `GIF_FPS` and `GIF_WIDTH` change it.

Each file has to stay under 10 MB: `node scripts/release.mjs check` (in CI on every push, and on
every tag) refuses a larger one, and the export says so. The slow camera changes every pixel of
every frame, so the GIF's size follows its area and frame rate; fewer colours or gentler dithering
barely help. At 15 fps and 620 wide it's just under 10 MB, and the MP4 about 8.5 MB. A camera that
moves while a lot changes on screen costs the most: keep one of the two still.

Set `OUT_MP4` / `OUT_GIF` to write somewhere else first. Before committing, look at a few frames:

```sh
for t in 1 6 12 17 23 29 33 38 44 50; do ffmpeg -loglevel error -y -ss $t -i docs/demo/muni-demo.mp4 -frames:v 1 /tmp/muni-demo/check-$t.png; done
```

Run to run, the only things that change are the order the thoughts and shared lines come out in
(drawn at random, as in the app) and the clock times.
