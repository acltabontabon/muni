# Marketing site

The static page at <https://munimuni.app>: `index.html`, `styles.css` and `main.js`, plus `favicon.svg`, `apple-touch-icon.png` and `og.jpg` (built from `design/og-banner.html`). There is no build step and no dependencies. Fonts (Geist, Geist Mono, Fraunces) load from Google Fonts. Paths are relative.

## Preview

```bash
python3 -m http.server 4321 --directory site
```

Open <http://localhost:4321>.

## Publish

A push to `main` that touches `site/`, `scripts/site-stamp.mjs` or the workflow runs `.github/workflows/pages.yml`. The workflow runs `node scripts/site-stamp.mjs site _site` and deploys `_site` to GitHub Pages.

The stamp copies the folder and appends a content hash to each local `.css`, `.js` and `.svg` the page links (`styles.css` becomes `styles.css?v=…`). A visitor never gets a new page with a cached old stylesheet. The custom domain is set in the repository's Pages settings, not a `CNAME` file. `.nojekyll` stops Pages running Jekyll.

## The app link

`data-app-url` on `<html>` in `index.html` holds the app's address, <https://act.munimuni.app>. The "Open Muni" buttons also use it as their `href`, so they work without JavaScript. If `data-app-url` is empty, `main.js` turns them into "Coming soon". The site registers no service worker.

## Keeping it true

- The mocks of the stage, the phone and the first-evening guide mirror the app. Update them when the app's screens or words change.
- The privacy section must agree with the app's Privacy page (`/privacy`) and `docs/privacy-claims.md`.
- Each animated scene plays once when it scrolls into view. Everything that moves respects `prefers-reduced-motion`, and reduced motion shows the final state.
- `#demo` is filmed for `docs/demo/muni-journey.mp4` by `web/e2e/journey-film.mjs` at 1280×720. Keep its tab ids (`duo-t1` to `duo-t5`) and keep each step's screens inside that frame.
