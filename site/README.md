# Marketing site

The static page at <https://munimuni.app>: `index.html`, `styles.css` and `main.js`, plus `favicon.svg`, `apple-touch-icon.png` and `og.jpg` (built from `design/og-banner.html`). There is no build step and no dependencies. Fonts (Geist, Geist Mono, Fraunces) load from Google Fonts. Paths are relative.

The page introduces Muni in three parts: capture a moment during the sprint, reflect together after collection closes, and agree on an experiment to revisit. Warm paper, terracotta accents and restrained serif type echo the app. The page moves from daylight to evening as visitors explore the retro, then returns to daylight for practical questions.

## Preview

```bash
python3 -m http.server 4321 --bind 127.0.0.1 --directory site
```

Open <http://localhost:4321>.

## Interactive previews

- The hero's sample composer accepts a thought and category, shows a private preview, and lets the visitor preview how a thought appears after reveal. This is sample content held only in JavaScript memory: no API request, browser storage or real sprint entry. Text is rendered with `textContent`. The form is disabled until its JavaScript handlers are attached, so a missing script cannot submit the sample as a page request.
- The four capture tabs explain private collection, closing collection, reveal and themes. Visitors choose the step; the page does not require scrolling through a long animation to read the explanation.
- The five retro tabs show the facilitator's stage and a participant's phone. Playback starts only when the visitor presses **Play walkthrough**, pauses outside the visible page, and stops at the recap. Selecting a tab or moving focus into the walkthrough hands control back to the reader.
- Both tab groups support Left/Right arrows, Home and End. Tab selection, roving focus and hidden panels stay in sync.
- On small screens, **Menu** opens section links. Selecting a link, clicking outside or pressing Escape closes it; Escape returns focus to Menu.
- The newcomer questions use native `details` elements and work without JavaScript. Without JavaScript, the navigation remains visible and all capture explanations and retro panels can be read; the sample form stays disabled. App links also work without JavaScript.

Every decorative animation respects `prefers-reduced-motion`; the sample stage's clock stays still in that mode. The sample composer is clearly labelled as a preview, so saving cannot be mistaken for submitting work to a team.

## Verify

With the static server running, run the independent browser checks:

```bash
cd web
SITE_URL=http://localhost:4322 node e2e/site.mjs
```

Set `SITE_URL` to the preview port you started (the preview example above uses 4321). `SHOTS=/tmp/muni-site-shots` optionally saves desktop and phone screenshots. The suite needs the existing Playwright Chromium installation, checks all five retro panels at five widths, and verifies the composer, keyboard, playback, mobile menu, reduced motion, missing-script protection and no-JavaScript fallback. It needs no backend and is separate from the app e2e runner.

## Publish

A push to `main` that touches `site/`, `scripts/site-stamp.mjs` or the workflow runs `.github/workflows/pages.yml`. The workflow runs `node scripts/site-stamp.mjs site _site` and deploys `_site` to GitHub Pages.

The stamp copies the folder and appends a content hash to each local `.css`, `.js` and `.svg` the page links (`styles.css` becomes `styles.css?v=…`). A visitor never gets a new page with a cached old stylesheet. The custom domain is set in the repository's Pages settings, not a `CNAME` file. `.nojekyll` stops Pages running Jekyll.

## The app link

`data-app-url` on `<html>` in `index.html` holds the app's address, <https://act.munimuni.app>. The app buttons also use it as their `href`, so they work without JavaScript. If `data-app-url` is empty, `main.js` turns them into "Coming soon". The site registers no service worker.

## Keeping it true

- The stage, phone and first-use guide illustrations mirror the app. Update them when the app's screens or words change.
- The privacy section and answers must agree with the app's Privacy page (`/privacy`) and `docs/privacy-claims.md`. Encryption claims refer to sprint content; names, dates and authorship remain readable by the service. Shared thoughts have no author names, but context can still identify someone.
- `#demo` is filmed for `docs/demo/muni-journey.mp4` by `web/e2e/journey-film.mjs` at 1280×720. Keep its tab ids (`duo-t1` to `duo-t5`) and keep each step's screens inside that frame. The film's isolation stylesheet should hide `.duo-controls` along with `.duo-film`.
- Check the sample composer, both tab groups, play/pause/replay, menu and FAQ on desktop and a narrow phone. Check all five retro panels at 320, 390, 768, 1024 and 1440 px, plus reduced motion. Confirm no horizontal overflow or console errors and preserve keyboard focus visibility.
