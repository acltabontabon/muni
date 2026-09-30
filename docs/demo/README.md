# The release demo

This folder holds the two films that every release attaches: the demo reel and the journey film. It is for maintainers who need to re-record them. The release workflow attaches the committed files as they are. It never records anything and never touches production.

| File | What it is |
| --- | --- |
| `muni-demo.mp4`, `muni-demo.gif` | A 73-second reel of the real app. The MP4 is 1920×1200 at 60 fps; the GIF is 620 px wide, for the release page. |
| `muni-journey.mp4`, `muni-journey.gif` | A 30-second film of the retro's four steps and the recap, with the stage and a phone side by side. The MP4 is 1920×1080 at 30 fps; the GIF is 720 px wide. |

Every app frame in the reel is this build of Muni running locally, driven through its own UI and never retouched. The reel adds the framing: Muni's paper, a title per chapter, the app in a window (with a phone beside it where one was filmed), a slow camera, a horizon with the sun travelling it, and the closing card. The team (Harbor) and everything they write are made up.

## How the reel is made

1. [`web/e2e/demo.mjs`](../../web/e2e/demo.mjs) captures the footage. It creates six accounts with passkeys (Chromium's virtual authenticator, with PRF) and runs one encrypted sprint through writing, closing collection, themes and the four-step retro. Each person writes in their own browser; plain API calls are used only for things with no content (the workspace, invitations, choosing characters, the other teammates' votes). Shots are 1280×800 CSS pixels at 2× (the phone is 390×844), taken back to back at about 20 frames a second. Where a chapter shows a phone beside the stage, both were filmed at the same moment. The capture writes `offsets.json` so the reel can play them in step.
2. [`web/e2e/demo-reel.mjs`](../../web/e2e/demo-reel.mjs) renders 2560×1600 frames at 60 a second. Each output frame is drawn for its moment and screenshotted, so pacing is identical every time, and captured frames are crossfaded by timestamp so motion stays smooth. Titles, timings and camera moves are in the `CHAPTERS` list at the top of the script. `REEL_FPS` changes the rate.
3. [`export.sh`](export.sh) encodes the frames to the MP4 and GIF.

Between runs, only the order of randomly drawn lines and the clock times change.

## Rebuilding the reel

You need Node, the web dependencies (`cd web && npm ci`), Playwright's Chromium (`npx playwright install chromium`) and ffmpeg with libx264.

1. Serve a production build with an empty local database, so there are no other accounts:

   ```sh
   cd web && npm run build && cp -R dist /tmp/muni-demo-dist
   cd ../worker
   npx wrangler d1 migrations apply muni --local --persist-to /tmp/muni-demo/d1
   npx wrangler dev --port 8870 --ip 127.0.0.1 --persist-to /tmp/muni-demo/d1 \
     --assets /tmp/muni-demo-dist --var PUBLIC_ORIGIN:http://localhost:8870
   ```

   The local Worker puts email in a dev inbox (`/api/dev/inbox`), which is how the capture accepts invitations.

2. Capture (about two minutes):

   ```sh
   cd web && DEMO_OUT=/tmp/muni-demo/capture MUNI_URL=http://localhost:8870 node e2e/demo.mjs
   ```

3. Render the reel (a few minutes):

   ```sh
   cd web && DEMO_OUT=/tmp/muni-demo/capture node e2e/demo-reel.mjs
   ```

4. Export, which overwrites the two files in this folder:

   ```sh
   docs/demo/export.sh /tmp/muni-demo/capture
   ```

   The MP4 is H.264 High, yuv420p, BT.709, CRF 24, no audio. The GIF is 12 fps with one 128-colour palette and loops forever. The environment variables `CRF`, `GIF_FPS`, `GIF_WIDTH`, `OUT_MP4` and `OUT_GIF` change the output.

5. Look at a few frames before committing:

   ```sh
   for t in 1 6 12 17 23 29 33 38 44 50; do ffmpeg -loglevel error -y -ss $t -i docs/demo/muni-demo.mp4 -frames:v 1 /tmp/muni-demo/check-$t.png; done
   ```

## Rebuilding the journey film

[`web/e2e/journey-film.mjs`](../../web/e2e/journey-film.mjs) films the journey section of the marketing site (`#demo` in `site/index.html`) and encodes both files itself. It needs no Worker:

```sh
python3 -m http.server 4321 --directory site
cd web && node e2e/journey-film.mjs      # SITE_URL and STEP_S change the source and the pace
```

## Size limit

Each of the four files must stay under 10 MB. `node scripts/release.mjs check` (CI on every pull request, push to `main` and tag) fails on a larger one, and `export.sh` warns. The GIF is the largest, at about 9 MB. Its size follows its area and frame rate; fewer colours or gentler dithering barely help. Keep either the camera or the screen content still in a chapter, because both moving at once costs the most.
