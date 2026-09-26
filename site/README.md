# Muni — marketing site

Static HTML, CSS and JS. No build step, no dependencies (fonts load from Google Fonts).
Every path is relative, so the folder also works at a sub-path if it ever needs to.

## Preview

```bash
python3 -m http.server 4321 --directory site
```

## Where it lives

Published at **https://munimuni.app** from the public repository
[acltabontabon/munimuni.app](https://github.com/acltabontabon/munimuni.app) (GitHub Pages, branch
`main`, root). `CNAME` holds the domain; DNS for the apex and `www` is on Cloudflare (DNS only, so
GitHub can issue the certificate). This folder is the source; to publish a change:

```bash
git clone git@github.com:acltabontabon/munimuni.app.git /tmp/munimuni.app
cp -R site/. /tmp/munimuni.app/ && cd /tmp/munimuni.app && git add -A && git commit -m "Update site" && git push
```

The app will live at **https://act.munimuni.app**. When it launches, set `data-app-url` on
`<html>` in `index.html` to that address; until then every "Open Muni" button reads "Coming soon".

`.nojekyll` keeps GitHub Pages from running Jekyll over the folder.

## What's on the page

The pinned "how it works" scene uses the demo team's 25 thoughts as the app stores them
(category, rough timing, theme), so its counts — 5 themes of 6 · 1 · 5 · 2 · 1 and 10
ungrouped — are true to the product. The privacy wording is the app's exact promise.
Everything that moves respects `prefers-reduced-motion`.
