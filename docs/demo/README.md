# The release demo

`muni-demo.mp4` (1920×1200 at 60 fps) and `muni-demo.gif` (720 wide, for the release page) are a
52-second reel of the real app. Every app frame in it is this build of Muni running locally, driven through
its own UI by [`web/e2e/demo.mjs`](../../web/e2e/demo.mjs), and never retouched. The reel around the
footage is added by [`web/e2e/demo-reel.mjs`](../../web/e2e/demo-reel.mjs): Muni's paper, a
chapter title per scene in Muni's type, the app in a window (a phone beside it where one was
filmed), a slow camera that moves closer to what matters, the evening's horizon along the top with
the sun travelling it, and the closing card. The people (a team called Harbor: Maya Reyes, Jonas
Weber, Priya Nair, Tomás Ibarra, Aiko Tanaka and Sam O’Neill) and everything they write are made up.

The release workflow uploads these two committed files as they are. It never records anything, and
it never touches production. To change the demo, rebuild it with the steps below and commit the
new files.

## What it shows

| # | Chapter | Footage | Page |
| - | ------- | ------- | ---- |
| — | The entrance, signed out (~3.6 s) | full bleed, a slow push in | `/signin` |
| 01 | *Keep the thought while it’s fresh.* Priya adds a thought on her laptop; beside it, Tomás adds one on his phone | laptop and phone, the camera closes in on the writer | `/sprints/:id` (collecting) |
| 02 | *Make the page your own.* The same page in four characters’ rooms: Kape, Biyahe, Himig, Sibol | still frames, crossfaded, the room named in the window's bar | `/sprints/:id` in each world |
| 03 | *Close collection whenever you’re ready.* Maya closes collection from the sprint bar: what it will do, then the closed state and *Start the retro…* | the camera moves to the control, then the confirmation | `/sprints/:id` (facilitator) |
| 04 | *Gather them into themes.* Maya picks up four thoughts about staging on the sorting table, names the theme from the tray, and it appears with them inside | the camera follows the picking, the tray at the screen's foot, then the new theme | `/sprints/:id/prepare` |
| 05 | *Everyone’s thoughts, together. No names.* The shared screen: folded, then opened into four themes with their votes | | `/sprints/:id/stage` (Discover) |
| 06 | *Talk it through, one topic at a time.* Discussing “Who owns staging?”: its question, a takeaway, an invitation to speak that moves to the next person | | `/sprints/:id/stage?mode=present` |
| 07 | *Agree what to try next.* Priya comes back later: the finished sprint's page is its outcomes | | `/sprints/:id` (done) |
| — | The mark, *Keep the thought. Bring it to the conversation.*, act.munimuni.app | drawn by the reel | |

Chapters overlap by half a second. Everything behind them happens off camera, through the same UI.
Six accounts are created with passkeys: Chromium's virtual authenticator, with PRF (Tomás's
browser is a phone). The sprint is encrypted, as new sprints are by default, so each person writes
their own thoughts in their own browser. The facilitator closes collection, groups the thoughts
into themes on camera (the first) and off it (the other three), writes the opening questions, then runs the retro on the stage. There she adds a
takeaway, invites voices and proposes the experiments. Plain API calls are used only for things
with no content in them: the workspace and its invitations, choosing Priya's character, attendance,
votes and accepting ownership.

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

- `muni-demo.mp4`: 1920×1200, H.264 High, yuv420p (BT.709, limited range), CRF 18, `+faststart`,
  no audio.
- `muni-demo.gif`: 720 wide at 15 fps, one 160-colour palette for the whole film (palettegen with
  `stats_mode=diff`, paletteuse with Bayer dithering at scale 4 and `diff_mode=rectangle`), loops
  forever. The camera moves make every frame change, so keep an eye on the size (about 13 MB); the
  release page shows it at 720. `GIF_FPS` and `GIF_WIDTH` change it.

Set `OUT_MP4` / `OUT_GIF` to write somewhere else first. Before committing, look at a few frames:

```sh
for t in 1 6 12 17 23 29 33 38 44 50; do ffmpeg -loglevel error -y -ss $t -i docs/demo/muni-demo.mp4 -frames:v 1 /tmp/muni-demo/check-$t.png; done
```

Run to run, the only things that change are who the stage invites to speak (the app picks at
random) and the clock times on the thoughts.
