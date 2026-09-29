import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '@/lib/auth'
import { useDocumentTitle } from '@/ui'
import { DeviceControls } from '@/ui/menus'
import { InfoShell } from '@/ui/shell'

/** A link's #section, readable; a malformed one ("#%") is just no section. */
const fragment = (hash: string) => {
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return ''
  }
}

/**
 * Privacy & data: the one place Muni explains who can see what you write, what teammates and
 * facilitators can do, whether authorship is kept, what encryption protects and what Muni keeps.
 * Everywhere else links here instead of repeating it. Public, so the sign-in screen, About and
 * munimuni.app can link here too.
 *
 * Every statement is backed by code, configuration or a stated commitment: docs/privacy-claims.md
 * maps each one to its evidence. Change them together.
 *
 * The facts below describe this deployment (act.munimuni.app): its operator, contact and service
 * providers. Another deployment must change them, and the provider paragraphs that name Cloudflare,
 * Resend, GitHub Pages and Google Fonts.
 */
const OPERATOR = 'Alvin Cris Tabontabon'
const CONTACT = 'me@acltabontabon.com'
const UPDATED = '29 September 2026'

const SECTIONS = [
  ['visibility', 'Who sees your thoughts, and when'],
  ['team', 'What teammates and facilitators can do'],
  ['authorship', 'Is your name kept with what you write?'],
  ['encryption', 'What encryption protects, and its limits'],
  ['collect', 'What Muni collects and keeps'],
  ['device', 'On this device'],
  ['contact', 'Questions and requests'],
] as const

export function Privacy() {
  useDocumentTitle('Privacy & data')
  const { me } = useAuth()
  const { hash } = useLocation()
  // Links like /privacy#visibility land on their section (the router doesn't scroll for us).
  useEffect(() => {
    if (hash) document.getElementById(fragment(hash))?.scrollIntoView()
  }, [hash])
  return (
    <InfoShell>
      <Page signedIn={!!me} />
    </InfoShell>
  )
}

function Page({ signedIn }: { signedIn: boolean }) {
  return (
    <article className="mx-auto max-w-2xl pb-16">
      <h1 className="font-display text-3xl leading-tight">Privacy &amp; data</h1>
      <p className="mt-3 text-lg text-ink-soft">Who can see what you write, what Muni keeps, and where its protection stops.</p>
      <p className="mt-2 text-sm text-ink-soft">This describes Muni as run at act.munimuni.app. Last updated {UPDATED}.</p>

      <section aria-labelledby="short-title" className="mt-8 rounded-[var(--radius-card)] border border-line bg-card p-5 sm:p-6">
        <h2 id="short-title" className="font-display text-lg">In short</h2>
        <ul className="mt-3 space-y-2.5 text-[15.5px] leading-relaxed">
          <Point>Until collection closes, only you can read your thoughts — not your team, not the facilitator, not workspace owners. Then everyone in the sprint sees them together, in random order, without names.</Point>
          <Point>Facilitators run the retro: they close collection, group thoughts into themes and can download them. Nobody on the team can look up who wrote what.</Point>
          <Point>Muni does keep a private record of who wrote each thought, so only you can edit yours. It’s never shown to your team, but your wording can still give you away.</Point>
          <Point>Sprints are encrypted on your team’s devices by default, and Muni’s servers don’t hold the keys to read them. Names, dates and who wrote what aren’t encrypted.</Point>
          <Point>Muni keeps what it needs to run and deletes a finished sprint’s thoughts after about 90 days by default. No analytics, no advertising, no AI, and nothing is sold.</Point>
        </ul>
      </section>

      <nav aria-label="On this page" className="mt-8">
        <h2 className="text-sm font-medium text-ink-soft">On this page</h2>
        <ol className="mt-2 grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-2">
          {SECTIONS.map(([id, title]) => (
            <li key={id}><a href={`#${id}`} className="inline-block py-1 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent">{title}</a></li>
          ))}
        </ol>
      </nav>

      <Section id="visibility">
        <Item title="While collection is open">Only you can see your thoughts. Teammates, the facilitator and workspace owners get no list, no count and no sign that you’ve written anything. You can edit or delete a thought until collection closes.</Item>
        <Item title="When it closes">Only the sprint’s facilitator can close collection, and Muni asks them to confirm first. From then on nobody can edit or delete a thought, including you.</Item>
        <Item title="After it closes">Everyone taking part in the sprint sees all the thoughts at once, in random order: the text and any category, impact, “what might help” and “when in the sprint” you added — without your name, the time you wrote them, or anything that links your thoughts to each other. That holds on screen, on the shared stage and in downloads. Workspace owners who aren’t in the sprint can’t read them.</Item>
        <Item title="Reopening">If the facilitator reopens collection, what people have already seen stays visible to them.</Item>
      </Section>

      <Section id="team">
        <Item title="The facilitator">Opens and closes collection, groups thoughts into themes, runs the vote and the live retro, can invite people into the sprint, and can download the thoughts as they were written (Markdown). While a vote is open they see how many people have voted so far, and during a check-in how many have answered — never who, and not what — until the vote closes or they share the answers. They can’t read anyone’s thoughts before collection closes.</Item>
        <Item title="Everyone in the sprint">Reads the thoughts once collection closes, votes, answers check-ins, adds to the discussion during the retro, and can download a summary. Votes are private — only totals are shown, after a round closes. Check-in answers are private until the facilitator shares them; then everyone sees how many chose each answer and any lines people added, without names or the order they came in. What you add to a discussion appears under its topic without a name, when the facilitator shares it.</Item>
        <Item title="Workspace owners">Manage members and settings, and decide who joins the workspace: invitations (only owners see the addresses still waiting), invite codes and requests to join. Owning a workspace doesn’t let them read a sprint they aren’t part of, or find out who wrote anything.</Item>
        <Item title="Where your name does appear">In the workspace’s member list, a sprint’s participants and who is present at the retro, and on experiments you own. None of these is linked to a thought, a vote or an answer.</Item>
        <Item title="Who’s here, live">During the retro, the facilitator’s stage shows each person’s face — their character, or their initials — lit while they have the retro open on some screen, and says briefly when someone arrives or leaves. That’s all it shows: not what they’re looking at, and never what they voted, answered or added.</Item>
        <Item title="Downloads">Carry no authors, times or individual votes — only totals, and experiment owners by name — but once saved they’re outside Muni, and not encrypted.</Item>
      </Section>

      <Section id="authorship">
        <Item title="Kept, privately">Muni records which account wrote each thought, each vote, each check-in answer and each addition during the retro. That’s how only you can edit your thoughts and change your answer, and how vote limits work. No screen, download or live update shows it.</Item>
        <Item title="Never shown to your team">There’s no way in Muni to look up who wrote a thought — no button or report for facilitators or workspace owners, and nothing in shared views, the stage or downloads.</Item>
        <Item title="Who could connect them">Anyone with access to Muni’s database or its backups — the operator, or Cloudflare, which hosts it — can see which account wrote what. Encryption hides what you wrote, not that you wrote it.</Item>
        <Item title="What can still give you away">A detail only you would know, the way you write, or a small team where everyone knows who works on what. Numbers can hint too — a lone vote, a single “I have a concern” in a group of four, the facilitator’s count of voters ticking up just as you tap (it says that you voted, never what for), something added just after you were seen typing, or a thought that only appears after collection was reopened. In a small team, “without your name” isn’t the same as unknowable. Write what you’d be comfortable having read aloud.</Item>
      </Section>

      <Section id="encryption">
        <Item title="What’s encrypted">In encrypted sprints — the default — thoughts (with their impact and “what might help”), what’s added during the retro, lines added to check-in answers, theme titles and summaries, discussion notes and takeaways, experiments and their outcomes, the recap, the opening question and reasons typed for resetting a vote. Each is encrypted in the browser before it’s sent and decrypted only in the browsers of people who hold the sprint’s key. Muni’s servers store the encrypted form and don’t have the keys to open it.</Item>
        <Item title="What isn’t">Your email address and name; workspace and sprint names, sprint goals, dates and retro times; who is in a sprint and who facilitates; each thought’s category, “when in the sprint”, who wrote it and when; how thoughts are grouped; vote counts; check-in answers themselves (such as “I felt this”) and their counts; what kind an addition says it is; experiment owners, review dates and outcome status; and activity such as “closed collection”. Muni needs these to run, so keep sensitive detail out of a sprint’s name and goal.</Item>
        <Item title="Sprints set up without encryption">A facilitator can turn encryption off when setting up a sprint. Such a sprint says so everywhere it appears, and Muni’s servers can read its content.</Item>
        <Item title="Who can decrypt, and when">While collection is open, the key that reveals everyone’s thoughts is held only on the facilitator’s devices; your own thoughts are also sealed to you, so you can read and edit them. Muni’s servers don’t give the facilitator anyone’s thoughts before collection closes — a rule the servers enforce, not encryption. Closing collection is when the facilitator’s device shares the key with everyone in the sprint; people added later get it from a teammate’s device. Reopening starts a new key that, again, only the facilitator holds until it closes.</Item>
        <Item title="Your key">Made in your browser the first time you need it. Muni’s servers only ever hold it locked: by a passkey that supports unlocking (so signing in with it opens your writing on any device), by a recovery key if you make one in Account, and for each of your devices, by half of what reopens it there — the other half never leaves that device. After you sign out, a device opens it again only when you sign in again. If no passkey, device or recovery key can open it, Muni can’t either: you can start over with a new key and teammates can share current sprints with you again, but what only you could open stays closed.</Item>
        <Item title="What encryption can’t do">It relies on the app your browser loads from act.munimuni.app being the genuine one: whoever controls that code (the operator, or someone who breaks in) could change it to capture what you type or your keys. Devices won’t share a sprint’s key with a teammate whose key changed unexpectedly until someone confirms it, and your key’s fingerprint is shown in Account for comparing — but nothing here can stop a changed app. It doesn’t protect against a compromised device or browser extension, screenshots, or people in the sprint sharing what they read. Removing someone from a sprint stops their access to what’s added later, not what they already read.</Item>
        <Item title="Also">Connections are encrypted (HTTPS), and Cloudflare encrypts stored data on its disks (AES-256) with keys it manages. Sign-in tokens are stored only as one-way hashes. Muni’s encryption hasn’t yet been independently audited; <a href="https://github.com/acltabontabon/muni/blob/main/docs/ENCRYPTION.md" className="underline underline-offset-2">its design is written down</a> so anyone can check it.</Item>
      </Section>

      <Section id="collect">
        <Item title="What you write">Thoughts and their details, what you add during a retro, your votes and your check-in answers — each with the private note of who made it, above.</Item>
        <Item title="What your team builds from it">Themes, discussion notes, experiments and who owns them, and recaps.</Item>
        <Item title="Your name and character">Your display name, so teammates know who’s in a workspace and who’s at the retro, and the character you chose, which is your face beside your name in the retro. Neither is ever shown with a thought, a vote, an answer or an addition. Whether your own pages wear your character’s world is yours alone.</Item>
        <Item title="Your email address, only if you were invited at one">You sign in with a passkey, so Muni doesn’t need an address. If you accept an emailed invitation, that address is kept so later invitations and a sprint’s two reminders can reach you — never newsletters or marketing. You can remove it in Account.</Item>
        <Item title="Your passkeys">Each one’s public key, the name you give it, whether it can sync, and when it was added and last used. Your fingerprint, face, PIN or screen lock never leave your device.</Item>
        <Item title="Account and workspace records">Your sign-ins (a one-way hash of the token, how you signed in, a rough label such as “Safari on iPhone”, and when), each device that can unlock your writing (a rough label, and when it was added and last used), a history of changes to how you sign in (shown only to you), memberships and roles, requests to join a team (the people who approve see your name, any email address and how new your account is), pending invitations, and a log of administrative actions such as closing collection — who did it and to which item, never any text.</Item>
        <Item title="Abuse protection">Scrambled (hashed) forms of network addresses, for 24 hours, to limit repeated sign-in and sign-up attempts. Muni doesn’t store your IP address with your account, or anything about your device beyond those rough labels.</Item>

        <h3 id="retention" className="scroll-mt-[calc(5rem+env(safe-area-inset-top))] pt-3 font-medium text-ink">How long it’s kept</h3>
        <Item title="Finished sprints">About 90 days after a sprint is finished — the default; workspace owners can choose from 7 to 3,650 days — its thoughts, themes, votes, check-ins, notes, what was added during the retro and any unpublished recap are deleted. Agreed experiments and published recaps are kept longer, 730 days by default, so later retros can look back at them. The sprint’s name and dates remain.</Item>
        <Item title="Unfinished sprints">A sprint that is never finished isn’t deleted automatically yet.</Item>
        <Item title="A thought you delete">Is removed from Muni’s live database straight away; backups keep it for up to 30 days.</Item>
        <Item title="Your account">Your name, and any email address you were invited at, are kept while your account exists. If you leave a workspace, or an owner removes you, what you wrote stays in its sprints, without your name.</Item>
        <Item title="Deleting your account">Your name, email address, passkeys, keys and sessions are deleted straight away, and so is any workspace no one else is in. In other workspaces, what nobody has seen yet — thoughts not yet revealed, additions not yet shared, votes in an open round, unshared check-in answers — is deleted; what the team has already seen stays in its sprints, no longer tied to any account. The workspace’s activity says someone deleted their account. The last owner of a workspace others use, and the facilitator of an unfinished sprint others are in, hand those on first.</Item>
        <Item title="Housekeeping">Passkey challenges are deleted about a day after they expire. A sign-in lasts 30 days and its record is deleted a week after it ends. Security history is kept for a year; decided requests to join a team, 180 days. An email’s address and message leave Muni’s send queue once it’s sent. An invitation, with the address it was sent to, is deleted 30 days after it’s used, withdrawn or expires. The log of administrative actions (no text) is kept for 400 days.</Item>
        <Item title="Backups, logs and copies">Deleted data can remain in Cloudflare’s database backups for up to 30 days, and in request logs for up to 7. Downloaded files, screenshots and copies on someone’s device can’t be recalled.</Item>

        <h3 id="operator" className="scroll-mt-[calc(5rem+env(safe-area-inset-top))] pt-3 font-medium text-ink">Who runs Muni</h3>
        <P>Muni is run by one developer, {OPERATOR}. The rule is to access data only when it’s needed to keep Muni running and secure, to investigate abuse, or to act on a request from you — never to read thoughts out of curiosity or to find out who wrote something. That’s a commitment, not a technical barrier, and Muni keeps no separate record of when the operator looks at data. In an encrypted sprint, the operator can’t read what was written; in a sprint set up without encryption, they technically can.</P>

        <h3 id="providers" className="scroll-mt-[calc(5rem+env(safe-area-inset-top))] pt-3 font-medium text-ink">Service providers</h3>
        <Item title="Cloudflare">Hosts the app, its database and the live retro connection, so it processes everything you send to Muni. Its request logs keep, for up to 7 days, when each request happened, the address requested (only ids, never text or email addresses) and technical details such as your IP address and browser. Muni’s own logs record failures only: the page and a short error, never what you wrote or your email address.</Item>
        <Item title="Resend">Delivers Muni’s emails: your address and an invitation (the workspace’s name, the inviter’s name and a link) or a reminder (the sprint’s name and a link). Never a thought. Resend keeps delivery records under its own terms.</Item>
        <Item title="GitHub and Google (munimuni.app only)">The website at munimuni.app — not the app — is hosted on GitHub Pages, reached through Cloudflare, and loads its fonts from Google Fonts, so those companies receive a visitor’s IP address and browser details. The app serves its own fonts.</Item>
        <P>There are no analytics, advertising, session-recording, error-reporting or AI services, and no thought is sent to an AI provider or used to train one. The app’s security settings don’t let it load code from, or send data to, any other website. Personal data isn’t sold, and your email address isn’t added to any mailing list.</P>
      </Section>

      <Section id="device">
        <Item title="Keep drafts on this device: off">The default. Your draft and any thoughts waiting to be sent exist only in the open tab, and closing it loses anything unsent — Muni tells you when that applies.</Item>
        <Item title="Keep drafts on this device: on">A choice per person, per browser. Your draft, thoughts waiting to be sent, the names and retro times of the sprints they’re for, and your name and workspaces (so Muni can open offline) are stored in this browser. Anyone who can use this browser profile could read them, so turn it on only on a personal device.</Item>
        <Item title="Your encryption key">Kept here only locked, as above: it opens after you sign in, and signing out closes it in every tab. What you write is readable on the device while it’s a draft or waiting to be sent, and encrypted when it’s sent.</Item>
        <Item title="Either way">The browser keeps a few preferences, such as your theme and the last sprint you opened, and a copy of the app so it opens quickly and offline. Your sign-in is a secure cookie the page itself can’t read. Muni never stores other people’s thoughts on your device.</Item>
        <P>Signing out, or “Clear local data”, removes what this device keeps for your account and warns you first if something hasn’t been sent; neither deletes anything from Muni’s servers. “Forget this device”, in Account, also removes what lets this browser reopen your key. Muni can’t erase a device remotely.</P>
        <div id="controls" className="scroll-mt-[calc(5rem+env(safe-area-inset-top))]">
          {signedIn ? (
            <div className="rounded-[var(--radius-card)] border border-line bg-card p-5">
              <h3 className="font-medium text-ink">On this device</h3>
              <div className="mt-3"><DeviceControls /></div>
            </div>
          ) : (
            <P><Link to="/signin?next=%2Fprivacy%23controls" className="underline underline-offset-2">Sign in</Link> to change what this device keeps.</P>
          )}
        </div>
      </Section>

      <Section id="contact">
        <Item title="What you can do yourself">Edit or delete your thoughts while collection is open; turn a sprint’s reminder emails off in {signedIn ? <Link to="/account#notifications" className="underline underline-offset-2">Account</Link> : 'Account'}; change your name and sign out other devices there too. Leave a workspace from its People page, and delete your account from {signedIn ? <Link to="/account#delete" className="underline underline-offset-2">Account</Link> : 'Account'}. Workspace owners choose how long finished sprints are kept, and remove members.</Item>
        <Item title="Not in the app yet">Downloading everything you’ve written. Until then, write to {CONTACT}.</Item>
        <P>Write to <a href={`mailto:${CONTACT}`} className="font-medium text-ink underline underline-offset-2">{CONTACT}</a> with questions about privacy or requests about your data. Muni is run by one person, so a reply may take a few days. This page changes when the way Muni handles data changes; the date at the top says when it last did.</P>
      </Section>

      <p className="mt-12 border-t border-line pt-6 text-sm text-ink-soft">
        <Link to="/about" className="underline underline-offset-4 hover:text-ink">About Muni</Link> ·{' '}
        <a href="/third-party-licenses.txt" className="underline underline-offset-4 hover:text-ink">Third-party licenses</a>
      </p>
    </article>
  )
}

function Section({ id, children }: { id: (typeof SECTIONS)[number][0]; children: ReactNode }) {
  const title = SECTIONS.find(([s]) => s === id)![1]
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-[calc(5rem+env(safe-area-inset-top))]">
      <h2 id={`${id}-title`} className="font-display text-xl">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <p className="text-[15.5px] leading-relaxed text-ink-soft">
      <strong className="font-medium text-ink">{title}.</strong> {children}
    </p>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[15.5px] leading-relaxed text-ink-soft">{children}</p>
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="dot dot--submitted mt-[0.55em]" />
      <span>{children}</span>
    </li>
  )
}
