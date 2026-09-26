# Design sources

`og-banner.html` is the source for `site/og.jpg`, the 2400×1260 link-preview banner (shown at
1200×630 by Facebook, LinkedIn, X and Slack). Render it with headless Chromium at 2× and save it as
a JPEG (quality ~88 keeps the grain and glow clean at ~200 KB), e.g. with Playwright from `web/`:

```js
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
await page.goto('file://' + path.resolve('design/og-banner.html'), { waitUntil: 'networkidle' })
await page.screenshot({ path: 'site/og.jpg', type: 'jpeg', quality: 88 })
```

After replacing it, ask Facebook to re-read the page in the Sharing Debugger
(https://developers.facebook.com/tools/debug/ → "Scrape Again"); it caches previews.
