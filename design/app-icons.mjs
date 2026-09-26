// Renders the PWA icons into web/public from the Muni mark. Run from web/: node ../design/app-icons.mjs
import { chromium } from 'playwright'
const out = new URL('../web/public', import.meta.url).pathname
// The Muni mark (arches, dot and reflection span x 6.5–56.5, y 20–67 of its 64 box; centred as a group): two arches (an "m") and the dot, on the app's indigo. `pad` is the share of the
// canvas left around the mark; maskable icons keep the mark inside the 80% safe circle.
const svg = (size, { radius, pad }) => {
  const inner = size * (1 - 2 * pad)
  const s = inner / 64
  const o = size * pad
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b52ee"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs>
    <rect width="${size}" height="${size}" rx="${radius * size}" fill="url(#g)"/>
    <g transform="translate(${o + 0.5 * s} ${o - 11.5 * s}) scale(${s})">
      <g fill="none" stroke="#fbfbff" stroke-width="7" stroke-linecap="round">
        <path d="M10 40V28a8 8 0 0 1 16 0v12"/><path d="M26 40V28a8 8 0 0 1 16 0v12"/>
      </g>
      <circle cx="52" cy="40" r="4.6" fill="#c7d2fe"/>
      <g fill="none" stroke="#fbfbff" stroke-width="5" stroke-linecap="round" opacity="0.22" transform="translate(0 92) scale(1 -1)">
        <path d="M10 40V33a8 8 0 0 1 16 0v7"/><path d="M26 40V33a8 8 0 0 1 16 0v7"/>
      </g>
    </g></svg>`
}
const b = await chromium.launch()
const jobs = [
  ['icons/icon-192.png', 192, { radius: 0.22, pad: 0.14 }, true],
  ['icons/icon-512.png', 512, { radius: 0.22, pad: 0.14 }, true],
  ['icons/maskable-512.png', 512, { radius: 0, pad: 0.24 }, false],
  ['apple-touch-icon.png', 180, { radius: 0, pad: 0.16 }, false],
]
for (const [file, size, opts, transparent] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg(size, opts)}</body></html>`)
  await p.screenshot({ path: `${out}/${file}`, omitBackground: transparent })
  await p.close()
}
await b.close()
console.log('ok')
