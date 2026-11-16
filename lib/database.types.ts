// Hand-written types; the generated schema types are in lib/database.generated.ts (CI-checked; adoption is a later batch).
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface RegistrationRow {
  id: string
  event_slug: string
  event_title: string
  type: 'individual' | 'group'
  status: 'pending' | 'confirmed' | 'withdrawn'
  created_at: string
  updated_at: string
  withdrawn_at: string | null
  teacher_first_name: string | null
  teacher_last_name: string | null
  teacher_email: string | null
  teacher_member_id: string | null
  school_name: string | null
  school_address_street: string | null
  school_address_city: string | null
  school_address_state: string | null
  school_address_zip: string | null
  invoice_requested: boolean
  registrant_role: 'teacher' | 'student_manager'
  teacher_poc_first_name: string | null
  teacher_poc_last_name: string | null
  teacher_poc_email: string | null
  member_pays_individually: boolean
  details_method: 'add_now' | 'spreadsheet' | 'email_link'
  spreadsheet_id: string | null
  school_dpa_agreed_at: string | null
  // Declared group size (absolute, role-normalised): adult_count + student_count
  // == total participants. NULL on registrations created before migration 037.
  adult_count: number | null
  student_count: number | null
  // Unpaid group invoice: when the settled roster is due to update it, and the
  // lease held while it is changed (lib/group-billing.ts).
  invoice_sync_due_at?: string | null
  invoice_sync_lock_until?: string | null
  // Pay-later capability (see lib/registration-checkout.ts). NULL until minted.
  pay_token: string | null
  pay_link_sent_at: string | null
  // deep review PAY-4 part-1: the open Checkout session, expired before a new one
  // is minted so a registration never holds two payable sessions. NULL until first
  // checkout.
  checkout_session_id: string | null
  // Who pays for people who join later, on an "Invoice for some" group only
  // (migration 20261109180000_group_payers). NULL everywhere else.
  late_joiner_payer: 'group' | 'self' | null
  // Students share the teacher's cost (migration 20261109190000_teacher_share,
  // lib/teacher-share.ts). All NULL on a group that doesn't share it.
  share_estimate: number | null
  share_unit_cents: number | null
  share_cents: number | null
  share_first_paid_at: string | null
  share_settled_at: string | null
}

/** Nullable columns with no default: optional on insert. */
type RegistrationOptionalOnInsert =
  | 'late_joiner_payer'
  | 'share_estimate'
  | 'share_unit_cents'
  | 'share_cents'
  | 'share_first_paid_at'
  | 'share_settled_at'

export type RegistrationInsert = Omit<RegistrationRow, 'id' | 'created_at' | 'updated_at' | RegistrationOptionalOnInsert> &
  Partial<Pick<RegistrationRow, RegistrationOptionalOnInsert>>

export interface ParticipantRow {
  id: string
  registration_id: string
  first_name: string
  last_name: string
  nickname: string | null
  email: string
  phone: string
  date_of_birth: string
  grade: string | null
  gender: string
  ethnicity: string[]
  t_shirt_size: string
  school_name: string
  age_bracket: string
  event_role: string
  dietary_requirements: string[]
  health_conditions: string | null
  emergency_contact_first_name: string | null
  emergency_contact_last_name: string | null
  emergency_contact_email: string | null
  emergency_contact_phone: string | null
  emergency_contact_relationship: string | null
  membership_id: string
  company_name: string | null
  award: string | null
  // 'covered': a teacher whose place the students' shares pay for
  // (migration 20261109190000_teacher_share).
  individual_payment_status: 'pending' | 'paid' | 'waived' | 'covered' | null
  join_completed_at: string | null
  // deep review PAY-8: durable per-seat pay token (mirrors registrations.pay_token).
  // NULL until a per-seat payment link is first needed.
  pay_token: string | null
  // Stripe payment reference for a per-seat payment (migration 027), used by cash
  // refunds. NULL until the seat is paid.
  stripe_payment_intent_id: string | null
  // Who pays for this place (migration 20261109180000_group_payers). NULL keeps
  // the old meaning: the group's flags decide (lib/group-payer.ts).
  payer: 'group' | 'self' | 'shared' | null
  // A shared-cost student's payment, split (migration 20261109190000_teacher_share):
  // their own place after any code, and their share of the teacher's cost.
  base_paid_cents: number | null
  share_paid_cents: number | null
  discount_code: string | null
  created_at: string
}

export interface GroupJoinTokenRow {
  id: string
  token: string
  registration_id: string
  event_slug: string
  event_title: string
  created_at: string
  expires_at: string
}

export type GroupJoinTokenInsert = Omit<GroupJoinTokenRow, 'id' | 'created_at'>

/** Nullable columns with no default: optional on insert. */
type ParticipantOptionalOnInsert = 'payer' | 'base_paid_cents' | 'share_paid_cents' | 'discount_code'

export type ParticipantInsert = Omit<ParticipantRow, 'id' | 'created_at' | 'membership_id' | 'company_name' | 'award' | ParticipantOptionalOnInsert> &
  Partial<Pick<ParticipantRow, ParticipantOptionalOnInsert>>

export interface Database {
  public: {
    Tables: {
      registrations: {
        Row: RegistrationRow
        Insert: RegistrationInsert
        Update: Partial<RegistrationInsert>
      }
      participants: {
        Row: ParticipantRow
        Insert: ParticipantInsert
        Update: Partial<ParticipantInsert>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
