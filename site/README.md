# Muni — marketing site

Static HTML, CSS and JS. No build step, no dependencies (fonts load from Google Fonts).
Every path is relative, so the folder also works at a sub-path if it ever needs to.

## Preview

```bash
python3 -m http.server 4321 --directory site
```

## Where it lives

Published at **https://munimuni.app** by GitHub Pages from this repository: every push to `main`
that touches `site/` runs `.github/workflows/pages.yml`, which publishes a copy of this folder with
every stylesheet and script the page links stamped with a hash of its contents
(`scripts/site-stamp.mjs`: `styles.css` → `styles.css?v=…`). Browsers may keep those files for a
while; the stamp means a page never gets a cached older stylesheet after a publish. The custom
domain is set in the repository's Pages settings (not a `CNAME` file).

The app lives at **https://act.munimuni.app**, set as `data-app-url` on `<html>` in `index.html`
(the “Open Muni” buttons also carry it as their `href`, so they work without JavaScript; the
script turns them into “Coming soon” if `data-app-url` is empty). The site registers no service
worker; the app's PWA is scoped to act.munimuni.app.

`.nojekyll` keeps GitHub Pages from running Jekyll over the folder.

## What's on the page

In order: the headline; **the problem** — four small scenes of how a retro usually goes (early
thoughts fading by retro day, two voices and seven muted tiles, a candid note softened because a
name is on it, the same action item agreed three sprints running), each with what Muni does
about it; **two screens, one conversation** (`#demo` — the same retro from the facilitator's
stage and a participant's phone, step by step through look back, choose, talk and agree to the
recap, each tab naming the problem it answers); the pinned **how it works** scene; **the retro** (a mock of the stage in its four
steps, with a check-in that's asked, then shared as counts and lines); **quiet ways in** (the
phone: a one-tap check-in and *Add to this discussion*, drawn in the app's own paper and ink);
agreeing experiments; the next sprint's look back; privacy; open source; the name; and the
closing call to open Muni. The mocks
mirror the app as it is — change them when the stage, the phone or the words change. Each
little scene plays once when it comes into view; with reduced motion, each shows its final state.

The pinned "how it works" scene uses the demo team's 25 thoughts as the app stores them
(category, rough timing, theme), so its counts — 5 themes of 6 · 1 · 5 · 2 · 1 and 10
ungrouped — are true to the product. The privacy section links to the app's Privacy & data page
(act.munimuni.app/privacy), which holds the full explanation; keep the two consistent
(`docs/privacy-claims.md`).
Everything that moves respects `prefers-reduced-motion`.
