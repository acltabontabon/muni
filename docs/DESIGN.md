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

- Display: **Fraunces** (variable serif, optical sizes) for titles, stage
  headings, theme names and the wordmark. Confident, slightly warm.
- Body/UI: **Inter** with `font-feature-settings: "cv11", "ss01"`.
  Comfortable measure (~65ch) and 16px minimum.
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
thought bubbles: a regular grid, a small two-circle tail tinted by category, text first.

Category accents are restrained and always paired with an icon and a label:

| category | icon | light | dark |
| --- | --- | --- | --- |
| Proud of | sparkle | `#b7791f` | `#f0b64f` |
| Keep | anchor | `#2f7a5c` | `#5fc79a` |
| Improve | wrench | `#3a6ea5` | `#7fb0e8` |
| Stop | hand | `#a3423f` | `#ef8a86` |
| Try | flask | `#6b4fa0` | `#b39ae6` |

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
8. Settings — account, privacy explanation, workspace, retention, AI.

## Accessibility

Keyboard-first: every action reachable by Tab, category chips are radio
groups, dialogs trap focus (Radix), 44px touch targets on mobile, contrast
≥ 4.5:1 for text in both themes, drag-and-drop always has a menu alternative.
