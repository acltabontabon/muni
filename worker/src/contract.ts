/**
 * The typed API contract shared by the Worker and the web app. Response
 * shapes here are the allow-listed representations: nothing that identifies
 * an author or a voter has a field to live in.
 */
export type Category = 'proud' | 'keep' | 'improve' | 'stop' | 'try'
export type Period = 'early' | 'middle' | 'late'
export type SprintStatus = 'draft' | 'collecting' | 'preparing' | 'ready' | 'live' | 'completed' | 'archived'
export type Phase = 'arrive' | 'remember' | 'discover' | 'discuss' | 'decide' | 'leave'

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
  email: string
  display_name: string
  workspaces: WorkspaceSummary[]
  session_expires_at: string
  email_transport: string
  ai_provider: string
}
export interface InvitationPreview {
  valid: boolean
  email_hint: string | null
  workspace_name: string | null
  matches_session: boolean
  signed_in: boolean
}
export interface Workspace {
  id: string
  name: string
  role: string
  retention_days: number
  outcome_retention_days: number
  ai_enabled_default: boolean
  ai_provider: string
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
export interface AuditEvent {
  id: number
  sprint_id: string | null
  actor_name: string | null
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
}
export interface Participant {
  account_id: string
  display_name: string
  is_facilitator: boolean
  is_you: boolean
}
export interface SprintDetail extends SprintSummary {
  opening_question: string | null
  ai_processing: boolean
  ai_locked: boolean
  ai_provider: string
  reminders_enabled: boolean
  my_reminders_opt_out: boolean
  vote_budget: number
  include_facilitator_in_rotation: boolean
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
  allowed_transitions: string[]
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
export interface ContextNote {
  id: string
  body: string
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
  source: string
  /** Thoughts, not people. */
  entry_count: number
  category_mix: Record<string, number>
  entries: SharedEntry[]
  context: ContextNote[]
  votes: number | null
  takeaway: string
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
  present: boolean
  ready: boolean | null
  is_facilitator: boolean
  is_you: boolean
}
export interface SpeakerView {
  account_id: string
  display_name: string
  is_you: boolean
}
export interface SpeakingView {
  round_id: string
  status: string
  current: SpeakerView | null
  remaining: number
  prompt: string
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
  quiet_reading: boolean
  opening_question: string | null
  attendance: AttendeeView[]
  speaking: SpeakingView | null
  notes: DiscussionNotes
  discussed_theme_ids: string[]
  has_unreleased_context: boolean | null
  my_context: MyContext[]
  include_facilitator_in_rotation: boolean
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
  | { type: 'speaking_start' }
  | { type: 'speaking_next' }
  | { type: 'speaking_open_floor' }
  | { type: 'speaking_end' }
  | { type: 'release_context' }
  | { type: 'quiet_reading'; secs: number }
  | { type: 'mark_discussed'; theme_id: string; discussed: boolean }

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

export interface AiJobView {
  id: string
  status: string
  error_summary: string | null
  provider: string
  model: string | null
  created_at: string | null
  finished_at: string | null
}
export interface ProposedTheme {
  title: string
  summary: string
  question: string
  draft_experiment: string | null
  entry_ids: string[]
}
export interface Proposal {
  themes: ProposedTheme[]
  ungrouped_entry_ids: string[]
  notes: string[]
}
export interface AiProposalView {
  id: string
  job_id: string
  proposal: Proposal
  applied_at: string | null
  rejected_at: string | null
  created_at: string | null
}
export interface AiStatus {
  available: boolean
  enabled: boolean
  provider: string
  jobs: AiJobView[]
  proposals: AiProposalView[]
  explanation: string
}
