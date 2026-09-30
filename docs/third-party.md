# Third-party material

The licences of what Muni ships. Muni's own code and assets are Apache-2.0. The components below
keep their own licences, and the project licence does not relicense them.

The web build writes the full licence text of every bundled package to
`dist/third-party-licenses.txt` (`web/scripts/third-party-licenses.mjs`). The app serves it at
`/third-party-licenses.txt`. It lists all 73 production packages, taken from `package-lock.json`
at build time.

## Web app

Redistributed to every visitor.

| Component | Licence |
| --- | --- |
| Geist, Fraunces (variable fonts, via Fontsource) | SIL OFL 1.1 |
| Noto Sans Tagalog (via Fontsource), which renders the Baybayin next to the wordmark | SIL OFL 1.1 |
| Character-world faces (via Fontsource): Young Serif, DM Mono, Bricolage Grotesque, Caveat, Source Sans 3, Archivo, Newsreader, Unbounded, Bodoni Moda, Alegreya. Only the chosen world's Latin files are downloaded | SIL OFL 1.1 |
| React, React DOM, scheduler, React Router | MIT |
| Radix UI primitives and their helpers, Floating UI | MIT |
| lucide-react (icons) | ISC |
| clsx | MIT |
| tslib | 0BSD |
| @simplewebauthn/browser (passkey ceremonies) | MIT |
| @noble/curves, @noble/ciphers, @noble/hashes (X25519, XChaCha20-Poly1305, HKDF-SHA256) | MIT |
| qrcode-generator (the invite QR code) | MIT |

## Worker

Runs on the server and is not distributed.

| Component | Licence |
| --- | --- |
| Hono | MIT |
| @simplewebauthn/server (passkey verification) | MIT |
| Its dependencies: @peculiar/* ASN.1 and X.509 packages, @levischuck/tiny-cbor, @hexagon/base64, pvtsutils, pvutils, tsyringe | MIT |
| asn1js | BSD-3-Clause |
| reflect-metadata | Apache-2.0 |
| tslib | 0BSD |

## Not redistributed

- The marketing site (`site/`) loads Geist, Geist Mono and Fraunces from Google Fonts.
- Build and test tools (TypeScript, Vite, Tailwind CSS, Vitest, Wrangler, Playwright, ESLint and
  their dependencies) are not part of the shipped app.

## Project-original assets

The Muni mark, the app icons (`design/app-icons.mjs`), the link-preview banner
(`design/og-banner.html`, rendered to `site/og.jpg`), the illustrations (including the sign-in
scene in `web/src/ui/scene.tsx`) and the fictional demo data were made for this project and are
covered by its licence.

The eight characters (Kape, Guhit, Biyahe, Bola, Pahina, Himig, Porma, Sibol) are original work
made for Muni in 2026 and covered by Apache-2.0. That covers their portraits
(`web/src/worlds/portraits.tsx`), rooms and motifs (`web/src/worlds/rooms/*.tsx`), styling
(`web/src/worlds/worlds.css`) and words (`web/src/worlds/characters.ts`). They are hand-authored
vector drawings written as SVG in code. No image-generation model, stock art, clip art or
third-party illustration was used, and none depicts an existing person or character. Porma's shirt
is inspired by the barong Tagalog. Its embroidery pattern is invented and carries no meaning. The
cultural notes shown in the app credit their references (see [design.md](design.md)).
