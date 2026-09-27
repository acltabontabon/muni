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

## The entrance on a phone

Not the wide page stacked up: one evening from the top of the screen to the bottom, set like the
opening of a book. A quiet running head (the wordmark, and *muni-muni* in Baybayin on the same line,
smaller and quieter); the line — “Keep the / *thought*.” with the second sentence as its subtitle;
then the scene in its own upright composition (`UPRIGHT` in `ui/scene.tsx`): the palms stand whole
and frame the page, the sun (the moon at night) sets behind the duyan so the person resting is the
silhouette at the centre, and the water below dissolves back into paper where the one action rests.
No card and no frame; “Welcome back.” stays as the heading for screen readers only, because the
headline already says it. Help, the footer links and “Create an account” are quiet, with 44 px
targets. Heights come from the smallest viewport (`svh`), never from what's below, so Safari's
toolbars and an opened help or error message move nothing above them; larger text simply scrolls.
An upright tablet uses the same page on a wider measure; a phone on its side puts the words and
the evening beside the action.

## The workspace

*A shared journal, each sprint an open chapter.* Sprints, People and Settings share one opening
that stays in place while only the section beneath it changes: a quiet running head, the
workspace's name set large, and a single fine rule that is also the evening's horizon — the shore,
the duyan and the sun (the moon at night) resting on it at the far end, drawn once and still. The
sections hang from that rule as links; the current one carries a short ink ribbon and a heavier
weight (widths reserved, so nothing moves). A section's own action sits on the rule's right: *New
sprint*, *Invite*. On a phone the name takes the full measure and the shore rests on the rule below it.

Below the rule nothing is boxed. Content sits on the page with rules and a margin column: each
section's title and a line of why on the left (12.5rem), its rows or controls on the right.

- **Sprints.** A place to find a sprint and open it, not a second copy of it. The current sprint is
  the chapter: its name set large, the goal in Fraunces italic, where it is in one line (the sprint
  bar's dot and phrase, and *You’re facilitating* when you are), its days drawn as the opening's
  horizon (a tick a day, the stretch travelled inked in, today standing up in rubric, the planned
  retro as the sun — the moon at night — resting on the line; the same in words beneath), who's in
  as the People page's monograms, and one way in: *Open sprint*. Sections still to come (*To
  revisit*, *Earlier sprints*) say in one quiet line what will gather there.
  Beside it, quieter, behind a hairline: the retro as planned (date large, time and zone, how soon,
  your own time), and experiments due for another look. Other
  sprints follow as a ledger — title, dates and state on shared columns — eight at a time; every
  row opens the sprint's own page.
- **People.** A directory: owners and members as two groups on one fine-ruled list, each person a
  monogram (two initials in Fraunces italic; yours in rubric), a name that wraps rather than
  truncates, an address only where an owner may see it, and the manage menu (⋯) in one column.
  Someone asking to join comes first under a rubric rule, because it needs a decision. Invitations
  and invite codes follow for those who manage them. A search field appears past twelve people.
- **Settings.** One form, one *Save changes* (enabled only when something changed; *Discard* beside
  it). Edits not yet saved are kept while you visit another section and said so; closing the tab
  asks first. Values are checked where they're typed. Activity is a dated log, never content.

Loading is said where the content goes (quiet lines, only after 350 ms), never over the page; an
empty state only after an answer says there's nothing; a failed load says so in the section with
*Try again*.

## Illustration

The entrance's duyan scene appears at a few deliberate moments, never as a full-height backdrop:
a small postcard beside “My thoughts” (and larger in its empty state), the horizon under a
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

## A sprint's page

One page per sprint (`/sprints/:id`), for every stage and everyone in it. "Write", the logo and the
old `/capture` link are shortcuts to it for the sprint that's collecting; the old `/outcomes` link
lands on it too.

**The sprint bar** is the same place at the top of every page of a sprint (its page and its
themes). The name set like a chapter; where it is — a dot and a phrase (hollow *Not open yet*,
filled *Collecting thoughts*, half *Collection closed*, ringed *Retro in progress*, ink *Retro
done*); one sentence on what that means for you; and three stops on one fine rule — *Thoughts*,
*Retro*, *Outcomes* — each with a line (*Open now*, *Planned Sat 3 Oct, 15:00*, *Held Mon 28 Sep*).
The stops describe; they never navigate, so looking can't change anything. The retro's date is
always *planned* until the facilitator starts it; a passed date changes nothing by itself.

**The facilitator's control** sits in the bar's margin column behind a hairline — not a tinted box
— under *You’re facilitating*: one ink button for the next change (*Open collection*, *Close
collection…*, *Start the retro…*, or *Open the stage* while live), what it will do written under
it, then quiet underlined links for the stage's optional work (*Group into themes (optional)*,
*Present on this screen*) and *More* for routine and rare things (invite, edit details, reopen,
pause, archive). Changes that reveal, reopen, start or stop say exactly what they do before they
happen. Participants never see the column; what they do next is the page itself.

**In a character's room** the bar is part of the room: each composition sets it where its sprint
label used to be and draws it in its own manner (the room table below), in the room's type. The
words, their order and what each control does never change; the bar lays itself out for the space
it's given (container queries), so it reads down a margin or a rail and across a band. There is no
second sprint label in the room. On a phone the rooms drop their boxes — the table, the sheet, the
window, the frame and the ledge become the page — and keep their character in type, rules and one
motif.

**Below the bar** the page is what this person does now: the writer while collecting (Muni's
journal, or their character's room; with another sprint collecting, *Also collecting* moves the
words there), their thoughts read-only once closed, *Join the retro* while
it's live, and the outcomes and recap once it's done. On a phone, while writing, the bar folds to
two lines — the name with the facilitator's button, then the state and the planned retro —
and *Details* unfolds the rest, so the field and *Add to sprint* stay in the first screen.

## Characters and worlds

*Choose a character. Step into their world. Make room for your own thoughts.*

Eight original characters — nicknames, not diagnoses — each with a room of its own for the
person's **own** pages: where they write and their collection (a sprint's page, as it looks on
their own screen, in every state) and Account. Pages worked on together or shown to the room
(workspace, themes, setup, stage, companion) always keep
Muni's shared presentation; the stage is projected and anonymous thoughts stay visually neutral.
A character is private to its owner: it is returned only by `/api/auth/me` and never appears in
anything a teammate sees (tested in `worker/test/avatars.test.ts`).

**Direction (since the calm reset).** Elegant, artistic, calm, professional, personal, subtly
Filipino: a well-designed place to pause and write, carried over from the entrance — one opaque
working surface, readable UI type, an ink primary action, underlined text for quieter ways, one
still motif, short literal words. Culture comes through places, light, material and rhythm, never
labels. The lore lives in the chooser and settings; the writing page doesn't reenact it. Earlier
comic scenes (the master plan, the 40-minute stir, the missed stop, the last game) are retired.

| room | composition | sprint | collection | motif (still) | type |
| --- | --- | --- | --- | --- | --- |
| **Kape** — The Morning Thinker · *a quiet café table* | the writing surface is the table, dominant; a narrower column beside it, a soft rule between | a table card above the table, on its two columns; the stops a short menu between dotted rules, a coffee bean each | an editorial list, hairline dividers, a dotted rule as the only receipt | a ceramic contour at the table's far corner | Young Serif |
| **Guhit** — The Creative · *an artist's working folio* | asymmetric: a slim margin, a broad chalk sheet with one layer under it | a folio label in the margin: the state noted in vermilion Caveat, the stops an index numbered 01–03, the current one ringed | a two-column folio in the sheet's columns, its label in the margin | one vermilion ink stroke under the question, two registration marks; the day's line in Caveat | Bricolage Grotesque |
| **Biyahe** — The Commuter · *a moment by the window* | one broad window: a band along the top, a narrow pane of the view, the writing on the wide pane | the window's band: the stops as stations on a line, the train at the bright one | by day on a fine rule aligned with the view, each thought keeping its time | mist, a thin horizon, the city's first lights, a small dusk sun (a moon at night) | Source Sans 3 |
| **Bola** — The Neighborhood Athlete · *the court after everyone leaves* | strong horizontals: a weighted rule, the sprint and question on the left, the composer on the right | a scoreboard over the court: the name wide and heavy, three period panels, the one being played in court green | an even two-to-three-column grid under weighted rules | a cropped corner of the court (the key, the three-point arc) in clay | Archivo, wide |
| **Pahina** — The Reader · *a private reading room* | a book's measure, centred | a chapter opener: the title in italic, then *Contents* — I, II, III with dotted leaders — and the next step centred | a small anthology: serif entries, short centred rules, dates in the margin | a ribbon bookmark; the collection's label as a bookplate | Newsreader (the field too) |
| **Himig** — The Music Lover · *a listening room in print* | liner notes: a credits rail, the writing offset beside it | the credits rail: facts in mono, the stops a track list (A1, A2, B1), the playing one marked in brass | a steady list with a column of small credits (category, time) | half a record at the rail's edge, a brass rule | Unbounded, DM Mono |
| **Porma** — The Dressed-Up Dreamer · *a small sense of occasion* | precise and symmetric: a centred caption, one surface in fine double hairlines | a programme above the frame: a double hairline under the title, three parts between rules, a diamond over the current one | filed as correspondence, two columns | a faint warp-and-weft strip along the frame's top edge (abstract; no motif with a meaning) | Bodoni Moda |
| **Sibol** — The Plant Keeper · *a sheltered balcony* | an airy writing column; the collection further along, on a limestone ledge set lower | a limestone plaque: the stops as growth — a seed to come, a sprout for now, leaves for what's grown | a calm list on the ledge | one calamansi sprig in line at the outer edge; still light through leaves | Alegreya |

**Rules.** Navigation, words, shortcuts, filters, paging and status colours are identical in every
room, and so is behaviour: drafts, the send queue, encryption, what “submitted” means, editing and
deleting. The same action has the same name everywhere — **Add to sprint**, in Muni's journal too.
Every room keeps one order: where the thought goes, the question (it labels the field), one calm
opaque field, *Need a starting point?* (one deterministic prompt at a time), **Category** (one
optional choice from a short list; a sheet on phones) and **Context** (folds to a summary), the one
action (⌘/Ctrl-Enter in its tooltip; no keycaps on screen), the privacy line as plain text. On a
phone every room collapses to that order, then the collection. Focus on the field is ink, not the
accent (a red edge reads as an error). Categories are always words. Nothing loops: the only motion
is a 260 ms fade when the character changes, a disclosure rising, and a new thought settling into
the list — none under reduced motion.

**How it's built.** `worlds/room.tsx` holds the shared room — the sprint label and its details
(other sprints grouped by team), the writer, the state sheet, the category picker, the empty
collection — styled once in `worlds.css` (“The room”) from a few properties
(`--room-heading-*`, `--room-field-*`). `worlds/rooms.tsx` maps each character to its composition
(`worlds/rooms/<id>.tsx`: layout and one motif, nothing else) and renders it. The writing lives in a
`WritingHost` (`ui/capture.tsx`) above the room, so changing character — or switching the theme off
to Muni's journal — redraws the page around the words: text, category, open context and starting
point stay. Layout answers the room's own width (container queries), so the chooser's miniature
(`WorldPreview.tsx`) is the real composition at a fixed virtual width. Each world's palette passes
WCAG AA for text in light and dark, and Muni's semantic colours (status, categories, ok/warn/danger)
are never redeclared (`worlds.test.ts`). `e2e/rooms.mjs` covers all eight rooms end to end;
`e2e/worlds.mjs` covers the chooser, the theme switch, shared pages and offline.

`characters.ts` holds ids, lore, each world's name, question, three daily lines, the empty
collection's one line of wit, and the cultural notes; `portraits.tsx` the eight portraits (chooser,
settings, the account button). `public/boot.js` applies the scheme and world before first paint.
Each world's fonts are cached by the service worker only when that world is chosen
(`vite.config.ts` → `sw.ts`).

**Cultural grounding.** The characters show contemporary everyday Filipino life — kapeng
barako (Liberica coffee grown mainly in Batangas and Cavite), the barangay and its basketball
court, *para po* on a jeepney, the plantito/plantita balcony gardens of 2020 — never cultural
identity, region, accent, skin tone or traditional dress as a punchline. Porma's shirt is only
*inspired by* the barong Tagalog (the national formal shirt, traditionally sheer piña or jusi and
embroidered by hand; Lumban, Laguna is known as the embroidery capital, and Aklan's piña handloom
weaving is on UNESCO's intangible heritage list, 2023); its pattern is invented, and Porma's room
uses only an abstract hint of fine cloth. Skin tones range
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

1. Workspace — one opening over Sprints (the current sprint as a chapter, then a ledger), People and
   Settings (see *The workspace*).
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
8. Settings — account and privacy on Account; the workspace's name, retention and activity in its
   Settings section.

## Accessibility

Keyboard-first: every action reachable by Tab, category chips are radio
groups, dialogs trap focus (Radix), 44px touch targets on mobile, contrast
≥ 4.5:1 for text in both themes, drag-and-drop always has a menu alternative.
