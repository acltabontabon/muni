# The release demo

`muni-demo.gif` (for the README and release notes) and `muni-demo.mp4` are a ~27-second walkthrough
of the real app. Every frame of the app is this build of Muni running locally, driven through its
own UI by [`web/e2e/demo.mjs`](../../web/e2e/demo.mjs). The only additions are a drawn cursor, the
one-line captions and the closing card. The people (a team called Harbor: Maya Reyes, Jonas Weber,
Priya Nair, Tomás Ibarra, Aiko Tanaka and Sam O’Neill) and everything they write are made up.

The release workflow uploads these two committed files as they are. It never records anything, and
it never touches production. To change the demo, rebuild it with the steps below and commit the
new files.

## What it shows

| # | Scene | Page | Caption |
| - | ----- | ---- | ------- |
| 1 | The entrance, signed out (~2.6 s) | `/signin` | none |
| 2 | Priya types one thought and adds it to the sprint (~7.8 s) | `/?sprint=…` | Write it down while it’s fresh. |
| 3 | Collection closes: 13 thoughts, no names, on the facilitator’s Prepare page (~2.3 s)… | `/sprints/:id/prepare` | When collection closes, everyone’s thoughts arrive together — without names. |
|   | …then on the shared screen: folded, then opened into four themes with their votes (~4.7 s) | `/sprints/:id/stage` (Discover) | (same caption) |
| 4 | Discussing “Who owns staging?”: its question, a takeaway, the thoughts, an invitation to speak that moves to the next person (~5.1 s) | `/sprints/:id/stage?mode=present` (Discuss) | Talk it through, one topic at a time. |
| 5 | What we’ll try next: two accepted experiments with owners, and the recap, from a participant’s view (~4.4 s) | `/sprints/:id` (done) | Agree what to try — it comes back next sprint. |
| 6 | Closing card: the mark, *muni-muni*, act.munimuni.app (~2.6 s) | a local HTML card | none |

Scenes are joined with 0.4 s crossfades. The whole setup behind them happens off camera, through
the same UI. Six accounts are created with passkeys: Chromium's virtual authenticator, with PRF.
The sprint is encrypted, as new sprints are by default, so each person writes their own thoughts
in their own browser. The facilitator closes collection, groups the thoughts into themes and writes
the opening questions on the Prepare page, then runs the retro on the stage. There she adds a
takeaway, invites voices and proposes the experiments. Plain API calls are used only for things
with no content in them: the workspace and its invitations, attendance, votes and accepting
ownership.

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

**2 · Capture** (about two minutes; writes frames and one ffconcat list per scene):

```sh
cd web && DEMO_OUT=/tmp/muni-demo/capture MUNI_URL=http://localhost:8870 node e2e/demo.mjs
```

The script films at 1280×800 CSS pixels at 2× (the stage at 1152×720, a little closer, so four
themes fit in a row). It uses back-to-back 2× screenshots in Chromium's new headless mode, about 20
a second. Each frame is stamped with the moment it was taken, so the pacing is real time and waits
are left out. Captions and the cursor are drawn in the page, in Geist. The cursor follows real
mouse events, so hover and press states are the app's own. Captions and the closing card are in
the `CAPTIONS` and `endCard()` parts of the script.

**3 · Export** (rebuilds both files in this folder from the captured frames):

```sh
docs/demo/export.sh /tmp/muni-demo/capture
```

Each scene is resampled to a constant 30 fps at 1280×800 (lanczos) and the scenes are crossfaded
together. The script then writes:

- `muni-demo.mp4`: H.264 High, yuv420p (BT.709, limited range), CRF 18, `+faststart`, no audio.
- `muni-demo.gif`: 960×600 at 15 fps, one palette for the whole film (palettegen / paletteuse,
  Bayer dithering), loops forever. Keep it under 8 MB so GitHub shows it inline without trouble.

Set `OUT_MP4` / `OUT_GIF` to write somewhere else first. Before committing, look at a few frames:

```sh
for t in 1 5 9 11 15 19 24 26; do ffmpeg -loglevel error -y -ss $t -i docs/demo/muni-demo.gif -frames:v 1 /tmp/muni-demo/check-$t.png; done
```

Run to run, the only thing that changes is who the stage invites to speak, because the app picks
at random.
