# Muni — brand and design direction

**Muni** takes its name from the Filipino *muni*, familiar through
*muni-muni*: to reflect, to consider thoughtfully. The product is a place to
set a thought down while it is fresh, look back on it together, and decide
what to try next.

- Product name: **Muni**
- Primary tagline: *Good retros start before the meeting.*
- Supporting line: *A moment to reflect. A chance to improve.*
- Short description: *Capture thoughts throughout the sprint. Reflect together. Turn insights into action.*

Use the tagline on the sign-in page and README; the supporting line in the
brand story and about panel; the short description in metadata. Do not stack
all three on one screen.

## Personality

Thoughtful, warm, candid, quietly playful. Enough character that people enjoy
opening it on a busy Tuesday; calm enough that hard feedback is comfortable to
write and to hear. Expressed through conversational writing, generous
typography, small satisfying interactions, thoughtful empty states and calm,
purposeful transitions. The Filipino roots appear in the brand story and in a
few token names (`--sinag`, *ray of light*, is the accent); the interface
itself stays plain and international.

## The mark

Three directions were explored:

1. **Paired arches** — two rounded forms side by side, reading as a lowercase
   "m" and as two thoughts placed next to each other.
2. **Reflection** — a form and its softer mirror image below a horizon line,
   literal *muni-muni*.
3. **Open path** — a lowercase "m" whose final stroke does not close, opening
   to the right.

The chosen mark combines 1 and 3 with a hint of 2: a lowercase **m** drawn as
two rounded arches; the second arch continues a little further and ends with a
dot — the path forward. A faint second copy of the arches sits beneath the
baseline at reduced opacity, the reflection. In monochrome and at 16px the
reflection is dropped and only the arches and dot remain, which still reads as
"m". It is implemented as inline SVG in `web/src/brand/Mark.tsx` and exported as
`favicon.svg`; the wordmark sets "muni" in Fraunces at optical size 72 with
the same dot on the final stroke.

## Type

- Display and body/UI: **Geist** (variable) with `font-feature-settings: "ss01", "cv11"`.
  Headings are the same sans, tighter and heavier. Comfortable measure (~65ch) and 16px minimum.
- Accent: **Fraunces** (variable serif, italic) for the wordmark and the one italic word in a
  heading.
- A character world may set its own display face on the person's own pages (see *Characters and
  worlds*); body, editor text and controls stay readable in every world.
- Mono: system monospace for verification codes only.

Fonts are self-hosted via `@fontsource-variable` packages so meeting rooms
without external network access still render correctly and no third-party
request happens on sensitive screens.

## Colour

*Ink and rubric* (`web/src/styles.css`). Warm bone paper, warm near-black ink, and one burnt-red
accent used the way a scribe used rubric: for the single thing that matters on a page (the italic
word in a heading, the focus line, the collecting mark, the sun). The primary action is ink, not
colour. Dark is *night ink*: charcoal paper, moonlit text, a lamplit accent. The entrance shares
the same tokens.

| token | light | dark | use |
| --- | --- | --- | --- |
| `--paper` | `#f4efe6` | `#101114` | page |
| `--card` | `#fbf8f2` | `#16171b` | fields, menus |
| `--ink` | `#1d1b18` | `#ece7df` | text (15:1) |
| `--ink-soft` | `#544e46` | `#b5afa5` | secondary text |
| `--ink-faint` | `#736c62` | `#8e897f` | quiet text (≥ 4.5:1) |
| `--accent` | `#a4452a` | `#dca273` | rubric / lamplight (5.3:1 / 8.5:1) |
| `--action` | `#1d1b18` | `#ece7df` | primary buttons, with `--action-ink` |

Categories are muted earth tones, each ≥ 5:1 on paper: ochre (Proud of), moss (Keep), slate
(Improve), brick (Stop), plum (Try). The scene is dusk: a haze that warms to apricot only at the
horizon, pewter water, palms in ink; at night, a pale moon and a few stars.

## Illustration

The entrance's duyan scene appears at a few deliberate moments, never as a full-height backdrop:
a small postcard beside “My thoughts” (and larger in its empty state), a horizon strip under a
workspace's name, and the evening with kept lights on a completed retro. Saved thoughts are
passages in a journal: text first, a margin marker with the category, one ⋯ menu each.

Category accents are restrained and always paired with an icon and a label:

| category | icon | light | dark |
| --- | --- | --- | --- |
| Proud of | sparkle | `#8a5a16` | `#d6a452` |
| Keep | anchor | `#4a6645` | `#93b08a` |
| Improve | wrench | `#3d5775` | `#8fa9c7` |
| Stop | hand | `#963a2c` | `#d98876` |
| Try | flask | `#664c71` | `#b8a0c4` |

## Characters and worlds

*Choose a character. Step into their world. Make room for your own thoughts.*

Eight original characters — nicknames, not diagnoses — each with an art-directed world for the
person's **own** pages: the writing page and their collection (Home, in every state) and Account.
Shared team pages (workspace, sprint guide, prepare, stage, companion, outcomes) always keep
Muni's shared presentation; the stage is projected and anonymous thoughts stay visually neutral.
A character is private to its owner: it is returned only by `/api/auth/me` and never appears in
anything a teammate sees (tested in `worker/test/avatars.test.ts`).

| world | place | light / dark | display type | the collection | its one moment |
| --- | --- | --- | --- | --- | --- |
| **Kape** — The Morning Thinker | the café corner outside of time: a tabletop, pandesal, sugar sachets, a café stamp | morning light on warm paper / the café stayed open for you | Young Serif, DM Mono | a receipt roll: torn ends, perforations, order numbers, stamp labels | a curl of steam rises from the cup |
| **Guhit** — The Creative | the gloriously unfinished studio: dot-grid sketchbook, a brush jar, a taped floor plan | sketchbook stock / slate and chalk | Bricolage Grotesque, Caveat | taped, numbered sketchbook sheets; margin notes escalating to a mural | the heading's underline finishes itself |
| **Biyahe** — The Commuter | thoughts through a moving window: a bus window holding a horizon that stays still | a daylight ride / the late ride home, city lit | Barlow Condensed | a route with a stop per thought; dates as ticket stubs | the newest ticket is punched |
| **Bola** — The Neighborhood Athlete | the court after the noise settles: the hoop, the painted arc, tsinelas courtside | sun-warmed concrete / one floodlight | Archivo (expanded and condensed) | strong spacing; dates worn like jersey numbers | the ball settles with one bounce |
| **Pahina** — The Reader | a private reading room: a stack of books, folded glasses, a lamp | afternoon by a window / a reading lamp | Newsreader | a table of contents: chapter numerals, dotted leaders | a ribbon bookmark glides to where you are |
| **Himig** — The Music Lover | the listening room for imaginary music videos: a sleeve, a record half out | sleeve paper / black vinyl | Unbounded, DM Mono | tracks (A1, A2…) divided by grooves | the record turns once |
| **Porma** — The Dressed-Up Dreamer | everyday life, unnecessarily well dressed: a cloche lifted off… a parcel | fine stationery / black tie | Bodoni Moda | an invitation archive: “No. 7”, hairlines, small caps | the monogram is pressed |
| **Sibol** — The Plant Keeper | a small balcony with room to grow: a railing, clay pots, a trailing pothos | sage-cream in dappled light / the balcony at night | Alegreya | a garden notebook: pressed leaves, plant-tag dates | a leaf unfurls |

**Rules.** Navigation, labels, actions, shortcuts, the editor, filters, paging and status colours
are identical in every world; a world changes composition, palette, type, illustration and
decoration only. Each world's palette passes WCAG AA for text in light and dark, and Muni's
semantic colours (status, categories, ok/warn/danger) are never redeclared (`worlds.test.ts`).
Art sits beside content, never behind text, and never moves while someone writes: the one moment
plays after a confirmed save, pauses in hidden tabs, and becomes a static change under reduced
motion. One joke per page: the empty collection's line, or (when there are thoughts) the day's
invitation, chosen once a day. Character words never enter the field, its placeholder, status,
errors or anything that leaves the device.

**How it's built.** `web/src/worlds/`: `characters.ts` (ids, lore, world copy, cultural notes),
`portraits.tsx` (eight portraits on one face kit; a heavier icon cut under 56px), `art/<id>.tsx`
(each world's pictures, loaded only when shown and precached for offline — 3–7 KB each),
`worlds.css` (tokens on `:root[data-world]`, composition in `@scope` blocks that stop at any
other world so a preview renders correctly inside another world's page), `world.tsx` (the
controller that sets `data-world` on `<html>` for personal paths only), `Chooser.tsx`,
`WorldPreview.tsx` (a miniature built from the real classes), `Character.tsx` (first-visit gate,
dialog, settings, the note for older accounts). `public/boot.js` applies the scheme and world
before first paint. Each world's fonts are cached by the service worker only when that world is
chosen (`vite.config.ts` → `sw.ts`).

**Cultural grounding.** The characters show contemporary everyday Filipino life — kapeng
barako (Liberica coffee grown mainly in Batangas and Cavite), the barangay and its basketball
court, *para po* on a jeepney, the plantito/plantita balcony gardens of 2020 — never cultural
identity, region, accent, skin tone or traditional dress as a punchline. Porma's shirt is only
*inspired by* the barong Tagalog (the national formal shirt, traditionally sheer piña or jusi and
embroidered by hand; Lumban, Laguna is known as the embroidery capital, and Aklan's piña handloom
weaving is on UNESCO's intangible heritage list, 2023); its pattern is invented. Skin tones range
from light to deep brown; hair is straight, wavy, curly, braided and silver; presentations are
femme, masc and androgynous, from early twenties to sixties. UI chrome stays English; Filipino
words appear only in the characters' lore, with meanings in the chooser's note.

## Surfaces and depth

Cards use a 1px `--line` border plus a very soft 1–2px shadow. Only the
stage uses larger radii and a faint radial "glow" behind the current theme.
No glassmorphism, no gradients on text.

## Motion

- 160–240ms ease-out for state changes; 400ms for the "opening the sprint"
  reveal where cards rise and settle in a staggered sequence.
- Every animation is gated on `prefers-reduced-motion`; reduced motion swaps
  to opacity-only transitions.
- Sound is off by default and there is no sound in v1.

## Screens

1. Workspace overview — sprints as a vertical timeline, current sprint first.
2. Sprint setup — a single tall form with sections, not a wizard.
3. Capture — full-width composer with category chips, sheet-like on mobile,
   "My entries" beneath.
4. Preparation studio — two-pane: ungrouped entries left, themes right;
   keyboard "move to theme" menu on every entry.
5. Stage — fullscreen dark, chapter progress rail at the top, one idea per
   screen, large type.
6. Companion — phone-friendly, follows the stage, private votes and
   "Ready to speak / Pass for now", with a visible "look around" toggle.
7. Outcomes — experiments with owners and review dates, recap, exports.
8. Settings — account, privacy explanation, workspace, retention.

## Accessibility

Keyboard-first: every action reachable by Tab, category chips are radio
groups, dialogs trap focus (Radix), 44px touch targets on mobile, contrast
≥ 4.5:1 for text in both themes, drag-and-drop always has a menu alternative.
