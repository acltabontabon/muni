# Current screens

Captured from the actual local app on 4 October 2026 with fictional Harbor team content. Screens
are unretouched Chromium captures in light mode, 1440×1000 on desktop and 390×844 on mobile
(the marketing phone is 390×900).

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Writing and personal collection | [capture-desktop.png](capture-desktop.png) | [capture-mobile.png](capture-mobile.png) |
| Empty writer | [capture-empty-desktop.png](capture-empty-desktop.png) | — |
| Workspace and current sprint | [workspace-desktop.png](workspace-desktop.png) | [workspace-mobile.png](workspace-mobile.png) |
| Sprint setup | — | [setup-mobile.png](setup-mobile.png) |
| Revealed team thoughts | — | [reveal-mobile.png](reveal-mobile.png) |
| Marketing introduction | [site/site-desktop.png](site/site-desktop.png) | [site/site-phone.png](site/site-phone.png) |

With a local Worker serving the latest production build (see [Contributing](../../CONTRIBUTING.md)),
capture and verify them from `web/`:

```sh
MUNI_URL=http://localhost:8870 SHOTS=../docs/screenshots node e2e/experience.mjs
```

The script creates isolated synthetic accounts and a workspace. It also checks prompt/draft
preservation, personal and shared search, mobile navigation, character limits and horizontal
overflow at 320, 390 and 768 pixels. It never connects to production.

The marketing site has a separate responsive interaction suite:

```sh
SITE_URL=http://localhost:4322 SHOTS=../docs/screenshots/site node e2e/site.mjs
```
