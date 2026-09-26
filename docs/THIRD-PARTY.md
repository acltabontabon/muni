# Third-party material

Muni's own code and assets are licensed under Apache-2.0. The components below keep their own
licenses; the project license does not relicense them. The web build writes the full license text
of every bundled package to `third-party-licenses.txt` (see `web/scripts/third-party-licenses.mjs`).

## Shipped in the web app (redistributed to every visitor)

| component | license | copyright |
| --- | --- | --- |
| Geist (variable font, via Fontsource) | SIL OFL 1.1 | The Geist Project Authors |
| Fraunces (variable font, via Fontsource) | SIL OFL 1.1 | The Fraunces Project Authors |
| Noto Sans Tagalog (via Fontsource) — renders the Baybayin next to the wordmark | SIL OFL 1.1 | The Noto Project Authors |
| React, React DOM, scheduler | MIT | Meta Platforms, Inc. and affiliates |
| React Router | MIT | React Training LLC 2015-2019; Remix Software Inc. 2020-2021; Shopify Inc. 2022-2023 |
| Radix UI primitives, Floating UI | MIT | WorkOS; Floating UI contributors |
| lucide-react (icons) | ISC | Lucide Icons and Contributors |
| clsx | MIT | Luke Edwards |
| tslib | 0BSD | Microsoft Corporation |

The exact list (59 packages at the time of writing) comes from the production dependency tree at
build time.

## Deployed with the Worker (runs on the server, not distributed)

| component | license |
| --- | --- |
| Hono | MIT — Yusuke Wada and Hono contributors |

## Not redistributed

- The marketing site (`site/`) loads Geist, Geist Mono and Fraunces from Google Fonts.
- Development tools (TypeScript, Vite, Tailwind CSS, Vitest, Wrangler, Playwright, ESLint and their
  dependencies) are used to build and test; they are not part of the shipped app.

## Project-original assets

The Muni mark, app icons (`design/app-icons.mjs`), the link-preview banner (`design/og-banner.html`
→ `site/og.jpg`), the illustrations (including the sign-in scene in `web/src/ui/scene.tsx`) and
the fictional demo data were made for this project and are covered by its license. The name and
logo are additionally covered by [`../TRADEMARKS.md`](../TRADEMARKS.md).
