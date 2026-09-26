# Muni — marketing site

Static HTML, CSS and JS. No build step, no dependencies (fonts load from Google Fonts).
Every path is relative, so the folder also works at a sub-path if it ever needs to.

## Preview

```bash
python3 -m http.server 4321 --directory site
```

## Where it lives

Published at **https://munimuni.app** by GitHub Pages from this repository: every push to `main`
that touches `site/` runs `.github/workflows/pages.yml`, which uploads this folder as-is. The custom
domain is set in the repository's Pages settings (not a `CNAME` file). On Cloudflare the apex and
`www` are proxied CNAMEs to `acltabontabon.github.io` (same as acltabontabon.com): Cloudflare
serves HTTPS with its edge certificate, SSL mode "Full", Always Use HTTPS on.

The app lives at **https://act.munimuni.app**, set as `data-app-url` on `<html>` in `index.html`
(the “Open Muni” buttons read “Coming soon” when it is empty). The site registers no service
worker; the app's PWA is scoped to act.munimuni.app.

`.nojekyll` keeps GitHub Pages from running Jekyll over the folder.

## What's on the page

The pinned "how it works" scene uses the demo team's 25 thoughts as the app stores them
(category, rough timing, theme), so its counts — 5 themes of 6 · 1 · 5 · 2 · 1 and 10
ungrouped — are true to the product. The privacy wording is the app's exact promise.
Everything that moves respects `prefers-reduced-motion`.
