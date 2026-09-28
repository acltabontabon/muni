/**
 * The typed API contract shared by the Worker and the web app. Response
 * shapes here are the allow-listed representations: nothing that identifies
 * an author or a voter has a field to live in.
 */
export type Category = 'proud' | 'keep' | 'improve' | 'stop' | 'try'
export type Period = 'early' | 'middle' | 'late'
export type SprintStatus = 'draft' | 'collecting' | 'preparing' | 'ready' | 'live' | 'completed' | 'archived'
/** The retro's four steps. */
export type Phase = 'look_back' | 'choose' | 'talk' | 'agree'

export interface ErrorBody {
  error: string
  code: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  role: string
  is_demo: boolean
}
export interface Me {
  account_id: string
  /** Where invitations and reminders go, if anywhere (from an accepted email invitation). Never a way in. */
  email: string | null
  display_name: string
  /** The person hasn't chosen a display name yet: ask for one before anything else. */
  needs_name: boolean
  workspaces: WorkspaceSummary[]
  session_expires_at: string
  email_transport: string
  /** How many passkeys the account has: at least one, since a passkey is the only way in. */
  passkeys: number
  /** How the current session signed in; null right after a sign-in response. */
  auth_method: 'passkey' | null
  /** Until when security-sensitive changes are allowed without confirming again. */
  recent_auth_until: string
  pending_join_requests: { id: string; workspace_name: string; created_at: string }[]
  /**
   * The person's own character and whether their own pages wear its world (the character also
   * appears beside their name in the retro; the world is theirs alone). `intro`: offer the
   * chooser ('choose', a new account) or nothing more ('done').
   */
  avatar: { id: string | null; theme: boolean; intro: 'choose' | 'done' }
  /** Only on sign-in responses: whether that verification created a new account. */
  created?: boolean
}
export interface PasskeyInfo {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
  /** A multi-device passkey that may sync through a password manager. */
  synced: boolean
}
export interface SessionInfo {
  id: string
  current: boolean
  created_at: string
  last_seen_at: string
  expires_at: string
  method: 'passkey'
  label: string | null
  passkey_name: string | null
}
export interface SecurityEventInfo {
  id: number
  kind: string
  meta: Record<string, string | number | boolean | null>
  created_at: string
}
export interface JoinPreview {
  valid: boolean
  signed_in: boolean
  includes_sprint?: boolean
  /** 'direct': a personal, single-use link that joins at once. 'approval': a team QR. */
  mode?: 'approval' | 'direct'
  workspace_name?: string
  state?: 'member' | 'pending' | 'none' | 'full'
  request_id?: string
  workspace_id?: string
  sprint_id?: string | null
}
export interface JoinLinkInfo {
  id: string
  sprint_id: string | null
  sprint_name: string | null
  role: string
  mode: 'approval' | 'direct'
  created_by_name: string
  created_at: string
  expires_at: string
  max_requests: number
  request_count: number
}
export interface JoinRequestInfo {
  id: string
  display_name: string
  email: string | null
  has_passkey: boolean
  account_created_at: string
  requested_at: string
  sprint_id: string | null
  sprint_name: string | null
  previously_member: boolean
  matches_email_invitation: boolean
  link_turned_off: boolean
}
export interface MyJoinRequest {
  id: string
  status: 'pending' | 'approved' | 'declined' | 'withdrawn' | 'expired'
  workspace_name: string
  created_at: string
  decided_at: string | null
  workspace_id: string | null
  sprint_id: string | null
}
export interface InvitationPreview {
  valid: boolean
  email_hint: string | null
  workspace_name: string | null
  signed_in: boolean
}
export interface Workspace {
  id: string
  name: string
  role: string
  retention_days: number
  outcome_retention_days: number
  is_demo: boolean
  created_at: string
}
export interface MemberInfo {
  account_id: string
  display_name: string
  email: string | null
  role: string
  joined_at: string
  is_you: boolean
  /** Owners only (empty otherwise): unfinished sprints this person facilitates that others are in. Removing them waits until they hand these on. */
  facilitating: { id: string; name: string }[]
}
export interface PendingInvitation {
  id: string
  email: string
  sprint_id: string | null
  expires_at: string
  created_at: string
}
export interface WorkspaceDetail {
  workspace: Workspace
  members: MemberInfo[]
  pending_invitations: PendingInvitation[]
  can_invite: boolean
}
/** Where you stand in a workspace, before leaving it or deleting your account. */
export interface WorkspaceStanding {
  workspace_id: string
  workspace_name: string
  /** No one else is an active member: leaving means the workspace goes too. */
  sole: boolean
  /** Their only owner, while other people remain. */
  last_owner: boolean
  /** Unfinished sprints you facilitate that someone else takes part in. */
  facilitating: { id: string; name: string }[]
}
export interface AccountDeletionPreview {
  can_delete: boolean
  workspaces: WorkspaceStanding[]
}
export interface AccountDeleted {
  ok: true
  rp_id: string
  credential_ids: string[]
}
export interface AuditEvent {
  id: number
  sprint_id: string | null
  actor_name: string | null
  /** The actor has since deleted their account (shown as someone, not Muni). */
  actor_gone: boolean
  action: string
  meta: Record<string, unknown>
  created_at: string
}

export interface SprintSummary {
  id: string
  workspace_id: string
  name: string
  external_ref: string | null
  goal: string | null
  status: SprintStatus | string
  timezone: string
  starts_on: string
  ends_on: string
  retro_at: string
  retro_local: string
  retro_local_date: string
  retro_local_time: string
  retro_duration_min: number
  participant_count: number
  facilitator_name: string | null
  is_facilitator: boolean
  is_participant: boolean
  reminders_enabled: boolean
  my_reminders_opt_out: boolean
  /** 'e1': content is encrypted on participants' devices (the default). null: set up without encryption, stored as plaintext. */
  encryption: 'e1' | null
  /** The changes of state this person may make (only ever the facilitator's). */
  allowed_transitions: string[]
}
export interface Participant {
  account_id: string
  display_name: string
  is_facilitator: boolean
  is_you: boolean
}
export interface SprintDetail extends SprintSummary {
  opening_question: string | null
  vote_budget: number
  participants: Participant[]
  /** Aggregate only, and only once collection has closed. */
  entry_count: number | null
  theme_count: number
  grouping_revision: number
  collection_opened_at: string | null
  collection_closed_at: string | null
  reopened_count: number
  revealed_once: boolean
  completed_at: string | null
  content_purged_at: string | null
  has_session: boolean
  session_cancelled: boolean
  role: string
  workspace_name: string
  previous_sprint_id: string | null
}
export interface CaptureTarget {
  collecting: SprintSummary[]
  upcoming: SprintSummary[]
}

export interface MyEntry {
  id: string
  category: string | null
  body: string
  impact: string | null
  might_help: string | null
  period: string | null
  created_at: string
  updated_at: string
  editable: boolean
}
/** The shared, anonymous representation. Add fields with care. */
export interface SharedEntry {
  id: string
  category: string | null
  body: string
  impact: string | null
  might_help: string | null
  period: string | null
  theme_id: string | null
}
/** What someone may say an addition is. Optional. */
export type AdditionKind = 'example' | 'view' | 'question'
export interface ContextNote {
  id: string
  body: string
  kind: AdditionKind | null
}
export interface ThemeView {
  id: string
  title: string
  summary: string
  question: string
  draft_experiment: string | null
  position: number
  parked: boolean
  needs_attention: boolean
  order_reason: string | null
  /** Thoughts, not people. */
  entry_count: number
  category_mix: Record<string, number>
  entries: SharedEntry[]
  context: ContextNote[]
  votes: number | null
  takeaway: string
  /** An idea to try, noted while talking; Agree turns ideas into experiments. */
  could_try: string
  discussed: boolean
}
export interface GroupingView {
  sprint_status: string
  grouping_revision: number
  themes: ThemeView[]
  ungrouped: SharedEntry[]
  total_entries: number
  can_edit: boolean
  voting_open: boolean
}

export interface VoteRoundView {
  id: string
  status: string
  budget: number
  cancel_reason: string | null
  opened_at: string
  closed_at: string | null
  my_votes: string[]
  my_remaining: number
  /** The facilitator only, while the round is open: how many people have voted so far. */
  voters: number | null
  totals: Record<string, number> | null
  eligible: boolean
}
export interface VotingState {
  current: VoteRoundView | null
  previous: VoteRoundView[]
}

export interface TimerView {
  running: boolean
  ends_at: string | null
  remaining_secs: number
  total_secs: number
}
export interface AttendeeView {
  account_id: string
  display_name: string
  /** Their character, shown as their face in the retro (with their name, never with anything anonymous). */
  avatar_id: string | null
  present: boolean
  /** Has the retro open right now (the stage or their phone), live. */
  connected: boolean
  is_facilitator: boolean
  is_you: boolean
}
export interface AgendaItem {
  theme_id: string
  reason: string | null
}
export interface DiscussionNotes {
  takeaway: string
  what_happened: string
  impact: string
  could_try: string
  notes: string
  discussed: boolean
}
export interface MyContext {
  id: string
  theme_id: string | null
  body: string
  kind: AdditionKind | null
  released: boolean
}
export interface StageSnapshot {
  session_id: string
  version: number
  phase: Phase | string
  phases: string[]
  plan: Record<string, number>
  current_theme_id: string | null
  agenda: AgendaItem[]
  timer: TimerView
  server_time: string
  controller_name: string | null
  you_control: boolean
  controller_stale: boolean
  opening_question: string | null
  attendance: AttendeeView[]
  notes: DiscussionNotes
  discussed_theme_ids: string[]
  has_unreleased_context: boolean | null
  my_context: MyContext[]
  retro_duration_min: number
  started_at: string
  ended_at: string | null
  cancelled: boolean
  is_facilitator: boolean
}
export type Command =
  | { type: 'set_phase'; phase: string }
  | { type: 'set_topic'; theme_id: string | null }
  | { type: 'set_agenda'; items: { theme_id: string; reason?: string | null }[] }
  | { type: 'set_plan'; plan: Record<string, number> }
  | { type: 'timer_start'; secs: number }
  | { type: 'timer_pause' }
  | { type: 'timer_resume' }
  | { type: 'timer_adjust'; delta_secs: number }
  | { type: 'timer_clear' }
  | { type: 'take_control' }
  | { type: 'release_context' }
  | { type: 'mark_discussed'; theme_id: string; discussed: boolean }

/**
 * A check-in during the talk: how a topic showed up for people, or whether an idea to try would
 * help. Private until the facilitator shares it; then counts per choice and the lines people added,
 * never who.
 */
export type CheckinKind = 'topic' | 'action'
export type TopicChoice = 'felt' | 'not_mine' | 'context'
export type ActionChoice = 'worth' | 'concern' | 'unsure'
export interface CheckinView {
  id: string
  sprint_id: string
  theme_id: string
  kind: CheckinKind
  /** For an action check-in: the idea's wording when it was asked about. */
  could_try: string | null
  status: 'open' | 'shared'
  opened_at: string
  shared_at: string | null
  /** Your own answer, visible only to you. */
  mine: { choice: string; note: string | null } | null
  /** The facilitator only, while open: how many have answered so far. */
  answers: number | null
  results: { responded: number; counts: Record<string, number>; notes: { choice: string; note: string }[] } | null
}

export interface Experiment {
  id: string
  sprint_id: string
  sprint_name: string
  theme_id: string | null
  theme_title: string | null
  change_to_try: string
  success_signal: string
  owner_account_id: string | null
  owner_name: string | null
  owner_accepted: boolean
  review_on: string
  status: string
  outcome_note: string | null
  reviewed_at: string | null
  created_at: string
}
export interface Recap {
  body: string
  draft_source: string
  approved_at: string | null
  published_at: string | null
  updated_at: string | null
  exists: boolean
}

/** Encryption keys. Public keys and wrapped (sealed) keys only: nothing here opens content. */
export interface MyKeys {
  public_key: string | null
  recovery_blob: string | null
  recovery_confirmed_at: string | null
  key_version: number
  created_at: string | null
  /** Passkeys that can unlock the current key: its wrap under each one's PRF-derived key. */
  passkeys: PasskeyKeyWrap[]
  /** The passkey this session signed in (or last confirmed) with, if it did. */
  session_passkey: { id: string; webauthn_id: string } | null
}
export interface PasskeyKeyWrap {
  /** Our id for the passkey (PasskeyInfo.id). */
  credential: string
  /** The WebAuthn credential id (base64url), as the browser reports it. */
  webauthn_id: string
  key_version: number
  wrapped: string
}
/** A device that can reopen this account's key after signing in again. Never includes its share. */
export interface DeviceInfo {
  id: string
  label: string | null
  created_at: string | null
  last_used_at: string | null
  key_version: number
  requires_passkey: boolean
}
export interface SprintKeyView {
  encryption: 'e1' | null
  sealed_version?: number | null
  versions?: { version: number; public_key: string }[]
  my_wraps?: { version: number; wrapped: string }[]
  participants?: { account_id: string; display_name: string; is_facilitator: boolean; public_key: string | null; key_version: number; versions_held: number[]; has_latest: boolean }[]
}
