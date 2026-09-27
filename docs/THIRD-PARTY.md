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
| Character-world display faces (via Fontsource): Young Serif, DM Mono, Bricolage Grotesque, Caveat, Barlow Condensed, Archivo, Newsreader, Unbounded, Bodoni Moda, Alegreya. Only the chosen world's Latin files are downloaded and cached | SIL OFL 1.1 | Their respective project authors (see each package's `LICENSE` in `third-party-licenses.txt`) |
| React, React DOM, scheduler | MIT | Meta Platforms, Inc. and affiliates |
| React Router | MIT | React Training LLC 2015-2019; Remix Software Inc. 2020-2021; Shopify Inc. 2022-2023 |
| Radix UI primitives, Floating UI | MIT | WorkOS; Floating UI contributors |
| lucide-react (icons) | ISC | Lucide Icons and Contributors |
| clsx | MIT | Luke Edwards |
| tslib | 0BSD | Microsoft Corporation |
| @simplewebauthn/browser — passkey ceremonies in the browser | MIT | Matthew Miller |
| qrcode-generator — draws the invite QR code in the page | MIT | Kazuhiko Arase |
| Transformers.js (`@huggingface/transformers`) with `@huggingface/tokenizers`, `@huggingface/jinja` — voice recognition, loaded only when someone dictates | Apache-2.0 (jinja: MIT) | Hugging Face, Inc. |
| ONNX Runtime Web (`onnxruntime-web`, `onnxruntime-common`, incl. its WebAssembly build) — runs the speech model | MIT | Microsoft Corporation |
| their dependencies: protobufjs and `@protobufjs/*`, flatbuffers, long, guid-typescript, platform | BSD-3-Clause; Apache-2.0; Apache-2.0; ISC; MIT | their respective authors |
| Whisper small (speech model weights, ONNX conversion `onnx-community/whisper-small`, pinned revision) — served from Muni's origin to people who use voice ([VOICE.md](VOICE.md)) | MIT | OpenAI |

The exact list (63 packages at the time of writing) comes from the production dependency tree at
build time.

## Deployed with the Worker (runs on the server, not distributed)

| component | license |
| --- | --- |
| Hono | MIT — Yusuke Wada and Hono contributors |
| @simplewebauthn/server — WebAuthn (passkey) verification | MIT — Matthew Miller |
| its dependencies: @peculiar/* ASN.1 and X.509 packages, @levischuck/tiny-cbor, @hexagon/base64, pvtsutils, pvutils, tsyringe | MIT |
| asn1js | BSD-3-Clause — Peculiar Ventures, LLC |
| reflect-metadata | Apache-2.0 — Microsoft Corporation |
| tslib | 0BSD — Microsoft Corporation |

## Not redistributed

- The marketing site (`site/`) loads Geist, Geist Mono and Fraunces from Google Fonts.
- Development tools (TypeScript, Vite, Tailwind CSS, Vitest, Wrangler, Playwright, ESLint and their
  dependencies) are used to build and test; they are not part of the shipped app.
- Transformers.js's Node.js backends (`onnxruntime-node`, `sharp`) are installed with it but never
  bundled into the web app.
- The voice evaluation ([VOICE.md](VOICE.md)) used FLEURS clips (Google, CC BY 4.0); none are in the
  repository or the app.

## Project-original assets

The Muni mark, app icons (`design/app-icons.mjs`), the link-preview banner (`design/og-banner.html`
→ `site/og.jpg`), the illustrations (including the sign-in scene in `web/src/ui/scene.tsx`) and
the fictional demo data were made for this project and are covered by its license. The name and
logo are additionally covered by [`../TRADEMARKS.md`](../TRADEMARKS.md).

The eight characters (Kape, Guhit, Biyahe, Bola, Pahina, Himig, Porma, Sibol) — their portraits
(`web/src/worlds/portraits.tsx`), their worlds' illustrations (`web/src/worlds/art/*.tsx`), the
worlds' styling (`web/src/worlds/worlds.css`) and their words (`web/src/worlds/characters.ts`) —
are original work made for Muni in 2026 and covered by the project license (Apache-2.0). They
are hand-authored vector drawings written as SVG in code: no image-generation model, stock art,
clip art or third-party illustration was used, and none depicts an existing person or character.
Porma's shirt is *inspired by* the barong Tagalog; its embroidery pattern is invented and carries
no meaning. The cultural notes shown in the app credit their references (see `docs/DESIGN.md`).
