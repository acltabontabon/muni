# Design

The design direction for Muni: what the interface feels like, the tokens that carry it, and how each main surface is built. For what the product does, see [using.md](using.md).

## Principles

- **Thoughtful, warm, candid, quietly playful.** Calm enough that hard feedback is comfortable to write and to hear.
- **Paper and ink.** Bone paper, near-black ink and one burnt-red accent. The primary action is ink, not colour.
- **Words before chrome.** Content sits on the page, not in boxes. Thoughts are passages with the category in the margin. Experiments and topics are numbered lines on rules.
- **Nothing loops.** Motion is short, happens once and is off under reduced motion.
- **Plain interface, Filipino roots.** *Muni* comes from *muni-muni*, to reflect. The roots show in the name, the characters' lore and the entrance scene. Interface text stays in English.

The app's line is *Keep the thought. Bring it to the conversation.* (entrance and README). The marketing site has its own headline and voice, and its own stylesheet (`site/styles.css`).

## The mark

A lowercase **m** drawn as two rounded arches. The second arch runs on and ends in a dot, the path forward. A faint mirror of the arches sits below the baseline, the reflection. The mark is inline SVG in `web/src/brand/Mark.tsx`, also exported as `favicon.svg` and the PWA icons (`design/app-icons.mjs`).

- Below 24px, or without `reflect`, the reflection is dropped. The arches and dot still read as "m".
- The dot uses `--accent`. The arches use `currentColor`.
- The wordmark sets "muni" in Fraunces next to the mark.

## Type

| Role | Face | Use |
| --- | --- | --- |
| Interface and headings | Geist (variable), features `ss01`, `cv11`, `calt` | All text. Headings are the same face, tighter and heavier. |
| Accent | Fraunces (variable), italic | The wordmark, and the one italic word in a heading. |
| Mono | System monospace | What people compare character by character: recovery key, key fingerprints, the recap's Markdown editor. |
| Baybayin | Noto Sans Tagalog | *muni-muni* in the entrance and About. |

Body text is at least 16px with a measure of about 65ch (`.measure`). Fonts are self-hosted through `@fontsource` packages, so no third-party request happens in the app. A character world adds its own display face on the person's own pages (see [Characters and rooms](#characters-and-rooms)).

## Colour

Tokens live in `web/src/styles.css` (`:root` for light, the dark block for dark). The app follows the system scheme unless the person chooses one (`public/boot.js` applies it before first paint).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#f4efe6` | `#101114` | Page |
| `--card` | `#fbf8f2` | `#16171b` | Fields, menus, cards |
| `--ink` | `#1d1b18` | `#ece7df` | Text (15:1) |
| `--ink-soft` | `#544e46` | `#b5afa5` | Secondary text |
| `--ink-faint` | `#736c62` | `#8e897f` | Quiet text (4.5:1 or more) |
| `--accent` | `#a4452a` | `#dca273` | Rubric in light, lamplight in dark (5.3:1, 8.5:1) |
| `--action` | `#1d1b18` | `#ece7df` | Primary button, with `--action-ink` |

The accent marks the one thing that matters on a page: the italic word in a heading, the collecting dot, the sun. Focus rings use it, except on a character room's writing field, where focus is ink because a red edge reads as an error.

Categories are always an icon, a word and a colour, never colour alone:

| Category | Icon | Light | Dark |
| --- | --- | --- | --- |
| Proud of | sparkle | `#8a5a16` | `#d6a452` |
| Keep | anchor | `#4a6645` | `#93b08a` |
| Improve | wrench | `#3d5775` | `#8fa9c7` |
| Stop | hand | `#963a2c` | `#d98876` |
| Try | flask | `#664c71` | `#b8a0c4` |

Status colours `--ok`, `--warn` and `--danger` reuse the Keep, Proud of and Stop values. Character worlds never redeclare them.

The entrance scene is dusk (a haze that warms to apricot at the horizon, pewter water, palms in ink) and, in dark, night (a pale moon and a few stars). Its tokens (`--sky-*`, `--sun-*`, `--sea-*`, `--land`, `--light`) sit beside the palette.

## Surfaces and motion

- Cards have a 1px `--line` border and a very soft shadow. No glassmorphism, no gradients on text.
- The only glow is the faint dusk light at the top edge of the page (`.app-bg`). The stage uses the plain paper, with no glow.
- State changes take 160 to 240ms ease-out.
- Longer motions happen once and come to rest: the 260ms room fade when a character changes, each prologue line rising in 720ms, the firefly's arrival (1.1s) and flight (0.8s), and the closing (about 4s).
- Every animation respects `prefers-reduced-motion`, which swaps it for an opacity change or nothing.
- Muni makes no sound.

## Accessibility

- Everything works from the keyboard. Dialogs trap focus (Radix). Category chips are radio groups.
- Touch targets are 44px on mobile.
- Text contrast is at least 4.5:1 in both schemes. Each character world's palette passes WCAG AA for text in light and dark (`worlds.test.ts`).
- Drag and drop always has a menu alternative.
- Loading, empty and error states are said in words where the content goes, never over the page.

## The entrance

A full-bleed dusk scene of a person resting in a duyan (hammock) between palms. The scene (`ui/scene.tsx`) has two compositions: a wide one and `UPRIGHT` for phones.

On a phone the entrance is one upright evening with no card. It has a running head (the wordmark and *muni-muni* in Baybayin), the headline, the scene, and the sign-in action where the water dissolves into paper. The palms frame the page. The sun (the moon in dark) sets behind the duyan. "Welcome back." is a heading for screen readers only.

Heights come from the smallest viewport (`svh`), so browser toolbars and help or error messages never move the content above them. An upright tablet uses the same page on a wider measure. A phone on its side puts the words beside the action.

## The workspace

The shared header exposes **Write**, **Sprints**, and **People** at every width. On a phone the
same navigation flows onto a second row, with icons, words and 44px targets. It stays at the top
and leaves the bottom edge free for the keyboard, notices and sorting controls. A keyboard-only
**Skip to content** link reaches the main working surface. The selected tab follows the current
task; unrelated account and information pages select none.

Sprints, People and Settings share one opening that stays in place while the section below it changes: a running head, the workspace name set large, and a fine rule that doubles as the evening's horizon, with the shore, duyan and sun drawn once and still. The sections hang from the rule as links. The current one has a short ink ribbon and a heavier weight, with widths reserved so nothing shifts.

Below the rule nothing is boxed. Each section has a margin column (12.5rem) with its title and a line of purpose, and its rows or controls beside it.

- **Sprints** finds and opens sprints. The current sprint is the chapter: its name, its goal in Fraunces italic, its state and its days drawn along the horizon (today in rubric, the planned retro as the sun). One action, *Open sprint*. Other sprints follow as a ledger, eight at a time.
- **People** is a directory of owners and members, each a monogram (two initials in Fraunces italic, yours in rubric) and a manage menu. A pending join request comes first, under a rubric rule. Search appears past twelve people.
- **Settings** is one form with one *Save changes*, enabled only when something changed. Unsaved edits survive a visit to another section, and closing the tab asks first. Activity is a dated log, never content.

## The sprint page

One page per sprint (`/sprints/:id`) serves every stage and everyone in it. `/capture` and `/sprints/:id/outcomes` lead to it.

**The sprint bar** opens every page of a sprint. It shows the name, a state dot with a phrase, one sentence on what that means for you, and three stops on a fine rule: *Thoughts*, *Retro*, *Outcomes*. The stops describe and never navigate.

| State | Dot |
| --- | --- |
| Not open yet | hollow |
| Collecting thoughts | filled |
| Collection closed | half |
| Retro in progress | ringed |
| Retro done | ink |

**The facilitator's control** sits in the bar's margin behind a hairline, not a tinted box. It has one ink button for the next change, a line saying what it will do, quiet links for optional work (*Group into themes*, *Present on this screen*), and *More* for routine and rare actions. Participants never see it.

**In a character's room** the bar is part of the room and takes the room's type and composition. Words, order and behaviour never change. On a phone the rooms drop their boxes and keep their character in type, rules and one motif. On a phone while writing, the bar folds to two lines and *Details* unfolds the rest.

**Below the bar** the page shows what this person does now: the writer while collecting, everyone's thoughts (without names) once collection closes, *Join the retro* while it is live, and the outcomes and recap when it is done.

Muni’s journal names the surface **Your sprint journal**, with the invitation *A small observation
now. A better conversation later.* The composer labels the category as optional, gives its prompt
control a clear name, and shows remaining characters near the limit. On a phone the save action
has its own full-width row. On desktop a fine vertical rule separates writing from the collection.
Empty collections offer an optional three-part explanation of capture, reveal and experiments.

Personal and revealed collections expose a search after six thoughts. Search includes context,
requires every search word to match, and preserves the list’s existing order. It stays on the
device. An empty result always offers a way to clear both search and category filters.

Sprint setup has named length presets and a plan review. Field errors link to the actual fields,
including opening advanced options before focusing their controls. Form drafts are account-bound
tab memory; sign-out, account changes and clearing local data erase them.

## Themes: the sorting table

The facilitator's optional work while collection is closed (`/sprints/:id/prepare`). It needs no explanation: one look shows what to do, and every action is a word on a button.

- **Thoughts are slips.** Small cards with a round check, the category as an italic word and a thin coloured edge. Tapping a slip (or Enter, Space) selects it. This is the one gesture on the page.
- **Themes are piles.** A soft panel with a number, a title and an *Open with* question, edited in place (Enter or leaving saves, Esc reverts). While slips are selected, every pile offers *Add N selected thoughts here*. Each slip in a pile has *Take out*.
- **The next pile waits.** An empty dashed pile at the end takes a name and becomes a theme with whatever is selected.
- **The selection bar** appears at the foot with the count, a name field, *or add to* every theme, *Take out*, and a clear (Esc). On a phone it is a sheet along the bottom edge.
- **Rare actions** (park, flag, merge, remove) live in each pile's ⋯ menu. Dragging a slip onto a pile also works.

Three numbered lines explain the page on the first visit and give way to a tally once a theme exists.

## The retro

A retro is a conversation, so the stage has four steps and stays out of the way: **Look back**, **Choose**, **Talk**, **Agree**. Each screen asks one question in the display face, with the word that carries it in Fraunces italic.

Each step is the same page: the question, one line on what happens and what everyone does, the content on the left, and a margin on the right. The margin holds the step's tools for the facilitator and what to do on their phone for everyone else.

- **Steps do their own housekeeping.** Leaving Choose closes the vote and orders the topics. Opening a topic starts its clock. The facilitator never works the machinery.
- **Fair votes.** A round gives at most half as many votes as there are topics (at least one, capped by the sprint's setting), so voting means leaving something out (`fairBudget` in `lib/votes.ts`). Nobody sees whose votes are whose. Counts appear when the room moves on.
- **The facilitator's cue** (`lib/cue.ts`) is a card in the facilitator's margin on their own screen. It says one line to say and one thing to do. It never decides, and everything it offers is also on the stage. *Hide lines to say* keeps only the next step.
- **Who's here.** The rail shows each person's character (or a monogram), lit while their stage or phone is open. Arrivals in the first step get one plain line that leaves on its own. After that only the faces change, so a shared screen never calls anyone out. Every count in the retro uses the same definition of *here* (`lib/attendance.ts`).
- **Quiet ways in.** A check-in the facilitator can ask on a topic or an idea (one tap is a whole answer), and *Add to this discussion* on every phone. Shared answers appear after the topic's own thoughts as counts in words and the lines people wrote, with no percentages or bars. A concern about an idea is listed first, in accent italic.
- **Agree** asks for the change first. How we will know and who owns it follow. A date and the source theme wait behind a link.
- **Presenting** (**H**) removes every control. The phone carries the private things: votes, answers, additions without a name, and saying yes to an experiment.

`web/e2e/retro.mjs` walks a whole meeting across a stage, a presenting screen and several phones.

## The first evening

A guide for a new account, from starting a team to the end of its first retro (`lib/guide.ts`, `guide/`, `ui/prologue.tsx`). It exists so nobody needs to read the docs first. Its state (prologue, on, hidden, done) belongs to the account. *Later* belongs to the tab.

- **Prologue.** Shown once after signing up or joining, before the character chooser. The entrance's evening continues full-bleed, with five short lines (three for someone joining) and a light kept with each. It ends by asking where to begin. Skip and Esc are always available.
- **Firefly.** One light settles on the corner of the next real control, with a short note. It never has a control or status of its own. It stays silent when the page already explains itself, and never appears on the stage, the phone's room or the themes table. On a phone the note docks at the bottom.
- **Sky.** The evening's stars, lit from what has happened (`GET /api/me/guide`). Seven for someone starting a team, four for a member.
- **Closing.** After the first retro, the stars settle onto the points of Muni's mark, and the guide retires.

Guidance during the retro belongs to the facilitator's cue, not to the guide.

## Characters and rooms

Eight original characters, nicknames rather than diagnoses, each with a room for the person's **own** pages: where they write, their collection, and Account. Pages the team shares or projects (workspace, themes, setup, stage, companion) always use Muni's shared presentation. A character is also its person's face in the retro, beside their name. It never travels with anything anonymous (thoughts, votes, additions, check-in answers), and whether someone's pages wear the world is their own choice (`worker/test/avatars.test.ts`).

The direction is calm, elegant and professional, with one opaque working surface, readable type, an ink primary action and one still motif. Culture shows through place, light and material, never through labels.

| Character | Room | Composition | Type |
| --- | --- | --- | --- |
| Kape, the Morning Thinker | A quiet café table | The writing surface is the table, with a narrower column beside it. A ceramic contour marks the far corner. | Young Serif |
| Guhit, the Creative | An artist's working folio | A slim margin and a broad chalk sheet. One vermilion stroke under the question. | Bricolage Grotesque, Caveat |
| Biyahe, the Commuter | A moment by the window | A band along the top, a narrow pane of view, the writing on the wide pane. The stops are stations on a line. | Source Sans 3 |
| Bola, the Neighborhood Athlete | The court after everyone leaves | The question on the left, the composer in the paint on the right, the free-throw line as its edge. The sprint bar is a flip scoreboard. | Archivo (wide and condensed) |
| Pahina, the Reader | A private reading room | A book's measure, centred. The sprint bar is a chapter opener with contents. | Newsreader |
| Himig, the Music Lover | A listening room in print | Liner notes: a credits rail with the writing beside it. The stops are a track list. | Unbounded, DM Mono |
| Porma, the Dressed-Up Dreamer | A small sense of occasion | Precise and symmetric, one surface in fine double hairlines. The sprint bar is a programme. | Bodoni Moda |
| Sibol, the Plant Keeper | A sheltered balcony | An airy writing column, the collection on a limestone ledge set lower. The stops are growth from seed to leaves. | Alegreya |

**Rules for every room**

- Navigation, words, shortcuts, status colours and behaviour are identical: drafts, the send queue, encryption, what "submitted" means, editing and deleting. The action is **Add to sprint** everywhere, including Muni's journal.
- Every room keeps one order: the question (it labels the field), one opaque field, *Need a starting point?*, **Category**, **Context**, then the one action. There is no privacy line. The Privacy page explains it once.
- On a phone every room collapses to that order, then the collection.
- Categories are always words. Nothing loops.

**How it is built**

- `worlds/characters.ts` holds ids, lore, each world's question, daily lines and empty-state line, and the cultural notes. `worlds/portraits.tsx` holds the portraits.
- `worlds/room.tsx` is the shared room (sprint label, writer, state sheet, category picker, empty collection), styled once in `worlds/worlds.css` from a few properties (`--room-heading-*`, `--room-field-*`). `worlds/rooms.tsx` maps each character to its composition in `worlds/rooms/<id>.tsx`, which holds layout and one motif only.
- Layout responds to the room's own width (container queries), so the chooser's preview (`WorldPreview.tsx`) is the real composition at a fixed width.
- The writing lives in a `WritingHost` (`ui/capture.tsx`) above the room. Changing character, or switching to Muni's journal, redraws the page around the words without losing the text, category, context or starting point.
- A world's fonts are cached by the service worker only when that world is chosen (`vite.config.ts`, `sw.ts`).
- Tests: `worlds.test.ts` (palettes, contrast), `e2e/rooms.mjs` (all eight rooms), `e2e/worlds.mjs` (chooser, theme switch, shared pages, offline).

**Cultural grounding.** The characters show everyday contemporary Filipino life: kapeng barako, the barangay basketball court, *para po* on a jeepney, balcony gardens. Identity, region, accent, skin tone and traditional dress are never a punchline. Porma's shirt is inspired by the barong Tagalog, but its pattern is invented and its room uses only an abstract hint of fine cloth. Skin tones, hair, presentation and age vary across the eight. Filipino words appear only in the lore, with meanings in the chooser's note.
