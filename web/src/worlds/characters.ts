/**
 * Muni's eight characters: who they are, the world their person's pages take on, and the few
 * words each world is allowed to say. Everything a character contributes to the interface is
 * written here, once, so it's easy to review: names, lore, one invitation per day, the empty
 * collection's line, and the notes that credit where the ideas come from.
 *
 * A character is a nickname, not a diagnosis. It's private to the person who chose it: never shown
 * to their team, never attached to what they write, never sent anywhere but their own account.
 * Ids are stable (stored on accounts; the Worker keeps the same list in src/lib/avatars.ts).
 */
export const AVATAR_IDS = ['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol'] as const
export type AvatarId = (typeof AVATAR_IDS)[number]

export interface Character {
  id: AvatarId
  name: string
  title: string
  /** The lore, one line. */
  line: string
  /** Two or three sentences. */
  bio: string
  funFact: string
  /** What the name means, for the cultural note. */
  meaning: string
  /** A short description of the portrait, for people who can't see it (the chooser only). */
  portrait: string
  world: {
    name: string
    /** One sentence for the chooser's preview. */
    summary: string
    /** The writing page's question. It labels the field, so it must stay a plain invitation to write. */
    heading: string
    /** One quiet line under the heading, shown one a day (never per render). */
    invitations: [string, string, string]
    /** The empty collection's line: the page's one trace of wit. */
    empty: string
    /** The display face, loaded early when this world is chosen. */
    font: string
  }
  /** Where this character's everyday details come from, credited plainly. */
  context: string
  /** The browser's theme colour (the world's paper), light and dark. Tested against worlds.css. */
  themeColor: { light: string; dark: string }
}

export const CHARACTERS: Record<AvatarId, Character> = {
  kape: {
    id: 'kape',
    name: 'Kape',
    title: 'The Morning Thinker',
    line: 'Has been stirring the same coffee for 40 minutes. The coffee is ready. Kape is not.',
    bio: 'Kape orders a kapeng barako at 7:02 and reaches a conclusion somewhere around lunch. Believes every decision improves if you look at it over a cup first, and has never needed a refill, because the first cup is still going.',
    funFact: 'Owns a spoon that has travelled an estimated eleven kilometres, entirely in circles.',
    meaning: 'kape — coffee',
    portrait: 'Messy wavy hair, a loose linen shirt, a coffee mug held close, and a very calm expression.',
    world: {
      name: 'A quiet café table',
      summary: 'A warm table with room to write, and your thoughts kept close beside it.',
      heading: 'What’s on your mind?',
      invitations: ['No rush. The table is yours for as long as you need.', 'Set one thought down while it’s still warm.', 'Start with whatever comes first.'],
      empty: 'No thoughts yet. The table is yours all morning.',
      font: 'Young Serif',
    },
    context: 'Kapeng barako is coffee from the Liberica species, grown above all in Batangas and Cavite: strong, and a morning fixture in many Filipino homes.',
    themeColor: { light: '#f4ede3', dark: '#17120e' },
  },
  guhit: {
    id: 'guhit',
    name: 'Guhit',
    title: 'The Creative',
    line: 'Opened a notebook to process one feeling. Accidentally drafted a barangay master plan.',
    bio: 'Guhit can’t draw a line without asking where it wants to go next. A grocery list became a floor plan, the floor plan became a mural proposal, and the mural now has a subcommittee. Guhit chairs it.',
    funFact: 'Every sketchbook is labelled FINAL. There are fourteen.',
    meaning: 'guhit — a line; a drawing',
    portrait: 'Curly hair tied up in a bandana, a pencil behind one ear, a paint-flecked overshirt, and a grin mid-idea.',
    world: {
      name: 'An artist’s working folio',
      summary: 'A clean sheet in a working folio, a margin for notes, and an archive of what you’ve kept.',
      heading: 'What caught your eye?',
      invitations: ['Rough is fine. Rough is how it starts.', 'One line first. The rest can follow.', 'Sketch what happened; tidy it later.'],
      empty: 'A blank page. Already being considered for a mural.',
      font: 'Bricolage Grotesque Variable',
    },
    context: 'A barangay is the smallest unit of local government in the Philippines: a neighbourhood with its own hall, captain and, often, a basketball court.',
    themeColor: { light: '#eeebe5', dark: '#141413' },
  },
  biyahe: {
    id: 'biyahe',
    name: 'Biyahe',
    title: 'The Commuter',
    line: 'Rehearsed “para po” seven times. Still missed the stop. Now entering a new character arc.',
    bio: 'Biyahe does the best thinking in transit: forehead near the glass, city lights sliding past like a film with no plot. Every ride home is a quiet montage, and every missed stop a plot twist nobody asked for.',
    funFact: 'Has a favourite window seat on a route Biyahe has never once taken on purpose.',
    meaning: 'biyahe — a trip; a journey',
    portrait: 'Wind-tousled hair, a bag strap across the chest, and a gaze somewhere past the window.',
    world: {
      name: 'A moment by the window',
      summary: 'A window seat on the way home, the city holding still outside, and your day in order.',
      heading: 'What stayed with you today?',
      invitations: ['Somewhere between two stops, a thought. Keep it.', 'Write it down before the view changes.', 'Look back down the road a little. What stands out?'],
      empty: 'Nothing here yet. Your first thought may be one stop away.',
      font: 'Source Sans 3 Variable',
    },
    context: '“Para po” is how a passenger politely asks a jeepney driver to stop. Jeepneys, the open-backed shared minibuses of Philippine streets, stop wherever someone says it.',
    themeColor: { light: '#eceeec', dark: '#0f1519' },
  },
  bola: {
    id: 'bola',
    name: 'Bola',
    title: 'The Neighborhood Athlete',
    line: 'Said “last game” at 6 p.m. The sun has since returned. Nobody is legally certain who won.',
    bio: 'Bola treats the barangay court like a stadium and every pickup game like a finals rematch. The trash talk is delivered with love and zero evidence, and the score is kept in five different heads, none of them in agreement.',
    funFact: 'Has retired from basketball four times. Each farewell tour lasted one afternoon.',
    meaning: 'bola — a ball',
    portrait: 'Braids under a headband, an original jersey, and a wide, completely confident grin.',
    world: {
      name: 'The court after everyone leaves',
      summary: 'The free-throw line on an empty court: a painted lane to write in, and the low sun on warm concrete.',
      heading: 'What’s worth talking about?',
      invitations: ['The game’s over. Replay one moment.', 'No scoreboard here. Just what happened.', 'Say what you saw from the sideline.'],
      empty: 'The court is open. Your first thought has home advantage.',
      font: 'Archivo Variable',
    },
    context: 'Nearly every barangay has a basketball court, and neighbourhood leagues (the liga) fill them with games, often through the summer.',
    themeColor: { light: '#f1ebe1', dark: '#121614' },
  },
  pahina: {
    id: 'pahina',
    name: 'Pahina',
    title: 'The Reader',
    line: 'Read one sentence, then stared at the wall for 28 minutes. Calls this finishing a chapter emotionally.',
    bio: 'Pahina reads slowly on purpose, filling the margins with small gasps and question marks. Is currently halfway through six books and fully committed to all of them, in spirit.',
    funFact: 'Uses receipts as bookmarks, then reads the receipts too.',
    meaning: 'pahina — a page',
    portrait: 'Short silver hair, round glasses, a cardigan over a tee, and a book held close.',
    world: {
      name: 'A private reading room',
      summary: 'A book-width page, generous margins, and your thoughts set like a small anthology.',
      heading: 'What would you underline?',
      invitations: ['A sentence will do.', 'Mark the page you’d come back to.', 'A footnote for this sprint, in your own words.'],
      empty: 'No entries yet. A suspiciously peaceful opening chapter.',
      font: 'Newsreader Variable',
    },
    context: 'Pahina is simply “page”. The reading room is imagined: any corner with a lamp and a chair will do.',
    themeColor: { light: '#f6f1e7', dark: '#15120f' },
  },
  himig: {
    id: 'himig',
    name: 'Himig',
    title: 'The Music Lover',
    line: 'Made a playlist for a five-minute walk. It has three acts, a betrayal, and a redemption arc.',
    bio: 'Himig hears a soundtrack under everything: the rice cooker’s click is a key change, a passing tricycle is the bridge. Walks to the corner store in slow motion when the chorus hits, and has never once explained why.',
    funFact: 'Has an unreleased concept album entirely about waiting for the kettle.',
    meaning: 'himig — a melody; a tune',
    portrait: 'An undercut, big headphones, a relaxed overshirt, and eyes closed mid–music video.',
    world: {
      name: 'A listening room in print',
      summary: 'Liner notes for your sprint: a rail of credits, room to write, and a calm rhythm. No sound.',
      heading: 'What’s still playing in your head?',
      invitations: ['Start anywhere. The order can come later.', 'The moment you keep replaying, maybe.', 'Every sprint has a refrain. What was yours?'],
      empty: 'Your collection is quiet. The imaginary soundtrack is not.',
      font: 'Unbounded Variable',
    },
    context: 'Tricycles — a motorbike with a sidecar — are the short-hop rides of Philippine neighbourhoods; you’ll hear one long before you see it.',
    themeColor: { light: '#ecebe8', dark: '#111015' },
  },
  porma: {
    id: 'porma',
    name: 'Porma',
    title: 'The Dressed-Up Dreamer',
    line: 'Dressed like the guest of honour. Came downstairs to collect a parcel. Accepted the responsibility.',
    bio: 'Porma believes ordinary days deserve a dress code. Receives deliveries in a pressed, barong-inspired shirt, signs for them with a fountain pen, and has thanked more than one courier in a short, moving speech.',
    funFact: 'Keeps an outfit for waiting for the water to boil. It has a matching pocket square.',
    meaning: 'porma — style; looking sharp',
    portrait: 'Immaculately swept hair, a sheer barong-inspired shirt with a fine embroidered panel, and a faraway look.',
    world: {
      name: 'A small sense of occasion',
      summary: 'Careful proportions, fine borders, and your thoughts kept like well-filed correspondence.',
      heading: 'What’s worth noting?',
      invitations: ['One thing, said well.', 'Take a moment. Say it plainly.', 'Honest is the dress code.'],
      empty: 'The collection is empty. Somehow, still overdressed.',
      font: 'Bodoni Moda Variable',
    },
    context:
      'The barong Tagalog is the Philippines’ national formal shirt, traditionally sheer piña or jusi and embroidered by hand; Lumban, Laguna is known as the country’s embroidery capital, and Aklan’s piña handloom weaving is on UNESCO’s intangible heritage list (2023). Porma’s shirt is only inspired by it: its pattern is invented and carries no meaning.',
    themeColor: { light: '#f7f4ee', dark: '#0f0f10' },
  },
  sibol: {
    id: 'sibol',
    name: 'Sibol',
    title: 'The Plant Keeper',
    line: 'Gave every plant a name and a performance review. The pothos is exceeding expectations. Management is struggling.',
    bio: 'Sibol runs the balcony like a small, gentle company: weekly check-ins, clear feedback, snacks (fertiliser). Nobody has ever been let go, only repotted.',
    funFact: 'The calamansi has asked for a raise. Negotiations are ongoing.',
    meaning: 'sibol — a sprout; to spring up',
    portrait: 'A loose wavy bun with a leaf clip, rolled sleeves, and a little soil on one knuckle.',
    world: {
      name: 'A sheltered balcony',
      summary: 'Soft light, room to breathe, and a quiet place for what you’ve noticed.',
      heading: 'What’s worth tending to?',
      invitations: ['Something small is fine. Small things grow.', 'What needed a little more light this sprint?', 'Plant one observation. See what grows.'],
      empty: 'Nothing planted yet. The pothos believes in you.',
      font: 'Alegreya Variable',
    },
    context: 'Plantito and plantita (plant + tito or tita, uncle or aunt) became everyday words in 2020, when balcony and windowsill gardening took off across the Philippines. Calamansi is the small, sour citrus found in many of those pots.',
    themeColor: { light: '#eef0e8', dark: '#0f1411' },
  },
}

/** Muni's own words, for everyone without a world (no character, or its theme switched off). */
export const MUNI_WORDS = {
  empty: 'Nothing kept yet. Write the first thing on your mind — it will settle here, in your own words.',
}

/** The same note about all eight, shown in the chooser and settings. */
export const ABOUT_CHARACTERS =
  'Inspired by everyday Filipino life: a morning coffee, a barangay court, a jeepney ride home, a balcony full of plants. Eight made-up people can’t speak for everyone’s experience — they’re here to keep you company while you think.'

/** A character by id, or null for anything else (unknown, retired, not a string, or a prototype key). */
export function resolveAvatar(id: unknown): Character | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CHARACTERS, id) ? CHARACTERS[id as AvatarId] : null
}

/** One invitation a day: the same all day, whatever re-renders. */
export function invitationFor(c: Character, day: Date = new Date()): string {
  const n = Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000)
  return c.world.invitations[n % c.world.invitations.length]
}

export const DEFAULT_AVATAR: AvatarId = 'kape'
