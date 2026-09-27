import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Wordmark } from '@/brand/Mark'
import { useAuth } from '@/lib/auth'
import { useDocumentTitle } from '@/ui'
import { DeviceControls } from '@/ui/menus'
import { AppShell } from '@/ui/shell'

/**
 * Privacy & data: the one full explanation of what Muni collects, who can see it, who processes it,
 * what protects it and what doesn't. Public, so the sign-in screen and munimuni.app can link here.
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
const UPDATED = '28 September 2026'

const SECTIONS = [
  ['collect', 'What Muni collects, and why'],
  ['visibility', 'Who can see what you write'],
  ['authorship', 'Can someone tell it was you?'],
  ['operator', 'What the operator can access'],
  ['providers', 'Service providers'],
  ['ai', 'AI'],
  ['encryption', 'Encryption, and its limits'],
  ['device', 'What stays on your device'],
  ['retention', 'How long things are kept'],
  ['controls', 'What you can do'],
  ['contact', 'Questions'],
] as const

export function Privacy() {
  useDocumentTitle('Privacy & data')
  const { me } = useAuth()
  const { hash } = useLocation()
  // Links like /privacy#visibility land on their section (the router doesn't scroll for us).
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
  }, [hash])
  const page = <Page signedIn={!!me} />
  if (me) return <AppShell>{page}</AppShell>
  return (
    <div className="min-h-dvh">
      <header className="pt-safe border-b border-line/70">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="rounded-md px-1 text-ink" aria-label="Muni home"><Wordmark size={20} /></Link>
          <Link to="/signin" className="rounded-full px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5">Sign in</Link>
        </div>
      </header>
      <main className="pb-safe px-4 pt-8">{page}</main>
    </div>
  )
}

function Page({ signedIn }: { signedIn: boolean }) {
  return (
    <article className="mx-auto max-w-2xl pb-16">
      <h1 className="font-display text-3xl leading-tight">Privacy &amp; data</h1>
      <p className="mt-3 text-lg text-ink-soft">
        What Muni keeps about you and what you write, who can see it, who else handles it, and what protects it — including where that protection stops.
      </p>
      <p className="mt-2 text-sm text-ink-soft">This describes Muni as run at act.munimuni.app. Last updated {UPDATED}.</p>

      <section aria-labelledby="short-title" className="mt-8 rounded-[var(--radius-card)] border border-line bg-card p-5 sm:p-6">
        <h2 id="short-title" className="font-display text-lg">In short</h2>
        <ul className="mt-3 space-y-2.5 text-[15.5px] leading-relaxed">
          <Point>Until collection closes, nobody on your team can read your thoughts — not the facilitator, not workspace owners.</Point>
          <Point>Afterwards, the people in that sprint see them in random order, without your name.</Point>
          <Point>New sprints are encrypted on your team’s devices before anything reaches Muni’s servers, and the servers don’t hold the keys to read them. Sprints set up before encryption aren’t covered.</Point>
          <Point>Muni still records who wrote each thought, when, and its category — encryption hides what you wrote, not that you wrote it. Your wording can still give you away.</Point>
          <Point>Muni uses your account information and what you write to provide and protect the service. We don’t sell personal data, use your contributions for advertising, or use them to train AI models.</Point>
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

      <Section id="collect">
        <Item title="Your email address, only if you add one">You sign in with a passkey, so Muni doesn’t need an address. If you add one (or your account was made with one before passkeys), it’s used to sign you in with a one-time code if you lose your passkeys, to deliver invitations sent to that address, and to send a sprint’s two reminders. It isn’t used for newsletters or marketing, and you can remove it.</Item>
        <Item title="Your display name">So teammates know who’s in a workspace, whose turn it is to speak in a retro, and who owns an experiment. It’s never shown with a thought or a vote.</Item>
        <Item title="Your character">The character you chose and whether your pages wear its world. Only you see it: it’s never shown to your team or attached to anything you write, vote or export. This browser also remembers it, so your page doesn’t flash the wrong look while it loads; signing out forgets it.</Item>
        <Item title="What you write">Thoughts — the text, plus any category, impact, “what might help” and “when in the sprint” you add — context you add during a retro, and your votes. Each is stored with a private note of which account made it, so that only you can edit or delete your thoughts and so vote limits work.</Item>
        <Item title="What your team builds from it">Themes, discussion notes, experiments and who owns them, and recaps.</Item>
        <Item title="Your passkeys">Its public key, a name you choose, whether it can sync, and when it was added and last used. Your fingerprint, face, PIN or screen lock never leave your device — Muni can’t receive them. A passkey only signs you in: it doesn’t unlock encrypted sprints.</Item>
        <Item title="Account and workspace records">Your sign-ins (a token stored only as a one-way hash, how you signed in, a rough label such as “Safari on iPhone” so you can tell your sessions apart, and when it was created and last used), a history of sign-ins and changes to how you sign in (shown only to you), memberships and roles, requests to join a team made with a shared invite code (the people who approve see your name, your email address if you added one, and how new your account is), pending invitations (the invited address), and a log of administrative actions such as closing collection or changing settings. That log records who did it and to which item, never any text.</Item>
        <Item title="Abuse protection">To limit repeated sign-in attempts, Muni keeps scrambled (hashed) forms of email and network addresses for 24 hours.</Item>
        <P>Muni doesn’t store your IP address or device details with your account. Our hosting provider’s request logs do record them, briefly — see <a href="#providers" className="underline underline-offset-2">Service providers</a>.</P>
      </Section>

      <Section id="visibility">
        <Item title="While collection is open">Only you can see your thoughts in Muni. Teammates, the facilitator and workspace owners get no list, no count and no sign that you’ve written anything. You can edit or delete a thought until collection closes.</Item>
        <Item title="Closing collection">Only the sprint’s facilitator can close collection, and Muni asks them to confirm first. From then on nobody can edit or delete a thought, including you.</Item>
        <Item title="After it closes">Everyone taking part in that sprint sees all the thoughts at once, in random order: the text and any category, impact, “what might help” and “when in the sprint” you added. They appear without your name, email, the time you wrote them, or anything that links your thoughts to each other — on screen, on the shared stage and in exports. Workspace owners who aren’t taking part in the sprint can’t read them.</Item>
        <Item title="Downloads">The facilitator can download the thoughts (Markdown or CSV), and everyone in the sprint can download a summary. These files carry no names either, but once downloaded they’re outside Muni.</Item>
        <Item title="Reopening">If the facilitator reopens collection, what people have already seen stays visible to them.</Item>
        <Item title="Votes and added context">Votes are private: only totals are shown, after a voting round closes. Context you add during a retro appears under its topic without your name, once the facilitator releases it.</Item>
        <Item title="Where your name does appear">In the workspace’s member list, the sprint’s list of participants and who is present at the retro, when you’re invited to speak, and on experiments you own. The facilitator also sees who has passed in the speaking round. None of these is linked to a thought.</Item>
      </Section>

      <Section id="authorship">
        <P>Nobody on your team has a way in Muni to look up who wrote a thought. There’s no button or report for it — not for facilitators, and not for workspace owners.</P>
        <P>People can still work it out from the thought itself: a detail only you would know, the way you write, or a small team where everyone knows who works on what. Numbers can hint too — a lone vote, or a thought that only appears after collection was reopened. Write what you’d be comfortable having read aloud.</P>
      </Section>

      <Section id="operator">
        <P>Muni is run by one developer, {OPERATOR}. The database records which account wrote each thought — that’s how only you can edit yours — so anyone with access to the database or its backups (the operator, or Cloudflare, which hosts it) can see email addresses and connect thoughts to accounts.</P>
        <P>In an encrypted sprint they can’t read what the thoughts, themes, notes, experiments or recap say: the database only holds them encrypted, and the keys are on participants’ devices. In a sprint set up before encryption, they can technically read everything. See <a href="#encryption" className="underline underline-offset-2">Encryption, and its limits</a> for what that protection depends on.</P>
        <P>Our rule is to access data only when it’s needed to keep Muni running and secure, to investigate abuse, or to act on a request from you — never to read thoughts out of curiosity or to find out who wrote something. That’s a commitment, not a technical barrier, and Muni keeps no separate record of when the operator looks at data.</P>
        <P>Workspace owners manage members and settings. Owning a workspace doesn’t let them read a sprint they aren’t part of, or find out who wrote anything.</P>
      </Section>

      <Section id="providers">
        <P>Muni relies on a few companies to run. Each receives what its job needs.</P>
        <Item title="Cloudflare">Hosts the app, its database and the live retro connection, so it processes everything you send to Muni. Its request logs keep, for up to 7 days, when each request happened, the address requested (which contains only ids, never text or email addresses) and technical details such as your IP address and browser. What you type isn’t in them. Muni’s own logging records failures only: the page and a short error, never what you wrote or your email address.</Item>
        <Item title="Resend">Delivers Muni’s emails. It receives your email address and the message: a sign-in or confirmation code, an invitation (the workspace’s name, the inviter’s name and a link), or a reminder (the sprint’s name and a link). Never a thought. Resend keeps delivery records under its own terms.</Item>
        <Item title="GitHub and Google (munimuni.app only)">The website at munimuni.app — not the app — is hosted on GitHub Pages, reached through Cloudflare, and loads its fonts from Google Fonts, so those companies receive a visitor’s IP address and browser details. The app serves its own fonts.</Item>
        <P>There are no analytics, advertising, session-recording or error-reporting services. The app’s security settings don’t let it load code from, or send data to, any other website. We don’t sell personal data, and your email address isn’t added to any mailing list.</P>
      </Section>

      <Section id="ai">
        <P>Encrypted sprints never use AI: their content can’t leave your team’s devices unencrypted. The hosted Muni also has no AI service switched on. Grouping thoughts into themes is done by people, and no thought is sent to an AI provider. Muni doesn’t train AI models on what you write.</P>
        <P>Muni’s code has an optional feature that asks an AI provider (Anthropic) to draft themes. If it’s ever offered here, this page will say so first. Even then it would only apply to a sprint whose facilitator turned it on before collection opened — it can’t be switched on later — and it would send the thoughts’ text, with any category, impact and “what might help”, after collection closes and without names, email addresses or who wrote what. The provider’s own terms would govern what it keeps, and a copy that has been sent can’t be recalled.</P>
      </Section>

      <Section id="encryption">
        <Item title="What’s encrypted">In sprints set up with encryption — the default for new sprints — thoughts (with their impact and “what might help”), context added during the retro, theme titles and summaries, discussion notes and takeaways, experiments and their outcomes, the recap, the opening question and reasons typed for resetting a vote. Each is encrypted in the browser before it’s sent, and decrypted only in the browsers of people who hold the sprint’s key. Muni’s servers store and pass along the encrypted form, and don’t have the keys to open it.</Item>
        <Item title="What isn’t">Your email address and name; workspace and sprint names, sprint goals, dates and retro times; who is in a sprint and who facilitates; each thought’s category, “when in the sprint”, who wrote it and when; how thoughts are grouped; vote counts; experiment owners, review dates and outcome status; and activity such as “closed collection”. Muni needs these to run. Keep sensitive detail out of a sprint’s name and goal.</Item>
        <Item title="Sprints from before encryption">Sprints set up before encryption stay unencrypted, and each says so. Encrypting old content later wouldn’t remove readable copies from backups or from files already downloaded.</Item>
        <Item title="Who can decrypt, and when">While collection is open, the key that reveals everyone’s thoughts is held only on the facilitator’s devices; your own thoughts are also sealed to you, so you can read and edit them. Muni’s servers don’t give the facilitator anyone’s thoughts until collection closes — that part is a rule the servers enforce, not encryption. Closing collection is when the facilitator’s device shares the key with everyone in the sprint. People added later get it from a teammate’s device. If collection is reopened, new thoughts use a new key that, again, only the facilitator holds until it closes.</Item>
        <Item title="Your key and your recovery key">Your key is created in your browser and stays there. Muni keeps a copy only locked with your recovery key, which Muni never sees. Signing in with an email code gets you into your account, not into encrypted content: on a new device, you unlock it with your recovery key. If you lose every device and your recovery key, Muni can’t recover your key — you can start over with a new one, and teammates can share current sprints with you again, but what was only yours can’t be opened.</Item>
        <Item title="Your key, and your passkey">Your encryption key is made in your browser the first time you need it, and it opens everything encrypted for you. Muni’s servers only ever hold it locked. Where your passkey and browser support it (the passkey’s “PRF” feature), signing in with that passkey also unlocks your key, on any device where you can use it — nothing to type. The browser also keeps it locked for you: after you sign out, it opens again only when you sign in again. An email code gets you into your account but never unlocks encrypted writing on a device that doesn’t already have it. If no passkey or device can unlock it, a recovery key (which you can make in Account) can. “Forget this device” removes what this browser keeps; it doesn’t delete your passkeys, which stay in your password manager or on your device.</Item>
        <Item title="What encryption can’t do">It relies on the app your browser loads from act.munimuni.app being the genuine one: whoever controls that code (the operator, or someone who breaks in) could change it to capture what you type or your keys, or hand your device someone else’s key. Devices won’t share a sprint’s key with a teammate whose key changed unexpectedly until someone confirms it (the facilitator is told), and your key’s fingerprint is shown in Account for comparing — but none of this can prevent a changed app. It doesn’t protect against a compromised device or browser extension, screenshots, or people in the sprint sharing what they read. Removing someone from a sprint stops their access to what’s added later; it can’t take back what they already read. Downloaded summaries aren’t encrypted.</Item>
        <Item title="Also">Connections are encrypted (HTTPS), and Cloudflare encrypts stored data on its disks (AES-256) with keys it manages. Sign-in codes and sign-in tokens are stored only as one-way hashes. This encryption hasn’t yet been independently audited.</Item>
      </Section>

      <Section id="device">
        <Item title="Keep drafts on this device: off">The default. Your draft and any thoughts waiting to be sent exist only in the open tab, and closing it loses anything unsent — Muni tells you when that applies.</Item>
        <Item title="Keep drafts on this device: on">A choice per person, per browser. Your draft, thoughts waiting to be sent, the names and retro times of the sprints they’re for, and your name and workspaces (so Muni can open offline) are stored in this browser. Anyone who can use this browser profile could read them, so turn it on only on a personal device.</Item>
        <Item title="Your encryption key">Stored in this browser once you set up or unlock encryption, so encrypted sprints open without asking every time. Anyone who can use this browser profile could use it; signing out removes it. What you write is kept readable on the device while it’s a draft or waiting to be sent, and encrypted when it’s sent.</Item>
        <Item title="Voice">If you choose Speak, your speech is turned into text on this device. The recording stays in memory only until its words are in your draft, and is never uploaded or saved. The first time, Muni downloads its speech model (252 MB) from act.munimuni.app, with your agreement; that download carries nothing about you, and the model stays in this browser until you remove it (Account → Voice).</Item>
        <Item title="Either way">The browser keeps a few preferences, such as your theme and the last sprint you opened, and a copy of the app so it opens quickly and offline. Your sign-in is a secure cookie that the page itself can’t read. Muni never stores other people’s thoughts on your device.</Item>
        <P>Signing out, or “Clear local data”, removes what this device keeps for your account, and warns you first if something hasn’t been sent. Neither deletes anything from Muni’s servers. If you lose access to a sprint while a device is offline, its copies stay there until it reconnects — Muni can’t erase a device remotely.</P>
      </Section>

      <Section id="retention">
        <Item title="Finished sprints">About 90 days after a sprint is finished — the default; workspace owners can choose from 7 to 3,650 days — its thoughts, themes, votes, notes, added context and any unpublished recap are deleted. Agreed experiments and published recaps are kept longer, 730 days by default, so later retros can look back at them. The sprint’s name and dates remain.</Item>
        <Item title="Unfinished sprints">A sprint that is never finished isn’t deleted automatically yet: its thoughts stay until it is.</Item>
        <Item title="A thought you delete">While collection is open, deleting a thought removes it from Muni’s live database; backups keep it for up to 30 days, as below.</Item>
        <Item title="Your account">Your email address and name are kept while your account exists. There isn’t a way to delete an account, or to leave a workspace yourself, in Muni yet — write to {CONTACT} and we’ll tell you what can be removed. If an owner removes you from a workspace, what you wrote stays in its sprints, without your name.</Item>
        <Item title="Housekeeping">Sign-in codes and passkey challenges are deleted about a day after they expire. A sign-in lasts 30 days and its record is deleted a week after it ends. Your security history is kept for a year; decided requests to join a team, 180 days. The hashed abuse-protection records last 24 hours. An email’s address and message are cleared from Muni’s send queue once it has been sent. The log of administrative actions (no text) is kept.</Item>
        <Item title="Backups, logs and copies">Deleted data can remain in Cloudflare’s database backups for up to 30 days, and in request logs for up to 7 days. Resend keeps delivery records under its own terms. Files people have downloaded, screenshots, and copies on someone’s device can’t be recalled.</Item>
      </Section>

      <Section id="controls">
        {signedIn ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-card p-5">
            <h3 className="font-medium text-ink">On this device</h3>
            <div className="mt-3"><DeviceControls /></div>
          </div>
        ) : (
          <P><Link to="/signin?next=%2Fprivacy%23controls" className="underline underline-offset-2">Sign in</Link> to change what this device keeps. After signing in these controls also live in the account menu.</P>
        )}
        <Item title="Your thoughts">Edit or delete them while collection is open, under “My thoughts”.</Item>
        <Item title="Reminders">Turn a sprint’s reminder emails off on that sprint’s page.</Item>
        <Item title="Your name and other devices">{signedIn ? <><Link to="/account" className="underline underline-offset-2">Account</Link>: change your name, and sign out every other device.</> : 'Account (in the account menu): change your name, and sign out every other device.'}</Item>
        <Item title="Workspace owners">Choose how long finished sprints are kept, on the workspace page, and remove members.</Item>
        <Item title="Not available yet">Deleting your account, leaving a workspace yourself, and downloading everything you’ve written. Until then, write to {CONTACT}.</Item>
      </Section>

      <Section id="contact">
        <P>Write to <a href={`mailto:${CONTACT}`} className="font-medium text-ink underline underline-offset-2">{CONTACT}</a> with questions about privacy or requests about your data. Muni is run by one person, so a reply may take a few days.</P>
        <P>This page changes when the way Muni handles data changes; the date at the top says when it last did.</P>
      </Section>

      <p className="mt-12 border-t border-line pt-6 text-sm text-ink-soft">
        Muni is an independently maintained project, built and operated by one developer. ·{' '}
        <a href="/third-party-licenses.txt" className="underline underline-offset-4 hover:text-ink">Third-party licenses</a>
      </p>
    </article>
  )
}

function Section({ id, children }: { id: (typeof SECTIONS)[number][0]; children: ReactNode }) {
  const title = SECTIONS.find(([s]) => s === id)![1]
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-20">
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
