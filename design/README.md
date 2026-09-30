# Design sources

Sources for generated brand assets. The design direction is in [docs/design.md](../docs/design.md).

| File | Produces | Run |
| --- | --- | --- |
| `app-icons.mjs` | PWA icons and the Apple touch icon in `web/public` (`icons/icon-192.png`, `icons/icon-512.png`, `icons/maskable-512.png`, `apple-touch-icon.png`), drawn from the Muni mark | `ln -s ../web/node_modules design/node_modules`, then `node design/app-icons.mjs` |
| `og-banner.html` | `site/og.jpg`, the 2400×1260 link-preview banner, shown at 1200×630 | see below |

Both use Playwright's Chromium, installed in `web/`. `app-icons.mjs` resolves `playwright` from `design/`, where nothing is installed, so it needs the link above. Do not commit the link.

## Rendering the banner

Render at 2× and save a JPEG at quality 88 (about 200 KB), from `web/`:

```js
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
await page.goto('file://' + path.resolve('design/og-banner.html'), { waitUntil: 'networkidle' })
await page.screenshot({ path: 'site/og.jpg', type: 'jpeg', quality: 88 })
```

After replacing the banner, ask Facebook to re-read the page in the [Sharing Debugger](https://developers.facebook.com/tools/debug/) with "Scrape Again". Facebook caches previews.
