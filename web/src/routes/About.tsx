import { Link } from 'react-router'
import { Mark } from '@/brand/Mark'
import { useDocumentTitle } from '@/ui'

export function About() {
  useDocumentTitle('Privacy & how Muni works')
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/" className="inline-flex items-center gap-2 text-ink"><Mark size={28} /> <span className="font-wordmark text-xl">muni</span></Link>
      <h1 className="font-display mt-8 text-3xl leading-tight">A moment to reflect. A chance to improve.</h1>
      <p className="mt-4 text-lg text-ink-soft">
        <em>Muni</em> takes its name from the Filipino <em>muni-muni</em>: to reflect, to turn something over in your mind. Muni is a place to set a thought down while it’s fresh, look back on it together, and decide what to try next.
      </p>

      <h2 className="font-display mt-10 text-2xl">The privacy promise, exactly</h2>
      <blockquote className="mt-3 border-l-2 border-accent pl-4 text-ink">
        Your identity is verified to access this sprint. Your entries and votes are shown without your identity to teammates and facilitators. The service operator may technically be able to associate activity with accounts. Your wording can still reveal who you are.
      </blockquote>
      <div className="prose-muni mt-6 space-y-4 text-ink-soft">
        <p><strong className="text-ink">What is hidden.</strong> Shared screens, the facilitator’s preparation view, the meeting stage and exports never include who wrote an entry, who voted for what, when something was submitted, or any stable nickname that would let a reader connect one person’s entries. Entries are revealed as one batch in a random order when collection closes.</p>
        <p><strong className="text-ink">What the facilitator can see.</strong> Nothing during collection except their own entries. After they close collection: everyone’s entries, anonymously, plus who is present at the retro and who owns an experiment. Owning an experiment never implies writing the observation behind it.</p>
        <p><strong className="text-ink">What the operator could see.</strong> Muni stores which account saved each entry so that only you can edit yours. Someone with direct database or backup access could join those records. There is no button for it, and workspace owners don’t get one either. This is application-level anonymity, not cryptography.</p>
        <p><strong className="text-ink">What stays true regardless.</strong> On a small team, or with a distinctive turn of phrase, people may recognise your writing. Write what you’re comfortable having read aloud.</p>
        <p><strong className="text-ink">AI.</strong> If a sprint has AI assistance turned on (decided before collection starts, never afterwards), entry text and opaque ids are sent to the configured provider to draft themes. Names, emails, attendance and authorship are not sent. Drafts are proposals the facilitator edits; originals are never replaced.</p>
        <p><strong className="text-ink">Retention.</strong> Raw entries and everything derived from them are deleted after the workspace’s retention window (90 days by default). Accepted experiments and published recaps are kept longer under a separate, visible setting, because next sprint needs them. Backups expire on their own schedule, and copies already exported or sent to an AI provider can’t be recalled.</p>
        <p><strong className="text-ink">What this device keeps.</strong> Only if you turn on “Keep drafts on this device” (account menu): the draft you’re writing, thoughts waiting to be sent, and a few details of the sprints they’re for, stored in this browser for your account only. That lets you recover a draft after closing Muni and write without a connection. Anyone who can use this device and browser profile could read them, so it’s meant for a personal device. It isn’t a backup and can be lost if the browser clears its storage. Signing out or “Clear local data” removes it; that never deletes anything from Muni’s servers. If your access to a sprint ends while this device is offline, what’s stored here stays until Muni reconnects and learns about it. With the setting off, drafts live only as long as the tab.</p>
        <p><strong className="text-ink">Sign-in.</strong> A six-digit code proves you control a mailbox. It doesn’t prove a mailbox belongs to exactly one person. Invitations are for one address; forwarding a link doesn’t let someone else join.</p>
      </div>
      <p className="mt-10 text-sm text-ink-faint">Capture thoughts throughout the sprint. Reflect together. Turn insights into action.</p>
    </div>
  )
}
