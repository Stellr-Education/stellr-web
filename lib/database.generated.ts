export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      addon_orders: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          event_slug: string
          id: string
          method: string
          paid_at: string | null
          pay_token: string | null
          payer_kind: string
          payer_participant_id: string | null
          registration_id: string | null
          reminder_sent_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          tenant_id: string | null
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          event_slug: string
          id?: string
          method?: string
          paid_at?: string | null
          pay_token?: string | null
          payer_kind: string
          payer_participant_id?: string | null
          registration_id?: string | null
          reminder_sent_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string | null
          total_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          event_slug?: string
          id?: string
          method?: string
          paid_at?: string | null
          pay_token?: string | null
          payer_kind?: string
          payer_participant_id?: string | null
          registration_id?: string | null
          reminder_sent_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string | null
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_orders_payer_participant_id_fkey"
            columns: ["payer_participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addon_orders_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addon_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_duties: {
        Row: {
          created_at: string
          granted_by: string | null
          member_id: string
          scopes: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          member_id: string
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          member_id?: string
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_duties_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_duties_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_email_changes: {
        Row: {
          agreement_id: string
          created_at: string
          decided_at: string | null
          decided_by_label: string | null
          decided_by_member: string | null
          id: string
          kind: string
          new_email: string | null
          old_email: string
          recipient_id: string
          requested_by_email: string | null
          requested_by_member: string | null
          requested_by_role: string | null
          role_name: string | null
          status: string
          tenant_id: string | null
          token_expires_at: string | null
          token_hash: string | null
          updated_at: string
          used_at: string | null
        }
        Insert: {
          agreement_id: string
          created_at?: string
          decided_at?: string | null
          decided_by_label?: string | null
          decided_by_member?: string | null
          id?: string
          kind: string
          new_email?: string | null
          old_email: string
          recipient_id: string
          requested_by_email?: string | null
          requested_by_member?: string | null
          requested_by_role?: string | null
          role_name?: string | null
          status?: string
          tenant_id?: string | null
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          agreement_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by_label?: string | null
          decided_by_member?: string | null
          id?: string
          kind?: string
          new_email?: string | null
          old_email?: string
          recipient_id?: string
          requested_by_email?: string | null
          requested_by_member?: string | null
          requested_by_role?: string | null
          role_name?: string | null
          status?: string
          tenant_id?: string | null
          token_expires_at?: string | null
          token_hash?: string | null
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_email_changes_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_email_changes_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "docusign_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_email_changes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_recipients: {
        Row: {
          attested_at: string | null
          bounce_notified_email: string | null
          consented_at: string | null
          created_at: string
          declined_at: string | null
          declined_reason: string | null
          delivered_at: string | null
          disclosure_version: string | null
          email: string
          envelope_row: string
          failed_token_attempts: number
          id: string
          invite_attempts: number
          invite_email_id: string | null
          invite_error: string | null
          invite_sent_at: string | null
          last_synced_at: string
          member_id: string | null
          name: string
          recipient_id: string
          role_name: string | null
          routing_order: number | null
          signature_image_path: string | null
          signature_kind: string | null
          signature_text: string | null
          signed_at: string | null
          signed_ip: string | null
          signed_user_agent: string | null
          signer_values: Json | null
          status: string
          tenant_id: string | null
          token_expires_at: string | null
          token_version: number
          viewed_at: string | null
        }
        Insert: {
          attested_at?: string | null
          bounce_notified_email?: string | null
          consented_at?: string | null
          created_at?: string
          declined_at?: string | null
          declined_reason?: string | null
          delivered_at?: string | null
          disclosure_version?: string | null
          email: string
          envelope_row: string
          failed_token_attempts?: number
          id?: string
          invite_attempts?: number
          invite_email_id?: string | null
          invite_error?: string | null
          invite_sent_at?: string | null
          last_synced_at?: string
          member_id?: string | null
          name: string
          recipient_id: string
          role_name?: string | null
          routing_order?: number | null
          signature_image_path?: string | null
          signature_kind?: string | null
          signature_text?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_user_agent?: string | null
          signer_values?: Json | null
          status: string
          tenant_id?: string | null
          token_expires_at?: string | null
          token_version?: number
          viewed_at?: string | null
        }
        Update: {
          attested_at?: string | null
          bounce_notified_email?: string | null
          consented_at?: string | null
          created_at?: string
          declined_at?: string | null
          declined_reason?: string | null
          delivered_at?: string | null
          disclosure_version?: string | null
          email?: string
          envelope_row?: string
          failed_token_attempts?: number
          id?: string
          invite_attempts?: number
          invite_email_id?: string | null
          invite_error?: string | null
          invite_sent_at?: string | null
          last_synced_at?: string
          member_id?: string | null
          name?: string
          recipient_id?: string
          role_name?: string | null
          routing_order?: number | null
          signature_image_path?: string | null
          signature_kind?: string | null
          signature_text?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_user_agent?: string | null
          signer_values?: Json | null
          status?: string
          tenant_id?: string | null
          token_expires_at?: string | null
          token_version?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelope_recipients_envelope_row_fkey"
            columns: ["envelope_row"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelope_recipients_envelope_row_fkey"
            columns: ["envelope_row"]
            isOneToOne: false
            referencedRelation: "docusign_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelope_recipients_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      agreements: {
        Row: {
          agreement_version: string | null
          archive_attempts: number
          archive_error: string | null
          archived_at: string | null
          certificate_bytes: number | null
          certificate_path: string | null
          completed_at: string | null
          completion_notified_at: string | null
          created_at: string
          credential_sharing_opt_out: boolean
          declined_at: string | null
          digital_comms_opt_out: boolean
          envelope_id: string
          envelope_type: string
          event_slug: string
          event_title: string
          form_data_read_at: string | null
          form_opt_outs: Json | null
          id: string
          issue_error: string | null
          last_manual_resend_at: string | null
          media_opt_out: boolean
          member_id: string | null
          minor_name: string
          participant_id: string | null
          prefill: Json | null
          provider: string
          quote_opt_out: boolean
          reminder_count: number
          reminder_sent_at: string | null
          replicated_at: string | null
          restricted_at: string | null
          retain_until: string | null
          reused_from: string | null
          seal_kind: string | null
          sealed_at: string | null
          sent_at: string
          signed_pdf_bytes: number | null
          signed_pdf_path: string | null
          signed_pdf_sha256: string | null
          signer_email: string
          signer_name: string
          signers_completed: number
          signers_total: number
          status: string
          template_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          agreement_version?: string | null
          archive_attempts?: number
          archive_error?: string | null
          archived_at?: string | null
          certificate_bytes?: number | null
          certificate_path?: string | null
          completed_at?: string | null
          completion_notified_at?: string | null
          created_at?: string
          credential_sharing_opt_out?: boolean
          declined_at?: string | null
          digital_comms_opt_out?: boolean
          envelope_id: string
          envelope_type?: string
          event_slug: string
          event_title: string
          form_data_read_at?: string | null
          form_opt_outs?: Json | null
          id?: string
          issue_error?: string | null
          last_manual_resend_at?: string | null
          media_opt_out?: boolean
          member_id?: string | null
          minor_name: string
          participant_id?: string | null
          prefill?: Json | null
          provider?: string
          quote_opt_out?: boolean
          reminder_count?: number
          reminder_sent_at?: string | null
          replicated_at?: string | null
          restricted_at?: string | null
          retain_until?: string | null
          reused_from?: string | null
          seal_kind?: string | null
          sealed_at?: string | null
          sent_at?: string
          signed_pdf_bytes?: number | null
          signed_pdf_path?: string | null
          signed_pdf_sha256?: string | null
          signer_email: string
          signer_name: string
          signers_completed?: number
          signers_total?: number
          status?: string
          template_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          agreement_version?: string | null
          archive_attempts?: number
          archive_error?: string | null
          archived_at?: string | null
          certificate_bytes?: number | null
          certificate_path?: string | null
          completed_at?: string | null
          completion_notified_at?: string | null
          created_at?: string
          credential_sharing_opt_out?: boolean
          declined_at?: string | null
          digital_comms_opt_out?: boolean
          envelope_id?: string
          envelope_type?: string
          event_slug?: string
          event_title?: string
          form_data_read_at?: string | null
          form_opt_outs?: Json | null
          id?: string
          issue_error?: string | null
          last_manual_resend_at?: string | null
          media_opt_out?: boolean
          member_id?: string | null
          minor_name?: string
          participant_id?: string | null
          prefill?: Json | null
          provider?: string
          quote_opt_out?: boolean
          reminder_count?: number
          reminder_sent_at?: string | null
          replicated_at?: string | null
          restricted_at?: string | null
          retain_until?: string | null
          reused_from?: string | null
          seal_kind?: string | null
          sealed_at?: string | null
          sent_at?: string
          signed_pdf_bytes?: number | null
          signed_pdf_path?: string | null
          signed_pdf_sha256?: string | null
          signer_email?: string
          signer_name?: string
          signers_completed?: number
          signers_total?: number
          status?: string
          template_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_reused_from_fkey"
            columns: ["reused_from"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_reused_from_fkey"
            columns: ["reused_from"]
            isOneToOne: false
            referencedRelation: "docusign_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "esign_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      allergy_options: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      app_errors: {
        Row: {
          count: number
          digest: string
          id: string
          last_seen: string
          message: string
          occurred_at: string
          route: string
          tenant_id: string | null
        }
        Insert: {
          count?: number
          digest: string
          id?: string
          last_seen?: string
          message: string
          occurred_at?: string
          route: string
          tenant_id?: string | null
        }
        Update: {
          count?: number
          digest?: string
          id?: string
          last_seen?: string
          message?: string
          occurred_at?: string
          route?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action_type"]
          changed_at: string
          changed_by: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action_type"]
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action_type"]
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      chat_channels: {
        Row: {
          cohort_id: string | null
          created_at: string
          host_member_id: string | null
          id: string
          kind: string
          member_id: string | null
          space_id: string | null
        }
        Insert: {
          cohort_id?: string | null
          created_at?: string
          host_member_id?: string | null
          id?: string
          kind: string
          member_id?: string | null
          space_id?: string | null
        }
        Update: {
          cohort_id?: string | null
          created_at?: string
          host_member_id?: string | null
          id?: string
          kind?: string
          member_id?: string | null
          space_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_host_member_id_fkey"
            columns: ["host_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_member_id: string | null
          body: string
          channel_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          flagged_at: string | null
          flagged_by: string | null
          id: string
        }
        Insert: {
          author_member_id?: string | null
          body: string
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
        }
        Update: {
          author_member_id?: string | null
          body?: string
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_requests: {
        Row: {
          availability: string[]
          coach_id: string | null
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          eligibility: string | null
          focus_area: string | null
          id: string
          matched_at: string | null
          member_id: string
          note: string | null
          scheduled_at: string | null
          session_id: string | null
          stage: string | null
          status: string
          topic: string
          workshop_id: string | null
        }
        Insert: {
          availability?: string[]
          coach_id?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          eligibility?: string | null
          focus_area?: string | null
          id?: string
          matched_at?: string | null
          member_id: string
          note?: string | null
          scheduled_at?: string | null
          session_id?: string | null
          stage?: string | null
          status?: string
          topic: string
          workshop_id?: string | null
        }
        Update: {
          availability?: string[]
          coach_id?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          eligibility?: string | null
          focus_area?: string | null
          id?: string
          matched_at?: string | null
          member_id?: string
          note?: string | null
          scheduled_at?: string | null
          session_id?: string | null
          stage?: string | null
          status?: string
          topic?: string
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coaching_requests_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_requests_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_requests_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_members: {
        Row: {
          accepted_at: string | null
          added_at: string
          cohort_id: string
          invited_at: string | null
          member_id: string
          relationship: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          added_at?: string
          cohort_id: string
          invited_at?: string | null
          member_id: string
          relationship?: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          added_at?: string
          cohort_id?: string
          invited_at?: string | null
          member_id?: string
          relationship?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohort_members_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_training_links: {
        Row: {
          cohort_id: string
          created_at: string
          display_order: number
          due_at: string | null
          id: string
          is_mandatory: boolean
          module_id: string
        }
        Insert: {
          cohort_id: string
          created_at?: string
          display_order?: number
          due_at?: string | null
          id?: string
          is_mandatory?: boolean
          module_id: string
        }
        Update: {
          cohort_id?: string
          created_at?: string
          display_order?: number
          due_at?: string | null
          id?: string
          is_mandatory?: boolean
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohort_training_links_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_training_links_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      community_announcements: {
        Row: {
          author_member_id: string | null
          body: string | null
          created_at: string
          id: string
          space_id: string
          title: string
        }
        Insert: {
          author_member_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          space_id: string
          title: string
        }
        Update: {
          author_member_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          space_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_announcements_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_announcements_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_channels: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_archived: boolean
          name: string
          slug: string
          space_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_archived?: boolean
          name: string
          slug: string
          space_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_archived?: boolean
          name?: string
          slug?: string
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_channels_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_comments: {
        Row: {
          author_member_id: string | null
          body_json: Json | null
          body_text: string | null
          created_at: string
          id: string
          parent_comment_id: string | null
          post_id: string
          status: string
          updated_at: string
        }
        Insert: {
          author_member_id?: string | null
          body_json?: Json | null
          body_text?: string | null
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          author_member_id?: string | null
          body_json?: Json | null
          body_text?: string | null
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          post_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_comments_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "community_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_flags: {
        Row: {
          content_id: string
          content_type: string
          created_at: string
          flagged_by: string | null
          id: string
          note: string | null
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          viewed_in_container: string | null
        }
        Insert: {
          content_id: string
          content_type: string
          created_at?: string
          flagged_by?: string | null
          id?: string
          note?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          viewed_in_container?: string | null
        }
        Update: {
          content_id?: string
          content_type?: string
          created_at?: string
          flagged_by?: string | null
          id?: string
          note?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          viewed_in_container?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_flags_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_flags_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      community_notifications: {
        Row: {
          actor_member_id: string | null
          body: string | null
          created_at: string
          emailed_at: string | null
          id: string
          is_read: boolean
          recipient_member_id: string
          reference_id: string | null
          reference_type: string | null
          type: string
        }
        Insert: {
          actor_member_id?: string | null
          body?: string | null
          created_at?: string
          emailed_at?: string | null
          id?: string
          is_read?: boolean
          recipient_member_id: string
          reference_id?: string | null
          reference_type?: string | null
          type: string
        }
        Update: {
          actor_member_id?: string | null
          body?: string | null
          created_at?: string
          emailed_at?: string | null
          id?: string
          is_read?: boolean
          recipient_member_id?: string
          reference_id?: string | null
          reference_type?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_notifications_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_notifications_recipient_member_id_fkey"
            columns: ["recipient_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      community_post_reads: {
        Row: {
          member_id: string
          post_id: string
          read_at: string
        }
        Insert: {
          member_id: string
          post_id: string
          read_at?: string
        }
        Update: {
          member_id?: string
          post_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_post_reads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_post_reads_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_member_id: string | null
          body_json: Json | null
          body_text: string | null
          channel_id: string | null
          comment_count: number
          created_at: string
          id: string
          is_announcement: boolean
          is_pinned: boolean
          space_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_member_id?: string | null
          body_json?: Json | null
          body_text?: string | null
          channel_id?: string | null
          comment_count?: number
          created_at?: string
          id?: string
          is_announcement?: boolean
          is_pinned?: boolean
          space_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_member_id?: string | null
          body_json?: Json | null
          body_text?: string | null
          channel_id?: string | null
          comment_count?: number
          created_at?: string
          id?: string
          is_announcement?: boolean
          is_pinned?: boolean
          space_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "community_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_posts_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_reactions: {
        Row: {
          author_member_id: string
          created_at: string
          emoji: string
          id: string
          target_id: string
          target_type: string
        }
        Insert: {
          author_member_id: string
          created_at?: string
          emoji: string
          id?: string
          target_id: string
          target_type: string
        }
        Update: {
          author_member_id?: string
          created_at?: string
          emoji?: string
          id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_reactions_author_member_id_fkey"
            columns: ["author_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      community_resources: {
        Row: {
          content_hash: string | null
          created_at: string
          description: string | null
          download_count: number
          event_ref: string | null
          file_size_bytes: number | null
          file_type: string | null
          from_chat: boolean
          id: string
          material_kind: string
          normalised_url: string | null
          source_post_id: string | null
          source_url: string | null
          space_id: string | null
          storage_path: string | null
          tenant_id: string | null
          title: string
          uploaded_by: string | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          description?: string | null
          download_count?: number
          event_ref?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          from_chat?: boolean
          id?: string
          material_kind?: string
          normalised_url?: string | null
          source_post_id?: string | null
          source_url?: string | null
          space_id?: string | null
          storage_path?: string | null
          tenant_id?: string | null
          title: string
          uploaded_by?: string | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          description?: string | null
          download_count?: number
          event_ref?: string | null
          file_size_bytes?: number | null
          file_type?: string | null
          from_chat?: boolean
          id?: string
          material_kind?: string
          normalised_url?: string | null
          source_post_id?: string | null
          source_url?: string | null
          space_id?: string | null
          storage_path?: string | null
          tenant_id?: string | null
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_resources_source_post_id_fkey"
            columns: ["source_post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_resources_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_resources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_resources_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      community_space_invites: {
        Row: {
          claimed_at: string | null
          claimed_member_id: string | null
          email: string
          id: string
          invited_at: string
          invited_by: string | null
          role: string
          space_id: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_member_id?: string | null
          email: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role?: string
          space_id: string
        }
        Update: {
          claimed_at?: string | null
          claimed_member_id?: string | null
          email?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role?: string
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_space_invites_claimed_member_id_fkey"
            columns: ["claimed_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_invites_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_space_members: {
        Row: {
          accepted_at: string | null
          added_at: string
          id: string
          invited_at: string | null
          invited_by: string | null
          member_id: string
          muted: boolean
          role: string
          space_id: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          added_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          member_id: string
          muted?: boolean
          role?: string
          space_id: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          added_at?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          member_id?: string
          muted?: boolean
          role?: string
          space_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_space_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_members_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_space_roles: {
        Row: {
          created_at: string
          role: string
          space_id: string
        }
        Insert: {
          created_at?: string
          role: string
          space_id: string
        }
        Update: {
          created_at?: string
          role?: string
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_space_roles_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_space_sources: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          object_ref: string
          object_type: string
          space_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          object_ref: string
          object_type: string
          space_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          object_ref?: string
          object_type?: string
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_space_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_sources_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_space_suspensions: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          member_id: string
          reason: string | null
          scope: string
          space_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          member_id: string
          reason?: string | null
          scope: string
          space_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          member_id?: string
          reason?: string | null
          scope?: string
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_space_suspensions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_suspensions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_suspensions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      community_space_tiers: {
        Row: {
          space_id: string
          tier_id: string
        }
        Insert: {
          space_id: string
          tier_id: string
        }
        Update: {
          space_id?: string
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_space_tiers_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_tiers_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      community_space_training: {
        Row: {
          bracket_requirements: Json
          created_at: string
          display_order: number
          is_mandatory: boolean
          space_id: string
          training_module_id: string
        }
        Insert: {
          bracket_requirements?: Json
          created_at?: string
          display_order?: number
          is_mandatory?: boolean
          space_id: string
          training_module_id: string
        }
        Update: {
          bracket_requirements?: Json
          created_at?: string
          display_order?: number
          is_mandatory?: boolean
          space_id?: string
          training_module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_space_training_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "community_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_space_training_training_module_id_fkey"
            columns: ["training_module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      community_spaces: {
        Row: {
          access_type: string
          allow_member_uploads: boolean
          created_at: string
          description: string | null
          display_order: number
          icon: string | null
          id: string
          is_archived: boolean
          min_tier_rank: number
          name: string
          posting_policy: string
          sanity_event_id: string | null
          slug: string
          tenant_id: string | null
          theme: string
        }
        Insert: {
          access_type?: string
          allow_member_uploads?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_archived?: boolean
          min_tier_rank?: number
          name: string
          posting_policy?: string
          sanity_event_id?: string | null
          slug: string
          tenant_id?: string | null
          theme?: string
        }
        Update: {
          access_type?: string
          allow_member_uploads?: boolean
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_archived?: boolean
          min_tier_rank?: number
          name?: string
          posting_policy?: string
          sanity_event_id?: string | null
          slug?: string
          tenant_id?: string | null
          theme?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_spaces_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      container_contents: {
        Row: {
          container_id: string
          content_ref: string
          content_type: string
          created_at: string
          display_name: string | null
          display_order: number
          due_at: string | null
          id: string
          is_mandatory: boolean
          min_membership: number | null
        }
        Insert: {
          container_id: string
          content_ref: string
          content_type: string
          created_at?: string
          display_name?: string | null
          display_order?: number
          due_at?: string | null
          id?: string
          is_mandatory?: boolean
          min_membership?: number | null
        }
        Update: {
          container_id?: string
          content_ref?: string
          content_type?: string
          created_at?: string
          display_name?: string | null
          display_order?: number
          due_at?: string | null
          id?: string
          is_mandatory?: boolean
          min_membership?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "container_contents_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_entitlements: {
        Row: {
          access_level: string
          created_at: string
          created_by: string | null
          id: string
          target_ref: string
          target_type: string
          tier_id: string
        }
        Insert: {
          access_level?: string
          created_at?: string
          created_by?: string | null
          id?: string
          target_ref?: string
          target_type: string
          tier_id: string
        }
        Update: {
          access_level?: string
          created_at?: string
          created_by?: string | null
          id?: string
          target_ref?: string
          target_type?: string
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_entitlements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_entitlements_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      content_persistence: {
        Row: {
          created_at: string
          id: string
          policy: string
          target_ref: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          policy?: string
          target_ref: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          policy?: string
          target_ref?: string
          target_type?: string
        }
        Relationships: []
      }
      content_prerequisites: {
        Row: {
          created_at: string
          id: string
          requires_target_ref: string
          requires_target_type: string
          target_ref: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          requires_target_ref: string
          requires_target_type: string
          target_ref: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          requires_target_ref?: string
          requires_target_type?: string
          target_ref?: string
          target_type?: string
        }
        Relationships: []
      }
      course_object_assignments: {
        Row: {
          audience: string
          created_at: string
          created_by: string | null
          default_requirement: string
          due_at: string | null
          id: string
          module_id: string
          object_label: string | null
          object_ref: string
          object_type: string
          tier_requirements: Json
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          created_by?: string | null
          default_requirement?: string
          due_at?: string | null
          id?: string
          module_id: string
          object_label?: string | null
          object_ref: string
          object_type: string
          tier_requirements?: Json
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          created_by?: string | null
          default_requirement?: string
          due_at?: string | null
          id?: string
          module_id?: string
          object_label?: string | null
          object_ref?: string
          object_type?: string
          tier_requirements?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_object_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_object_assignments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      crawler_hits: {
        Row: {
          bot: string
          id: number
          path: string
          seen_at: string
        }
        Insert: {
          bot: string
          id?: never
          path: string
          seen_at?: string
        }
        Update: {
          bot?: string
          id?: never
          path?: string
          seen_at?: string
        }
        Relationships: []
      }
      credential_events: {
        Row: {
          created_at: string
          credential_id: string
          id: number
          kind: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          credential_id: string
          id?: number
          kind: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          credential_id?: string
          id?: number
          kind?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_events_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "credentials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credentials: {
        Row: {
          activity_date: string | null
          activity_location: string | null
          activity_title: string | null
          award: string | null
          award_type: string | null
          badge_path: string | null
          created_at: string
          criteria: string | null
          description: string | null
          event_slug: string | null
          expires_at: string | null
          id: string
          is_minor: boolean
          issued_at: string
          issuer: string
          member_id: string | null
          module_id: string | null
          number: string
          participant_id: string | null
          pd_hours: number | null
          recipient_name: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          role_label: string | null
          skills: string[]
          source: string
          standards: string[]
          status: string
          tenant_id: string | null
          theme: string | null
          title: string
          tombstoned_at: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          activity_date?: string | null
          activity_location?: string | null
          activity_title?: string | null
          award?: string | null
          award_type?: string | null
          badge_path?: string | null
          created_at?: string
          criteria?: string | null
          description?: string | null
          event_slug?: string | null
          expires_at?: string | null
          id?: string
          is_minor?: boolean
          issued_at?: string
          issuer?: string
          member_id?: string | null
          module_id?: string | null
          number: string
          participant_id?: string | null
          pd_hours?: number | null
          recipient_name: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          role_label?: string | null
          skills?: string[]
          source: string
          standards?: string[]
          status?: string
          tenant_id?: string | null
          theme?: string | null
          title: string
          tombstoned_at?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          activity_date?: string | null
          activity_location?: string | null
          activity_title?: string | null
          award?: string | null
          award_type?: string | null
          badge_path?: string | null
          created_at?: string
          criteria?: string | null
          description?: string | null
          event_slug?: string | null
          expires_at?: string | null
          id?: string
          is_minor?: boolean
          issued_at?: string
          issuer?: string
          member_id?: string | null
          module_id?: string | null
          number?: string
          participant_id?: string | null
          pd_hours?: number | null
          recipient_name?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          role_label?: string | null
          skills?: string[]
          source?: string
          standards?: string[]
          status?: string
          tenant_id?: string | null
          theme?: string | null
          title?: string
          tombstoned_at?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "credentials_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_runs: {
        Row: {
          errors: Json
          finished_at: string | null
          id: string
          job: string
          ok: boolean | null
          parent_id: string | null
          result: Json
          started_at: string
          tenant_id: string | null
        }
        Insert: {
          errors?: Json
          finished_at?: string | null
          id?: string
          job: string
          ok?: boolean | null
          parent_id?: string | null
          result?: Json
          started_at?: string
          tenant_id?: string | null
        }
        Update: {
          errors?: Json
          finished_at?: string | null
          id?: string
          job?: string
          ok?: boolean | null
          parent_id?: string | null
          result?: Json
          started_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cron_runs_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cron_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cron_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      default_badge_templates: {
        Row: {
          artwork_path: string
          audience: string
          created_at: string
          format: string
          id: string
          name_max_width: number | null
          name_size: number | null
          name_x: number | null
          name_y: number | null
          theme: string
          updated_at: string
        }
        Insert: {
          artwork_path: string
          audience: string
          created_at?: string
          format: string
          id?: string
          name_max_width?: number | null
          name_size?: number | null
          name_x?: number | null
          name_y?: number | null
          theme: string
          updated_at?: string
        }
        Update: {
          artwork_path?: string
          audience?: string
          created_at?: string
          format?: string
          id?: string
          name_max_width?: number | null
          name_size?: number | null
          name_x?: number | null
          name_y?: number | null
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      default_certificate_templates: {
        Row: {
          artwork_path: string
          award_type: string
          created_at: string
          name_max_width: number
          name_size: number
          name_y: number
          theme: string
          updated_at: string
        }
        Insert: {
          artwork_path: string
          award_type: string
          created_at?: string
          name_max_width?: number
          name_size?: number
          name_y?: number
          theme: string
          updated_at?: string
        }
        Update: {
          artwork_path?: string
          award_type?: string
          created_at?: string
          name_max_width?: number
          name_size?: number
          name_y?: number
          theme?: string
          updated_at?: string
        }
        Relationships: []
      }
      deletion_archive: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          entity_id: string
          entity_type: string
          id: string
          snapshot: Json
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          entity_id: string
          entity_type: string
          id?: string
          snapshot: Json
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "deletion_archive_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          reason: string | null
          requested_by: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          reason?: string | null
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          reason?: string | null
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deletion_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deletion_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_queue: {
        Row: {
          campaign_id: string
          created_at: string
          dedup_key: string
          due_at: string
          id: string
          member_id: string
          note: string | null
          processed_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          dedup_key?: string
          due_at: string
          id?: string
          member_id: string
          note?: string | null
          processed_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          dedup_key?: string
          due_at?: string
          id?: string
          member_id?: string
          note?: string | null
          processed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_queue_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_queue_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_sends: {
        Row: {
          campaign_id: string
          dedup_key: string
          error: string | null
          id: string
          member_id: string
          sent_at: string
          status: string
        }
        Insert: {
          campaign_id: string
          dedup_key?: string
          error?: string | null
          id?: string
          member_id: string
          sent_at?: string
          status?: string
        }
        Update: {
          campaign_id?: string
          dedup_key?: string
          error?: string | null
          id?: string
          member_id?: string
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_sends_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          audience: Json
          created_at: string
          created_by: string | null
          delay_days: number
          event_key: string | null
          id: string
          name: string
          scheduled_at: string | null
          sent_at: string | null
          sequence_key: string | null
          status: string
          template_id: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          audience?: Json
          created_at?: string
          created_by?: string | null
          delay_days?: number
          event_key?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          sent_at?: string | null
          sequence_key?: string | null
          status?: string
          template_id: string
          trigger_type: string
          updated_at?: string
        }
        Update: {
          audience?: Json
          created_at?: string
          created_by?: string | null
          delay_days?: number
          event_key?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          sent_at?: string | null
          sequence_key?: string | null
          status?: string
          template_id?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          created_at: string
          feature: string | null
          id: string
          link_url: string | null
          member_id: string | null
          occurred_at: string
          payload_min: Json
          provider: string
          provider_email_id: string
          recipient: string
          recipient_hash: string
          ref: string | null
          stream: string | null
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          feature?: string | null
          id?: string
          link_url?: string | null
          member_id?: string | null
          occurred_at: string
          payload_min?: Json
          provider: string
          provider_email_id: string
          recipient: string
          recipient_hash: string
          ref?: string | null
          stream?: string | null
          tenant_id: string
          type: string
        }
        Update: {
          created_at?: string
          feature?: string | null
          id?: string
          link_url?: string | null
          member_id?: string | null
          occurred_at?: string
          payload_min?: Json
          provider?: string
          provider_email_id?: string
          recipient?: string
          recipient_hash?: string
          ref?: string | null
          stream?: string | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attachment_hashes: string[]
          attempts: number
          claimed_at: string | null
          created_at: string
          critical: boolean
          finished_at: string | null
          id: string
          intended_cc: string[]
          intended_to: string
          kind: string
          last_error: string | null
          message: Json
          next_attempt_at: string
          priority: number
          provider_id: string | null
          reason: string
          sent_at: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          attachment_hashes?: string[]
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          critical?: boolean
          finished_at?: string | null
          id?: string
          intended_cc?: string[]
          intended_to: string
          kind: string
          last_error?: string | null
          message: Json
          next_attempt_at?: string
          priority?: number
          provider_id?: string | null
          reason: string
          sent_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Update: {
          attachment_hashes?: string[]
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          critical?: boolean
          finished_at?: string | null
          id?: string
          intended_cc?: string[]
          intended_to?: string
          kind?: string
          last_error?: string | null
          message?: Json
          next_attempt_at?: string
          priority?: number
          provider_id?: string | null
          reason?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox_blobs: {
        Row: {
          content: string
          created_at: string
          sha256: string
        }
        Insert: {
          content: string
          created_at?: string
          sha256: string
        }
        Update: {
          content?: string
          created_at?: string
          sha256?: string
        }
        Relationships: []
      }
      email_send_quota: {
        Row: {
          day: string
          sent: number
        }
        Insert: {
          day: string
          sent?: number
        }
        Update: {
          day?: string
          sent?: number
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          reason: string
          source: string
        }
        Insert: {
          created_at?: string
          email: string
          reason: string
          source: string
        }
        Update: {
          created_at?: string
          email?: string
          reason?: string
          source?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body_json: Json | null
          created_at: string
          id: string
          is_archived: boolean
          key: string
          name: string
          subject: string
          updated_at: string
        }
        Insert: {
          body_json?: Json | null
          created_at?: string
          id?: string
          is_archived?: boolean
          key: string
          name: string
          subject: string
          updated_at?: string
        }
        Update: {
          body_json?: Json | null
          created_at?: string
          id?: string
          is_archived?: boolean
          key?: string
          name?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      esign_access_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          at: string
          detail: Json
          envelope_row: string
          id: number
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          at?: string
          detail?: Json
          envelope_row: string
          id?: never
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          at?: string
          detail?: Json
          envelope_row?: string
          id?: never
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_access_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_audit_events: {
        Row: {
          at: string
          detail: Json
          envelope_row: string
          event: string
          hash: string
          id: number
          ip: string | null
          prev_hash: string | null
          recipient_row: string | null
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          at?: string
          detail?: Json
          envelope_row: string
          event: string
          hash: string
          id?: never
          ip?: string | null
          prev_hash?: string | null
          recipient_row?: string | null
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          at?: string
          detail?: Json
          envelope_row?: string
          event?: string
          hash?: string
          id?: never
          ip?: string | null
          prev_hash?: string | null
          recipient_row?: string | null
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_email_budget: {
        Row: {
          day: string
          sent: number
        }
        Insert: {
          day: string
          sent?: number
        }
        Update: {
          day?: string
          sent?: number
        }
        Relationships: []
      }
      esign_provider_state: {
        Row: {
          account_allowed: number | null
          account_period_end: string | null
          account_sent: number | null
          account_synced_at: string | null
          exhausted_reason: string | null
          exhausted_until: string | null
          id: boolean
          mode: string
          monthly_cap: number
          overflow_allowlist: string[]
          overflow_types: string[]
          reserve: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_allowed?: number | null
          account_period_end?: string | null
          account_sent?: number | null
          account_synced_at?: string | null
          exhausted_reason?: string | null
          exhausted_until?: string | null
          id?: boolean
          mode?: string
          monthly_cap?: number
          overflow_allowlist?: string[]
          overflow_types?: string[]
          reserve?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_allowed?: number | null
          account_period_end?: string | null
          account_sent?: number | null
          account_synced_at?: string | null
          exhausted_reason?: string | null
          exhausted_until?: string | null
          id?: boolean
          mode?: string
          monthly_cap?: number
          overflow_allowlist?: string[]
          overflow_types?: string[]
          reserve?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      esign_templates: {
        Row: {
          active: boolean
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          disclosure_version: string
          field_map: Json
          id: string
          key: string
          page_count: number
          pdf_path: string
          pdf_sha256: string
          source: string
          text_html: string | null
          title: string
          version: number
        }
        Insert: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          disclosure_version: string
          field_map: Json
          id?: string
          key: string
          page_count: number
          pdf_path: string
          pdf_sha256: string
          source?: string
          text_html?: string | null
          title: string
          version: number
        }
        Update: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          disclosure_version?: string
          field_map?: Json
          id?: string
          key?: string
          page_count?: number
          pdf_path?: string
          pdf_sha256?: string
          source?: string
          text_html?: string | null
          title?: string
          version?: number
        }
        Relationships: []
      }
      ethnicity_options: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id?: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      event_addon_settings: {
        Row: {
          event_slug: string
          inclusions: string[]
          merch_upsell: boolean
          tenant_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          event_slug: string
          inclusions?: string[]
          merch_upsell?: boolean
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          event_slug?: string
          inclusions?: string[]
          merch_upsell?: boolean
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_addon_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_addons: {
        Row: {
          audience: string
          capacity: number | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          display_group: string | null
          event_slug: string
          id: string
          includes: string[]
          kind: string
          max_per_person: number
          minors_group_only: boolean
          price_cents: number | null
          refund_rule: string
          refund_until: string | null
          requires_addendum: boolean
          sale_closes_at: string | null
          sale_opens_at: string | null
          service_date: string | null
          service_end_date: string | null
          sort: number
          status: string
          store_product_id: string | null
          tenant_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
          variant_ids: string[]
        }
        Insert: {
          audience?: string
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          display_group?: string | null
          event_slug: string
          id?: string
          includes?: string[]
          kind: string
          max_per_person?: number
          minors_group_only?: boolean
          price_cents?: number | null
          refund_rule?: string
          refund_until?: string | null
          requires_addendum?: boolean
          sale_closes_at?: string | null
          sale_opens_at?: string | null
          service_date?: string | null
          service_end_date?: string | null
          sort?: number
          status?: string
          store_product_id?: string | null
          tenant_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          variant_ids?: string[]
        }
        Update: {
          audience?: string
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          display_group?: string | null
          event_slug?: string
          id?: string
          includes?: string[]
          kind?: string
          max_per_person?: number
          minors_group_only?: boolean
          price_cents?: number | null
          refund_rule?: string
          refund_until?: string | null
          requires_addendum?: boolean
          sale_closes_at?: string | null
          sale_opens_at?: string | null
          service_date?: string | null
          service_end_date?: string | null
          sort?: number
          status?: string
          store_product_id?: string | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          variant_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "event_addons_store_product_id_fkey"
            columns: ["store_product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_addons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_award_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          award_type: string
          company_id: string | null
          event_slug: string
          id: string
          participant_id: string | null
          tenant_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          award_type: string
          company_id?: string | null
          event_slug: string
          id?: string
          participant_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          award_type?: string
          company_id?: string | null
          event_slug?: string
          id?: string
          participant_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_award_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "event_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_award_assignments_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_award_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_badge_templates: {
        Row: {
          artwork_path: string
          audience: string
          company_id: string | null
          created_at: string
          event_slug: string
          format: string
          id: string
          name_max_width: number | null
          name_size: number | null
          name_x: number | null
          name_y: number | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          artwork_path: string
          audience: string
          company_id?: string | null
          created_at?: string
          event_slug: string
          format: string
          id?: string
          name_max_width?: number | null
          name_size?: number | null
          name_x?: number | null
          name_y?: number | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          artwork_path?: string
          audience?: string
          company_id?: string | null
          created_at?: string
          event_slug?: string
          format?: string
          id?: string
          name_max_width?: number | null
          name_size?: number | null
          name_x?: number | null
          name_y?: number | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_badge_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "event_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_badge_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_certificate_templates: {
        Row: {
          artwork_path: string
          award_type: string
          created_at: string
          event_slug: string
          name_max_width: number
          name_size: number
          name_y: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          artwork_path: string
          award_type: string
          created_at?: string
          event_slug: string
          name_max_width?: number
          name_size?: number
          name_y?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          artwork_path?: string
          award_type?: string
          created_at?: string
          event_slug?: string
          name_max_width?: number
          name_size?: number
          name_y?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_certificate_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_companies: {
        Row: {
          created_at: string
          event_slug: string
          id: string
          name: string | null
          number: number
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          event_slug: string
          id?: string
          name?: string | null
          number: number
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          event_slug?: string
          id?: string
          name?: string | null
          number?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_crew_check_ins: {
        Row: {
          check_in_method: string
          checked_in_at: string
          checked_in_by: string | null
          created_at: string
          crew_key: string
          event_slug: string
          id: string
          member_id: string | null
          role: string
          tenant_id: string | null
        }
        Insert: {
          check_in_method?: string
          checked_in_at?: string
          checked_in_by?: string | null
          created_at?: string
          crew_key: string
          event_slug: string
          id?: string
          member_id?: string | null
          role: string
          tenant_id?: string | null
        }
        Update: {
          check_in_method?: string
          checked_in_at?: string
          checked_in_by?: string | null
          created_at?: string
          crew_key?: string
          event_slug?: string
          id?: string
          member_id?: string | null
          role?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_crew_check_ins_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_crew_check_ins_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_email_sends: {
        Row: {
          audiences: string[]
          docusign_resent: number
          email_name: string
          event_email_id: string | null
          event_slug: string
          failed_count: number
          finished_at: string | null
          id: string
          recipient_count: number
          recipients: Json
          sent_count: number
          started_at: string
          subject: string
          tenant_id: string | null
          trigger: string
          triggered_by: string | null
        }
        Insert: {
          audiences?: string[]
          docusign_resent?: number
          email_name: string
          event_email_id?: string | null
          event_slug: string
          failed_count?: number
          finished_at?: string | null
          id?: string
          recipient_count?: number
          recipients?: Json
          sent_count?: number
          started_at?: string
          subject: string
          tenant_id?: string | null
          trigger: string
          triggered_by?: string | null
        }
        Update: {
          audiences?: string[]
          docusign_resent?: number
          email_name?: string
          event_email_id?: string | null
          event_slug?: string
          failed_count?: number
          finished_at?: string | null
          id?: string
          recipient_count?: number
          recipients?: Json
          sent_count?: number
          started_at?: string
          subject?: string
          tenant_id?: string | null
          trigger?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_email_sends_event_email_id_fkey"
            columns: ["event_email_id"]
            isOneToOne: false
            referencedRelation: "event_emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_email_sends_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_email_templates: {
        Row: {
          audiences: string[]
          body_json: Json | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          purpose: string
          resend_docusign: boolean
          schedule_days_before: number | null
          source_event_slug: string | null
          subject: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          audiences?: string[]
          body_json?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          purpose?: string
          resend_docusign?: boolean
          schedule_days_before?: number | null
          source_event_slug?: string | null
          subject?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          audiences?: string[]
          body_json?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          purpose?: string
          resend_docusign?: boolean
          schedule_days_before?: number | null
          source_event_slug?: string | null
          subject?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_email_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_emails: {
        Row: {
          attachments: Json
          audiences: string[]
          body_json: Json | null
          catch_up_claimed_at: string | null
          created_at: string
          created_by: string | null
          event_slug: string
          id: string
          name: string
          purpose: string
          resend_docusign: boolean
          schedule_days_before: number | null
          sent_at: string | null
          status: string
          subject: string
          template_key: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json
          audiences?: string[]
          body_json?: Json | null
          catch_up_claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          event_slug: string
          id?: string
          name: string
          purpose?: string
          resend_docusign?: boolean
          schedule_days_before?: number | null
          sent_at?: string | null
          status?: string
          subject?: string
          template_key?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json
          audiences?: string[]
          body_json?: Json | null
          catch_up_claimed_at?: string | null
          created_at?: string
          created_by?: string | null
          event_slug?: string
          id?: string
          name?: string
          purpose?: string
          resend_docusign?: boolean
          schedule_days_before?: number | null
          sent_at?: string | null
          status?: string
          subject?: string
          template_key?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_emails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_manager_assignments: {
        Row: {
          clearance_basis: string | null
          clerk_user_id: string
          created_at: string
          event_slug: string
          expires_at: string | null
          granted_by_label: string | null
          id: string
          member_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          clearance_basis?: string | null
          clerk_user_id: string
          created_at?: string
          event_slug: string
          expires_at?: string | null
          granted_by_label?: string | null
          id?: string
          member_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          clearance_basis?: string | null
          clerk_user_id?: string
          created_at?: string
          event_slug?: string
          expires_at?: string | null
          granted_by_label?: string | null
          id?: string
          member_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_manager_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_manager_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_participations: {
        Row: {
          award: string | null
          created_at: string
          event_location: string | null
          event_slug: string | null
          event_title: string | null
          event_year: number | null
          id: string
          member_id: string
          role: string | null
          status: string
          team_name: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          award?: string | null
          created_at?: string
          event_location?: string | null
          event_slug?: string | null
          event_title?: string | null
          event_year?: number | null
          id?: string
          member_id: string
          role?: string | null
          status?: string
          team_name?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          award?: string | null
          created_at?: string
          event_location?: string | null
          event_slug?: string | null
          event_title?: string | null
          event_year?: number | null
          id?: string
          member_id?: string
          role?: string | null
          status?: string
          team_name?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_participations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_refunds: {
        Row: {
          addon_line_id: string | null
          created_at: string
          currency: string | null
          days_out: number | null
          decided_by: string | null
          event_slug: string | null
          id: string
          kind: string
          member_id: string | null
          note: string | null
          paid_cents: number | null
          participant_id: string | null
          refund_cents: number | null
          refund_pct: number | null
          refund_type: string
          registration_id: string | null
          source: string
          stripe_refund_id: string | null
          tenant_id: string | null
        }
        Insert: {
          addon_line_id?: string | null
          created_at?: string
          currency?: string | null
          days_out?: number | null
          decided_by?: string | null
          event_slug?: string | null
          id?: string
          kind?: string
          member_id?: string | null
          note?: string | null
          paid_cents?: number | null
          participant_id?: string | null
          refund_cents?: number | null
          refund_pct?: number | null
          refund_type: string
          registration_id?: string | null
          source?: string
          stripe_refund_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          addon_line_id?: string | null
          created_at?: string
          currency?: string | null
          days_out?: number | null
          decided_by?: string | null
          event_slug?: string | null
          id?: string
          kind?: string
          member_id?: string | null
          note?: string | null
          paid_cents?: number | null
          participant_id?: string | null
          refund_cents?: number | null
          refund_pct?: number | null
          refund_type?: string
          registration_id?: string | null
          source?: string
          stripe_refund_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_refunds_addon_line_id_fkey"
            columns: ["addon_line_id"]
            isOneToOne: false
            referencedRelation: "registration_addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_refunds_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_refunds_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_refunds_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_refunds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_settings: {
        Row: {
          awards_issued_at: string | null
          badge_8395_artwork_path: string | null
          badge_artwork_path: string | null
          certificate_artwork_path: string | null
          certificate_format: string
          check_in_open: boolean
          check_in_token: string | null
          company_count: number | null
          created_at: string
          credential_criteria: string | null
          credential_description: string | null
          credential_skills: string[]
          credential_title: string | null
          event_slug: string
          mentor_credential_criteria: string | null
          mentor_credential_description: string | null
          mentor_credential_skills: string[]
          mentor_credential_title: string | null
          resources_url: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          awards_issued_at?: string | null
          badge_8395_artwork_path?: string | null
          badge_artwork_path?: string | null
          certificate_artwork_path?: string | null
          certificate_format?: string
          check_in_open?: boolean
          check_in_token?: string | null
          company_count?: number | null
          created_at?: string
          credential_criteria?: string | null
          credential_description?: string | null
          credential_skills?: string[]
          credential_title?: string | null
          event_slug: string
          mentor_credential_criteria?: string | null
          mentor_credential_description?: string | null
          mentor_credential_skills?: string[]
          mentor_credential_title?: string | null
          resources_url?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          awards_issued_at?: string | null
          badge_8395_artwork_path?: string | null
          badge_artwork_path?: string | null
          certificate_artwork_path?: string | null
          certificate_format?: string
          check_in_open?: boolean
          check_in_token?: string | null
          company_count?: number | null
          created_at?: string
          credential_criteria?: string | null
          credential_description?: string | null
          credential_skills?: string[]
          credential_title?: string | null
          event_slug?: string
          mentor_credential_criteria?: string | null
          mentor_credential_description?: string | null
          mentor_credential_skills?: string[]
          mentor_credential_title?: string | null
          resources_url?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      event_store_offerings: {
        Row: {
          created_at: string
          event_slug: string
          id: string
          tenant_id: string | null
          treatment: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          event_slug: string
          id?: string
          tenant_id?: string | null
          treatment: string
          variant_id: string
        }
        Update: {
          created_at?: string
          event_slug?: string
          id?: string
          tenant_id?: string | null
          treatment?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_store_offerings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_store_offerings_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "store_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          activity_type: string
          country: string
          created_at: string
          currency: string
          ends_at: string | null
          grade_system: string
          id: string
          min_participant_age: number | null
          raw: Json
          sanity_id: string
          slug: string
          source_updated_at: string | null
          starts_at: string | null
          status: string | null
          synced_at: string
          tenant_id: string
          time_zone: string
          title: string
        }
        Insert: {
          activity_type?: string
          country: string
          created_at?: string
          currency: string
          ends_at?: string | null
          grade_system: string
          id?: string
          min_participant_age?: number | null
          raw?: Json
          sanity_id: string
          slug: string
          source_updated_at?: string | null
          starts_at?: string | null
          status?: string | null
          synced_at?: string
          tenant_id: string
          time_zone: string
          title: string
        }
        Update: {
          activity_type?: string
          country?: string
          created_at?: string
          currency?: string
          ends_at?: string | null
          grade_system?: string
          id?: string
          min_participant_age?: number | null
          raw?: Json
          sanity_id?: string
          slug?: string
          source_updated_at?: string | null
          starts_at?: string | null
          status?: string | null
          synced_at?: string
          tenant_id?: string
          time_zone?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invoices: {
        Row: {
          addons_cents: number
          coupon_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          discount_cents: number
          event_slug: string | null
          id: string
          kind: string
          paid_at: string | null
          participant_ids: string[]
          payment_intent_id: string | null
          per_seat_cents: number
          promotion_code: string | null
          reason: string | null
          registration_id: string | null
          replaces_stripe_invoice_id: string | null
          seats: number
          status: string
          stripe_invoice_id: string
          stripe_invoice_number: string | null
          subtotal_cents: number
          tenant_id: string | null
          total_cents: number
          voided_at: string | null
        }
        Insert: {
          addons_cents?: number
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_cents?: number
          event_slug?: string | null
          id?: string
          kind: string
          paid_at?: string | null
          participant_ids?: string[]
          payment_intent_id?: string | null
          per_seat_cents: number
          promotion_code?: string | null
          reason?: string | null
          registration_id?: string | null
          replaces_stripe_invoice_id?: string | null
          seats: number
          status: string
          stripe_invoice_id: string
          stripe_invoice_number?: string | null
          subtotal_cents?: number
          tenant_id?: string | null
          total_cents?: number
          voided_at?: string | null
        }
        Update: {
          addons_cents?: number
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_cents?: number
          event_slug?: string | null
          id?: string
          kind?: string
          paid_at?: string | null
          participant_ids?: string[]
          payment_intent_id?: string | null
          per_seat_cents?: number
          promotion_code?: string | null
          reason?: string | null
          registration_id?: string | null
          replaces_stripe_invoice_id?: string | null
          seats?: number
          status?: string
          stripe_invoice_id?: string
          stripe_invoice_number?: string | null
          subtotal_cents?: number
          tenant_id?: string | null
          total_cents?: number
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invoices_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      group_join_tokens: {
        Row: {
          created_at: string
          event_slug: string
          event_title: string
          expires_at: string
          id: string
          registration_id: string
          tenant_id: string | null
          token: string
        }
        Insert: {
          created_at?: string
          event_slug: string
          event_title: string
          expires_at?: string
          id?: string
          registration_id: string
          tenant_id?: string | null
          token: string
        }
        Update: {
          created_at?: string
          event_slug?: string
          event_title?: string
          expires_at?: string
          id?: string
          registration_id?: string
          tenant_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_join_tokens_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_join_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      host_availability: {
        Row: {
          created_at: string
          end_minute: number
          host_member_id: string
          id: string
          session_type: string
          start_minute: number
          weekday: number
        }
        Insert: {
          created_at?: string
          end_minute: number
          host_member_id: string
          id?: string
          session_type?: string
          start_minute: number
          weekday: number
        }
        Update: {
          created_at?: string
          end_minute?: number
          host_member_id?: string
          id?: string
          session_type?: string
          start_minute?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "host_availability_host_member_id_fkey"
            columns: ["host_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_capture_failures: {
        Row: {
          created_at: string
          email: string
          id: string
          notes: string | null
          payload: Json
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          source: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          payload?: Json
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          source: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          payload?: Json
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
        }
        Relationships: []
      }
      member_activity_log: {
        Row: {
          action: string
          actor_label: string | null
          actor_member_id: string | null
          actor_type: string
          category: string
          created_at: string
          id: string
          member_id: string
          metadata: Json
          summary: string
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_member_id?: string | null
          actor_type?: string
          category: string
          created_at?: string
          id?: string
          member_id: string
          metadata?: Json
          summary: string
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_member_id?: string | null
          actor_type?: string
          category?: string
          created_at?: string
          id?: string
          member_id?: string
          metadata?: Json
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_activity_log_actor_member_id_fkey"
            columns: ["actor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_activity_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_addresses: {
        Row: {
          city: string
          country: string
          created_at: string
          id: string
          is_default: boolean
          label: string | null
          line1: string
          line2: string | null
          member_id: string
          postcode: string
          state: string
        }
        Insert: {
          city: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          line1: string
          line2?: string | null
          member_id: string
          postcode: string
          state: string
        }
        Update: {
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          line1?: string
          line2?: string | null
          member_id?: string
          postcode?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_addresses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_allergies: {
        Row: {
          allergy_option_id: string | null
          id: string
          member_id: string
          notes: string | null
        }
        Insert: {
          allergy_option_id?: string | null
          id?: string
          member_id: string
          notes?: string | null
        }
        Update: {
          allergy_option_id?: string | null
          id?: string
          member_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_allergies_allergy_option_id_fkey"
            columns: ["allergy_option_id"]
            isOneToOne: false
            referencedRelation: "allergy_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_allergies_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_background_checks: {
        Row: {
          adjudicated_at: string | null
          adjudicated_by: string | null
          adjudicated_label: string | null
          adjudication_notes: string | null
          adjudication_outcome: string | null
          assessment: string | null
          completed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          includes_canceled: boolean
          invitation_url: string | null
          member_id: string
          ordered_at: string
          ordered_by: string | null
          ordered_label: string | null
          provider: string
          provider_adjudication: string | null
          provider_candidate_ref: string | null
          provider_invitation_ref: string | null
          provider_report_ref: string | null
          raw: Json | null
          report_pdf_url: string | null
          request_flags: Json
          result: string | null
          status: string
          updated_at: string
        }
        Insert: {
          adjudicated_at?: string | null
          adjudicated_by?: string | null
          adjudicated_label?: string | null
          adjudication_notes?: string | null
          adjudication_outcome?: string | null
          assessment?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          includes_canceled?: boolean
          invitation_url?: string | null
          member_id: string
          ordered_at?: string
          ordered_by?: string | null
          ordered_label?: string | null
          provider?: string
          provider_adjudication?: string | null
          provider_candidate_ref?: string | null
          provider_invitation_ref?: string | null
          provider_report_ref?: string | null
          raw?: Json | null
          report_pdf_url?: string | null
          request_flags?: Json
          result?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          adjudicated_at?: string | null
          adjudicated_by?: string | null
          adjudicated_label?: string | null
          adjudication_notes?: string | null
          adjudication_outcome?: string | null
          assessment?: string | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          includes_canceled?: boolean
          invitation_url?: string | null
          member_id?: string
          ordered_at?: string
          ordered_by?: string | null
          ordered_label?: string | null
          provider?: string
          provider_adjudication?: string | null
          provider_candidate_ref?: string | null
          provider_invitation_ref?: string | null
          provider_report_ref?: string | null
          raw?: Json | null
          report_pdf_url?: string | null
          request_flags?: Json
          result?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_background_checks_adjudicated_by_fkey"
            columns: ["adjudicated_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_background_checks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_background_checks_ordered_by_fkey"
            columns: ["ordered_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_directory_prefs: {
        Row: {
          is_visible: boolean
          member_id: string
          show_region: boolean
          show_school: boolean
          updated_at: string
        }
        Insert: {
          is_visible?: boolean
          member_id: string
          show_region?: boolean
          show_school?: boolean
          updated_at?: string
        }
        Update: {
          is_visible?: boolean
          member_id?: string
          show_region?: boolean
          show_school?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_directory_prefs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_ethnicities: {
        Row: {
          ethnicity_option_id: string | null
          id: string
          member_id: string
        }
        Insert: {
          ethnicity_option_id?: string | null
          id?: string
          member_id: string
        }
        Update: {
          ethnicity_option_id?: string | null
          id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_ethnicities_ethnicity_option_id_fkey"
            columns: ["ethnicity_option_id"]
            isOneToOne: false
            referencedRelation: "ethnicity_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_ethnicities_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_external_background_checks: {
        Row: {
          completed_on: string
          created_at: string
          document_expires_on: string | null
          document_path: string
          id: string
          issuer: string
          member_id: string
          submitted_by: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          verified_label: string | null
        }
        Insert: {
          completed_on: string
          created_at?: string
          document_expires_on?: string | null
          document_path: string
          id?: string
          issuer: string
          member_id: string
          submitted_by?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_label?: string | null
        }
        Update: {
          completed_on?: string
          created_at?: string
          document_expires_on?: string | null
          document_path?: string
          id?: string
          issuer?: string
          member_id?: string
          submitted_by?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_external_background_checks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_group_members: {
        Row: {
          added_at: string
          group_id: string
          member_id: string
          tenant_id: string | null
        }
        Insert: {
          added_at?: string
          group_id: string
          member_id: string
          tenant_id?: string | null
        }
        Update: {
          added_at?: string
          group_id?: string
          member_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "member_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_group_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_group_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_groups: {
        Row: {
          created_at: string
          event_slug: string | null
          id: string
          name: string
          owner_id: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          event_slug?: string | null
          id?: string
          name: string
          owner_id: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          event_slug?: string | null
          id?: string
          name?: string
          owner_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_groups_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_memberships: {
        Row: {
          billing_interval: string | null
          created_at: string
          expires_at: string | null
          granted_by_rule: string | null
          id: string
          is_complimentary: boolean
          member_id: string
          renewal_status: Database["public"]["Enums"]["membership_renewal_status"]
          source: string
          started_at: string
          stripe_customer_id: string | null
          stripe_payment_id: string | null
          stripe_subscription_id: string | null
          tier_id: string
          updated_at: string
        }
        Insert: {
          billing_interval?: string | null
          created_at?: string
          expires_at?: string | null
          granted_by_rule?: string | null
          id?: string
          is_complimentary?: boolean
          member_id: string
          renewal_status?: Database["public"]["Enums"]["membership_renewal_status"]
          source?: string
          started_at: string
          stripe_customer_id?: string | null
          stripe_payment_id?: string | null
          stripe_subscription_id?: string | null
          tier_id: string
          updated_at?: string
        }
        Update: {
          billing_interval?: string | null
          created_at?: string
          expires_at?: string | null
          granted_by_rule?: string | null
          id?: string
          is_complimentary?: boolean
          member_id?: string
          renewal_status?: Database["public"]["Enums"]["membership_renewal_status"]
          source?: string
          started_at?: string
          stripe_customer_id?: string | null
          stripe_payment_id?: string | null
          stripe_subscription_id?: string | null
          tier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_memberships_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      member_notification_prefs: {
        Row: {
          email_enabled: boolean
          inapp_enabled: boolean
          member_id: string
          sms_consent_at: string | null
          sms_enabled: boolean
          sms_number: string | null
          updated_at: string
        }
        Insert: {
          email_enabled?: boolean
          inapp_enabled?: boolean
          member_id: string
          sms_consent_at?: string | null
          sms_enabled?: boolean
          sms_number?: string | null
          updated_at?: string
        }
        Update: {
          email_enabled?: boolean
          inapp_enabled?: boolean
          member_id?: string
          sms_consent_at?: string | null
          sms_enabled?: boolean
          sms_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_notification_prefs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_pending_consent: {
        Row: {
          band: string
          consented_at: string | null
          created_at: string
          guardian_email: string | null
          guardian_email_bidx: string | null
          guardian_email_enc: string | null
          guardian_name: string | null
          guardian_name_enc: string | null
          last_sent_at: string | null
          member_id: string
          next_attempt_at: string | null
          purge_after: string
          requested_at: string
        }
        Insert: {
          band: string
          consented_at?: string | null
          created_at?: string
          guardian_email?: string | null
          guardian_email_bidx?: string | null
          guardian_email_enc?: string | null
          guardian_name?: string | null
          guardian_name_enc?: string | null
          last_sent_at?: string | null
          member_id: string
          next_attempt_at?: string | null
          purge_after?: string
          requested_at?: string
        }
        Update: {
          band?: string
          consented_at?: string | null
          created_at?: string
          guardian_email?: string | null
          guardian_email_bidx?: string | null
          guardian_email_enc?: string | null
          guardian_name?: string | null
          guardian_name_enc?: string | null
          last_sent_at?: string | null
          member_id?: string
          next_attempt_at?: string | null
          purge_after?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_pending_consent_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_privacy_prefs: {
        Row: {
          allow_media: boolean | null
          allow_quotes: boolean | null
          member_id: string
          updated_at: string
        }
        Insert: {
          allow_media?: boolean | null
          allow_quotes?: boolean | null
          member_id: string
          updated_at?: string
        }
        Update: {
          allow_media?: boolean | null
          allow_quotes?: boolean | null
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_privacy_prefs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          member_id: string
          object_id: string | null
          object_type: string | null
          role: Database["public"]["Enums"]["member_role_type"]
          scope: string
          source: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          member_id: string
          object_id?: string | null
          object_type?: string | null
          role: Database["public"]["Enums"]["member_role_type"]
          scope?: string
          source?: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          member_id?: string
          object_id?: string | null
          object_type?: string | null
          role?: Database["public"]["Enums"]["member_role_type"]
          scope?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_schools: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          is_current: boolean
          member_id: string
          school_id: string
          started_at: string | null
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          is_current?: boolean
          member_id: string
          school_id: string
          started_at?: string | null
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          is_current?: boolean
          member_id?: string
          school_id?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_schools_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_schools_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_schools_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "survey_answers_long"
            referencedColumns: ["school_id"]
          },
        ]
      }
      member_teacher_licenses: {
        Row: {
          created_at: string
          document_path: string | null
          expiry_date: string
          id: string
          license_number: string
          licensing_state: string
          member_id: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          verified_label: string | null
        }
        Insert: {
          created_at?: string
          document_path?: string | null
          expiry_date: string
          id?: string
          license_number: string
          licensing_state: string
          member_id: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_label?: string | null
        }
        Update: {
          created_at?: string
          document_path?: string | null
          expiry_date?: string
          id?: string
          license_number?: string
          licensing_state?: string
          member_id?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_teacher_licenses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_teacher_licenses_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          account_invite_sent_at: string | null
          age_bracket: Database["public"]["Enums"]["age_bracket_type"] | null
          clerk_user_id: string | null
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          discord_handle: string | null
          ec_email: string | null
          ec_email_bidx: string | null
          ec_email_enc: string | null
          ec_first_name: string | null
          ec_first_name_enc: string | null
          ec_last_name: string | null
          ec_last_name_enc: string | null
          ec_phone: string | null
          ec_phone_bidx: string | null
          ec_phone_enc: string | null
          ec_relationship: string | null
          ec_relationship_enc: string | null
          email: string
          event_role: Database["public"]["Enums"]["event_role_type"]
          first_name: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          grade: Database["public"]["Enums"]["grade_type"] | null
          grade_auto_promote: boolean
          graduation_year: number | null
          health_conditions: string | null
          health_conditions_enc: string | null
          id: string
          is_active: boolean
          last_name: string
          marketing_consent: boolean
          marketing_unsubscribe_token: string
          marketing_unsubscribed_at: string | null
          member_code: string | null
          membership_id: string
          nickname: string | null
          phone: string | null
          profile_photo_url: string | null
          school_email: string | null
          stripe_customer_id: string | null
          tshirt_size: Database["public"]["Enums"]["tshirt_size_type"] | null
          updated_at: string
        }
        Insert: {
          account_invite_sent_at?: string | null
          age_bracket?: Database["public"]["Enums"]["age_bracket_type"] | null
          clerk_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          discord_handle?: string | null
          ec_email?: string | null
          ec_email_bidx?: string | null
          ec_email_enc?: string | null
          ec_first_name?: string | null
          ec_first_name_enc?: string | null
          ec_last_name?: string | null
          ec_last_name_enc?: string | null
          ec_phone?: string | null
          ec_phone_bidx?: string | null
          ec_phone_enc?: string | null
          ec_relationship?: string | null
          ec_relationship_enc?: string | null
          email: string
          event_role: Database["public"]["Enums"]["event_role_type"]
          first_name: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          grade?: Database["public"]["Enums"]["grade_type"] | null
          grade_auto_promote?: boolean
          graduation_year?: number | null
          health_conditions?: string | null
          health_conditions_enc?: string | null
          id?: string
          is_active?: boolean
          last_name: string
          marketing_consent?: boolean
          marketing_unsubscribe_token?: string
          marketing_unsubscribed_at?: string | null
          member_code?: string | null
          membership_id?: string
          nickname?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          school_email?: string | null
          stripe_customer_id?: string | null
          tshirt_size?: Database["public"]["Enums"]["tshirt_size_type"] | null
          updated_at?: string
        }
        Update: {
          account_invite_sent_at?: string | null
          age_bracket?: Database["public"]["Enums"]["age_bracket_type"] | null
          clerk_user_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          discord_handle?: string | null
          ec_email?: string | null
          ec_email_bidx?: string | null
          ec_email_enc?: string | null
          ec_first_name?: string | null
          ec_first_name_enc?: string | null
          ec_last_name?: string | null
          ec_last_name_enc?: string | null
          ec_phone?: string | null
          ec_phone_bidx?: string | null
          ec_phone_enc?: string | null
          ec_relationship?: string | null
          ec_relationship_enc?: string | null
          email?: string
          event_role?: Database["public"]["Enums"]["event_role_type"]
          first_name?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          grade?: Database["public"]["Enums"]["grade_type"] | null
          grade_auto_promote?: boolean
          graduation_year?: number | null
          health_conditions?: string | null
          health_conditions_enc?: string | null
          id?: string
          is_active?: boolean
          last_name?: string
          marketing_consent?: boolean
          marketing_unsubscribe_token?: string
          marketing_unsubscribed_at?: string | null
          member_code?: string | null
          membership_id?: string
          nickname?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          school_email?: string | null
          stripe_customer_id?: string | null
          tshirt_size?: Database["public"]["Enums"]["tshirt_size_type"] | null
          updated_at?: string
        }
        Relationships: []
      }
      membership_tiers: {
        Row: {
          academy_discount_percent: number
          age_bracket: Database["public"]["Enums"]["age_bracket_type"] | null
          annual_cost_cents: number
          badge_color: string | null
          created_at: string
          default_grant_months: number | null
          description: string | null
          eligible_roles: string[] | null
          grouping_title: string | null
          id: string
          includes_free_mentoring: boolean
          is_free: boolean
          marketing_copy: string | null
          mentoring_credits_grant: number
          monthly_cost_cents: number | null
          name: string
          sort_order: number
          stripe_price_id: string | null
          stripe_price_id_monthly: string | null
          workshop_credits_grant: number
        }
        Insert: {
          academy_discount_percent?: number
          age_bracket?: Database["public"]["Enums"]["age_bracket_type"] | null
          annual_cost_cents?: number
          badge_color?: string | null
          created_at?: string
          default_grant_months?: number | null
          description?: string | null
          eligible_roles?: string[] | null
          grouping_title?: string | null
          id?: string
          includes_free_mentoring?: boolean
          is_free?: boolean
          marketing_copy?: string | null
          mentoring_credits_grant?: number
          monthly_cost_cents?: number | null
          name: string
          sort_order?: number
          stripe_price_id?: string | null
          stripe_price_id_monthly?: string | null
          workshop_credits_grant?: number
        }
        Update: {
          academy_discount_percent?: number
          age_bracket?: Database["public"]["Enums"]["age_bracket_type"] | null
          annual_cost_cents?: number
          badge_color?: string | null
          created_at?: string
          default_grant_months?: number | null
          description?: string | null
          eligible_roles?: string[] | null
          grouping_title?: string | null
          id?: string
          includes_free_mentoring?: boolean
          is_free?: boolean
          marketing_copy?: string | null
          mentoring_credits_grant?: number
          monthly_cost_cents?: number | null
          name?: string
          sort_order?: number
          stripe_price_id?: string | null
          stripe_price_id_monthly?: string | null
          workshop_credits_grant?: number
        }
        Relationships: []
      }
      mentoring_cohorts: {
        Row: {
          archived_at: string | null
          blurb: string | null
          campaign_ref: string | null
          container_type: string
          created_at: string
          credit_cost: number
          free_for_tier_ids: string[]
          id: string
          is_active: boolean
          is_open: boolean
          lifecycle: string
          mentor_member_id: string | null
          name: string
          one_off_price_cents: number | null
          one_off_stripe_price_id: string | null
          parent_container_id: string | null
          planned_sessions: number
          registration_id: string | null
          sanity_event_id: string | null
          start_date: string | null
          tenant_id: string | null
          theme: string
          timezone: string
        }
        Insert: {
          archived_at?: string | null
          blurb?: string | null
          campaign_ref?: string | null
          container_type?: string
          created_at?: string
          credit_cost?: number
          free_for_tier_ids?: string[]
          id?: string
          is_active?: boolean
          is_open?: boolean
          lifecycle?: string
          mentor_member_id?: string | null
          name: string
          one_off_price_cents?: number | null
          one_off_stripe_price_id?: string | null
          parent_container_id?: string | null
          planned_sessions?: number
          registration_id?: string | null
          sanity_event_id?: string | null
          start_date?: string | null
          tenant_id?: string | null
          theme?: string
          timezone?: string
        }
        Update: {
          archived_at?: string | null
          blurb?: string | null
          campaign_ref?: string | null
          container_type?: string
          created_at?: string
          credit_cost?: number
          free_for_tier_ids?: string[]
          id?: string
          is_active?: boolean
          is_open?: boolean
          lifecycle?: string
          mentor_member_id?: string | null
          name?: string
          one_off_price_cents?: number | null
          one_off_stripe_price_id?: string | null
          parent_container_id?: string | null
          planned_sessions?: number
          registration_id?: string | null
          sanity_event_id?: string | null
          start_date?: string | null
          tenant_id?: string | null
          theme?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentoring_cohorts_mentor_member_id_fkey"
            columns: ["mentor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentoring_cohorts_parent_container_id_fkey"
            columns: ["parent_container_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentoring_cohorts_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentoring_cohorts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      merch_batches: {
        Row: {
          batch_type: string
          committed_at: string | null
          committed_by: string | null
          created_at: string
          event_slug: string
          id: string
          owner_member_id: string | null
          pod_order_id: string | null
          ship_to: Json | null
          status: string
          tenant_id: string | null
          tracking_url: string | null
        }
        Insert: {
          batch_type: string
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          event_slug: string
          id?: string
          owner_member_id?: string | null
          pod_order_id?: string | null
          ship_to?: Json | null
          status?: string
          tenant_id?: string | null
          tracking_url?: string | null
        }
        Update: {
          batch_type?: string
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          event_slug?: string
          id?: string
          owner_member_id?: string | null
          pod_order_id?: string | null
          ship_to?: Json | null
          status?: string
          tenant_id?: string | null
          tracking_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merch_batches_committed_by_fkey"
            columns: ["committed_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merch_batches_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merch_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      object_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          member_id: string
          object_id: string
          object_type: string
          role: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          member_id: string
          object_id: string
          object_type: string
          role?: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          member_id?: string
          object_id?: string
          object_type?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "object_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "object_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      object_type_relations: {
        Row: {
          allowed: boolean
          from_type: string
          to_type: string
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          from_type: string
          to_type: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          from_type?: string
          to_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      object_type_singleton_roles: {
        Row: {
          object_type: string
          role: Database["public"]["Enums"]["member_role_type"]
        }
        Insert: {
          object_type: string
          role: Database["public"]["Enums"]["member_role_type"]
        }
        Update: {
          object_type?: string
          role?: Database["public"]["Enums"]["member_role_type"]
        }
        Relationships: []
      }
      participants: {
        Row: {
          age_bracket: string
          award: string | null
          base_paid_cents: number | null
          check_in_method: string | null
          checked_in_at: string | null
          company_id: string | null
          company_locked: boolean
          company_name: string | null
          created_at: string
          date_of_birth: string
          details_from_member: boolean
          dietary_requirements: string[]
          dietary_requirements_enc: string | null
          discount_code: string | null
          email: string
          emergency_contact_email: string | null
          emergency_contact_email_bidx: string | null
          emergency_contact_email_enc: string | null
          emergency_contact_first_name: string | null
          emergency_contact_first_name_enc: string | null
          emergency_contact_last_name: string | null
          emergency_contact_last_name_enc: string | null
          emergency_contact_phone: string | null
          emergency_contact_phone_bidx: string | null
          emergency_contact_phone_enc: string | null
          emergency_contact_relationship: string | null
          emergency_contact_relationship_enc: string | null
          ethnicity: string[]
          event_role: string
          first_name: string
          gender: string
          grade: string | null
          health_conditions: string | null
          health_conditions_enc: string | null
          id: string
          individual_payment_link_sent_at: string | null
          individual_payment_status: string | null
          join_completed_at: string | null
          last_name: string
          member_id: string | null
          membership_id: string
          merch_collected: boolean
          merch_collected_at: string | null
          nickname: string | null
          pay_token: string | null
          payer: string | null
          phone: string
          registration_id: string
          school_email: string | null
          school_name: string
          share_paid_cents: number | null
          stripe_payment_intent_id: string | null
          t_shirt_size: string
          team_profile_overridden_at: string | null
          team_profile_overridden_by: string | null
          team_profile_overridden_by_name: string | null
          tenant_id: string | null
        }
        Insert: {
          age_bracket: string
          award?: string | null
          base_paid_cents?: number | null
          check_in_method?: string | null
          checked_in_at?: string | null
          company_id?: string | null
          company_locked?: boolean
          company_name?: string | null
          created_at?: string
          date_of_birth: string
          details_from_member?: boolean
          dietary_requirements?: string[]
          dietary_requirements_enc?: string | null
          discount_code?: string | null
          email: string
          emergency_contact_email?: string | null
          emergency_contact_email_bidx?: string | null
          emergency_contact_email_enc?: string | null
          emergency_contact_first_name?: string | null
          emergency_contact_first_name_enc?: string | null
          emergency_contact_last_name?: string | null
          emergency_contact_last_name_enc?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_phone_bidx?: string | null
          emergency_contact_phone_enc?: string | null
          emergency_contact_relationship?: string | null
          emergency_contact_relationship_enc?: string | null
          ethnicity?: string[]
          event_role: string
          first_name: string
          gender: string
          grade?: string | null
          health_conditions?: string | null
          health_conditions_enc?: string | null
          id?: string
          individual_payment_link_sent_at?: string | null
          individual_payment_status?: string | null
          join_completed_at?: string | null
          last_name: string
          member_id?: string | null
          membership_id?: string
          merch_collected?: boolean
          merch_collected_at?: string | null
          nickname?: string | null
          pay_token?: string | null
          payer?: string | null
          phone: string
          registration_id: string
          school_email?: string | null
          school_name: string
          share_paid_cents?: number | null
          stripe_payment_intent_id?: string | null
          t_shirt_size: string
          team_profile_overridden_at?: string | null
          team_profile_overridden_by?: string | null
          team_profile_overridden_by_name?: string | null
          tenant_id?: string | null
        }
        Update: {
          age_bracket?: string
          award?: string | null
          base_paid_cents?: number | null
          check_in_method?: string | null
          checked_in_at?: string | null
          company_id?: string | null
          company_locked?: boolean
          company_name?: string | null
          created_at?: string
          date_of_birth?: string
          details_from_member?: boolean
          dietary_requirements?: string[]
          dietary_requirements_enc?: string | null
          discount_code?: string | null
          email?: string
          emergency_contact_email?: string | null
          emergency_contact_email_bidx?: string | null
          emergency_contact_email_enc?: string | null
          emergency_contact_first_name?: string | null
          emergency_contact_first_name_enc?: string | null
          emergency_contact_last_name?: string | null
          emergency_contact_last_name_enc?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_phone_bidx?: string | null
          emergency_contact_phone_enc?: string | null
          emergency_contact_relationship?: string | null
          emergency_contact_relationship_enc?: string | null
          ethnicity?: string[]
          event_role?: string
          first_name?: string
          gender?: string
          grade?: string | null
          health_conditions?: string | null
          health_conditions_enc?: string | null
          id?: string
          individual_payment_link_sent_at?: string | null
          individual_payment_status?: string | null
          join_completed_at?: string | null
          last_name?: string
          member_id?: string | null
          membership_id?: string
          merch_collected?: boolean
          merch_collected_at?: string | null
          nickname?: string | null
          pay_token?: string | null
          payer?: string | null
          phone?: string
          registration_id?: string
          school_email?: string | null
          school_name?: string
          share_paid_cents?: number | null
          stripe_payment_intent_id?: string | null
          t_shirt_size?: string
          team_profile_overridden_at?: string | null
          team_profile_overridden_by?: string | null
          team_profile_overridden_by_name?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "event_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "participants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          clerk_user_id: string
          created_at: string
          granted_by: string
          id: string
        }
        Insert: {
          clerk_user_id: string
          created_at?: string
          granted_by: string
          id?: string
        }
        Update: {
          clerk_user_id?: string
          created_at?: string
          granted_by?: string
          id?: string
        }
        Relationships: []
      }
      platform_audit_events: {
        Row: {
          action: string
          actor: string
          actor_kind: string
          chain_seq: number
          hash: string
          id: number
          metadata: Json
          occurred_at: string
          prev_hash: string | null
          reason: string | null
          target_id: string | null
          target_table: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor: string
          actor_kind: string
          chain_seq: number
          hash: string
          id?: never
          metadata?: Json
          occurred_at: string
          prev_hash?: string | null
          reason?: string | null
          target_id?: string | null
          target_table?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          actor_kind?: string
          chain_seq?: number
          hash?: string
          id?: never
          metadata?: Json
          occurred_at?: string
          prev_hash?: string | null
          reason?: string | null
          target_id?: string | null
          target_table?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_pricing: {
        Row: {
          cohort_credit_price_cents: number
          cohort_price_cents: number
          id: boolean
          updated_at: string
          workshop_credit_price_cents: number
          workshop_price_cents: number
        }
        Insert: {
          cohort_credit_price_cents?: number
          cohort_price_cents?: number
          id?: boolean
          updated_at?: string
          workshop_credit_price_cents?: number
          workshop_price_cents?: number
        }
        Update: {
          cohort_credit_price_cents?: number
          cohort_price_cents?: number
          id?: boolean
          updated_at?: string
          workshop_credit_price_cents?: number
          workshop_price_cents?: number
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          created_at: string
          details: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          relationship: string
          requester_email: string
          requester_name: string
          resolution_note: string | null
          status: string
          subject_name: string | null
          token_version: number
          updated_at: string
          verified_at: string | null
          verified_ip: string | null
        }
        Insert: {
          created_at?: string
          details?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind: string
          relationship: string
          requester_email: string
          requester_name: string
          resolution_note?: string | null
          status?: string
          subject_name?: string | null
          token_version?: number
          updated_at?: string
          verified_at?: string | null
          verified_ip?: string | null
        }
        Update: {
          created_at?: string
          details?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          relationship?: string
          requester_email?: string
          requester_name?: string
          resolution_note?: string | null
          status?: string
          subject_name?: string | null
          token_version?: number
          updated_at?: string
          verified_at?: string | null
          verified_ip?: string | null
        }
        Relationships: []
      }
      rate_limit_hits: {
        Row: {
          hits: number
          key_hash: string
          window_seconds: number
          window_start: string
        }
        Insert: {
          hits: number
          key_hash: string
          window_seconds: number
          window_start: string
        }
        Update: {
          hits?: number
          key_hash?: string
          window_seconds?: number
          window_start?: string
        }
        Relationships: []
      }
      record_access_log: {
        Row: {
          action: string
          actor: string
          actor_role: string
          at: string
          detail: Json | null
          id: string
          route: string
          row_count: number | null
          subject_event: string | null
          subject_member_id: string | null
        }
        Insert: {
          action: string
          actor: string
          actor_role: string
          at?: string
          detail?: Json | null
          id?: string
          route: string
          row_count?: number | null
          subject_event?: string | null
          subject_member_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          actor_role?: string
          at?: string
          detail?: Json | null
          id?: string
          route?: string
          row_count?: number | null
          subject_event?: string | null
          subject_member_id?: string | null
        }
        Relationships: []
      }
      recording_offloads: {
        Row: {
          attempts: number
          error: string | null
          idempotency_key: string | null
          size_bytes: number | null
          source_expires_at: string | null
          source_url: string | null
          status: string
          target_id: string
          target_kind: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          error?: string | null
          idempotency_key?: string | null
          size_bytes?: number | null
          source_expires_at?: string | null
          source_url?: string | null
          status: string
          target_id: string
          target_kind: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          error?: string | null
          idempotency_key?: string | null
          size_bytes?: number | null
          source_expires_at?: string | null
          source_url?: string | null
          status?: string
          target_id?: string
          target_kind?: string
          updated_at?: string
        }
        Relationships: []
      }
      refund_policies: {
        Row: {
          event_slug: string | null
          id: string
          scope: string
          tenant_id: string | null
          tiers: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          event_slug?: string | null
          id?: string
          scope: string
          tenant_id?: string | null
          tiers: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          event_slug?: string | null
          id?: string
          scope?: string
          tenant_id?: string | null
          tiers?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_addons: {
        Row: {
          addon_id: string
          booked_by_member_id: string | null
          booked_by_role: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          checked_at: string | null
          created_at: string
          currency: string
          group_invoice_id: string | null
          group_method: string | null
          id: string
          minor_rule_override: boolean
          order_id: string | null
          paid_at: string | null
          participant_id: string
          payer: string
          quantity: number
          registration_id: string
          status: string
          store_order_item_id: string | null
          tenant_id: string | null
          unit_price_cents: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          addon_id: string
          booked_by_member_id?: string | null
          booked_by_role?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          checked_at?: string | null
          created_at?: string
          currency?: string
          group_invoice_id?: string | null
          group_method?: string | null
          id?: string
          minor_rule_override?: boolean
          order_id?: string | null
          paid_at?: string | null
          participant_id: string
          payer: string
          quantity?: number
          registration_id: string
          status?: string
          store_order_item_id?: string | null
          tenant_id?: string | null
          unit_price_cents: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          addon_id?: string
          booked_by_member_id?: string | null
          booked_by_role?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          checked_at?: string | null
          created_at?: string
          currency?: string
          group_invoice_id?: string | null
          group_method?: string | null
          id?: string
          minor_rule_override?: boolean
          order_id?: string | null
          paid_at?: string | null
          participant_id?: string
          payer?: string
          quantity?: number
          registration_id?: string
          status?: string
          store_order_item_id?: string | null
          tenant_id?: string | null
          unit_price_cents?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registration_addons_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "event_addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_booked_by_member_id_fkey"
            columns: ["booked_by_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_group_invoice_id_fkey"
            columns: ["group_invoice_id"]
            isOneToOne: false
            referencedRelation: "group_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "addon_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_store_order_item_id_fkey"
            columns: ["store_order_item_id"]
            isOneToOne: false
            referencedRelation: "store_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_addons_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "store_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          adult_count: number | null
          amount_due_cents: number | null
          checkout_session_id: string | null
          contact_role: string | null
          created_at: string
          details_method: string
          event_slug: string
          event_title: string
          group_name: string | null
          id: string
          invoice_coupon_id: string | null
          invoice_paid_at: string | null
          invoice_paid_by: string | null
          invoice_promotion_code: string | null
          invoice_requested: boolean
          invoice_sync_due_at: string | null
          invoice_sync_lock_until: string | null
          late_joiner_payer: string | null
          member_pays_individually: boolean
          pay_link_sent_at: string | null
          pay_token: string | null
          proposal_file_name: string | null
          proposal_notes: string | null
          proposal_storage_path: string | null
          proposal_submitted_at: string | null
          registrant_role: string
          school_address_city: string | null
          school_address_state: string | null
          school_address_street: string | null
          school_address_zip: string | null
          school_data_terms_sha256: string | null
          school_data_terms_version: string | null
          school_dpa_agreed_at: string | null
          school_name: string | null
          share_cents: number | null
          share_estimate: number | null
          share_first_paid_at: string | null
          share_settled_at: string | null
          share_unit_cents: number | null
          spreadsheet_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          student_count: number | null
          teacher_email: string | null
          teacher_first_name: string | null
          teacher_last_name: string | null
          teacher_member_id: string | null
          teacher_poc_email: string | null
          teacher_poc_first_name: string | null
          teacher_poc_last_name: string | null
          tenant_id: string | null
          type: string
          updated_at: string
          withdrawn_at: string | null
        }
        Insert: {
          adult_count?: number | null
          amount_due_cents?: number | null
          checkout_session_id?: string | null
          contact_role?: string | null
          created_at?: string
          details_method?: string
          event_slug: string
          event_title: string
          group_name?: string | null
          id?: string
          invoice_coupon_id?: string | null
          invoice_paid_at?: string | null
          invoice_paid_by?: string | null
          invoice_promotion_code?: string | null
          invoice_requested?: boolean
          invoice_sync_due_at?: string | null
          invoice_sync_lock_until?: string | null
          late_joiner_payer?: string | null
          member_pays_individually?: boolean
          pay_link_sent_at?: string | null
          pay_token?: string | null
          proposal_file_name?: string | null
          proposal_notes?: string | null
          proposal_storage_path?: string | null
          proposal_submitted_at?: string | null
          registrant_role?: string
          school_address_city?: string | null
          school_address_state?: string | null
          school_address_street?: string | null
          school_address_zip?: string | null
          school_data_terms_sha256?: string | null
          school_data_terms_version?: string | null
          school_dpa_agreed_at?: string | null
          school_name?: string | null
          share_cents?: number | null
          share_estimate?: number | null
          share_first_paid_at?: string | null
          share_settled_at?: string | null
          share_unit_cents?: number | null
          spreadsheet_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          student_count?: number | null
          teacher_email?: string | null
          teacher_first_name?: string | null
          teacher_last_name?: string | null
          teacher_member_id?: string | null
          teacher_poc_email?: string | null
          teacher_poc_first_name?: string | null
          teacher_poc_last_name?: string | null
          tenant_id?: string | null
          type: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Update: {
          adult_count?: number | null
          amount_due_cents?: number | null
          checkout_session_id?: string | null
          contact_role?: string | null
          created_at?: string
          details_method?: string
          event_slug?: string
          event_title?: string
          group_name?: string | null
          id?: string
          invoice_coupon_id?: string | null
          invoice_paid_at?: string | null
          invoice_paid_by?: string | null
          invoice_promotion_code?: string | null
          invoice_requested?: boolean
          invoice_sync_due_at?: string | null
          invoice_sync_lock_until?: string | null
          late_joiner_payer?: string | null
          member_pays_individually?: boolean
          pay_link_sent_at?: string | null
          pay_token?: string | null
          proposal_file_name?: string | null
          proposal_notes?: string | null
          proposal_storage_path?: string | null
          proposal_submitted_at?: string | null
          registrant_role?: string
          school_address_city?: string | null
          school_address_state?: string | null
          school_address_street?: string | null
          school_address_zip?: string | null
          school_data_terms_sha256?: string | null
          school_data_terms_version?: string | null
          school_dpa_agreed_at?: string | null
          school_name?: string | null
          share_cents?: number | null
          share_estimate?: number | null
          share_first_paid_at?: string | null
          share_settled_at?: string | null
          share_unit_cents?: number | null
          spreadsheet_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          student_count?: number | null
          teacher_email?: string | null
          teacher_first_name?: string | null
          teacher_last_name?: string | null
          teacher_member_id?: string | null
          teacher_poc_email?: string | null
          teacher_poc_first_name?: string | null
          teacher_poc_last_name?: string | null
          tenant_id?: string | null
          type?: string
          updated_at?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_invoice_paid_by_fkey"
            columns: ["invoice_paid_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_teacher_member_id_fkey"
            columns: ["teacher_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scholarship_applications: {
        Row: {
          activity: string | null
          admin_notes: string | null
          brief: string
          cancellation_reason: string | null
          cancellation_source: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_name: string | null
          created_at: string
          email: string
          event_slug: string | null
          event_title: string | null
          first_name: string
          id: string
          last_name: string
          member_id: string | null
          offer_emails_sent_at: string | null
          offer_token: string | null
          offered_at: string | null
          percent_off: number | null
          phone: string | null
          registration_id: string | null
          registration_paid_at_offer: boolean
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          school: string | null
          source: string
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          activity?: string | null
          admin_notes?: string | null
          brief: string
          cancellation_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_name?: string | null
          created_at?: string
          email: string
          event_slug?: string | null
          event_title?: string | null
          first_name: string
          id?: string
          last_name: string
          member_id?: string | null
          offer_emails_sent_at?: string | null
          offer_token?: string | null
          offered_at?: string | null
          percent_off?: number | null
          phone?: string | null
          registration_id?: string | null
          registration_paid_at_offer?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          school?: string | null
          source?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          activity?: string | null
          admin_notes?: string | null
          brief?: string
          cancellation_reason?: string | null
          cancellation_source?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_name?: string | null
          created_at?: string
          email?: string
          event_slug?: string | null
          event_title?: string | null
          first_name?: string
          id?: string
          last_name?: string
          member_id?: string | null
          offer_emails_sent_at?: string | null
          offer_token?: string | null
          offered_at?: string | null
          percent_off?: number | null
          phone?: string | null
          registration_id?: string | null
          registration_paid_at_offer?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          school?: string | null
          source?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scholarship_applications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scholarship_applications_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scholarship_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          postcode: string | null
          school_code: string | null
          state: string | null
          street: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          postcode?: string | null
          school_code?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          postcode?: string | null
          school_code?: string | null
          state?: string | null
          street?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      sent_reminders: {
        Row: {
          bucket: string
          id: string
          kind: string
          member_id: string | null
          ref_id: string
          sent_at: string
        }
        Insert: {
          bucket?: string
          id?: string
          kind: string
          member_id?: string | null
          ref_id: string
          sent_at?: string
        }
        Update: {
          bucket?: string
          id?: string
          kind?: string
          member_id?: string | null
          ref_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sent_reminders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      session_action_templates: {
        Row: {
          created_at: string
          display_order: number
          host_member_id: string | null
          id: string
          session_type: string
          title: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          host_member_id?: string | null
          id?: string
          session_type: string
          title: string
        }
        Update: {
          created_at?: string
          display_order?: number
          host_member_id?: string | null
          id?: string
          session_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_action_templates_host_member_id_fkey"
            columns: ["host_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      session_actions: {
        Row: {
          batch_id: string | null
          cohort_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          display_order: number
          due_date: string | null
          id: string
          is_done: boolean
          member_id: string
          remind_before_hours: number | null
          session_id: string | null
          title: string
          training_module_id: string | null
        }
        Insert: {
          batch_id?: string | null
          cohort_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          due_date?: string | null
          id?: string
          is_done?: boolean
          member_id: string
          remind_before_hours?: number | null
          session_id?: string | null
          title: string
          training_module_id?: string | null
        }
        Update: {
          batch_id?: string | null
          cohort_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          display_order?: number
          due_date?: string | null
          id?: string
          is_done?: boolean
          member_id?: string
          remind_before_hours?: number | null
          session_id?: string | null
          title?: string
          training_module_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_actions_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_actions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_actions_training_module_id_fkey"
            columns: ["training_module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      session_hosts: {
        Row: {
          approved_at: string
          approved_by: string | null
          bio: string | null
          can_coach: boolean
          can_mentor: boolean
          member_id: string
        }
        Insert: {
          approved_at?: string
          approved_by?: string | null
          bio?: string | null
          can_coach?: boolean
          can_mentor?: boolean
          member_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string | null
          bio?: string | null
          can_coach?: boolean
          can_mentor?: boolean
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_hosts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_hosts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      session_participants: {
        Row: {
          member_id: string
          session_id: string
        }
        Insert: {
          member_id: string
          session_id: string
        }
        Update: {
          member_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          cohort_id: string | null
          created_at: string
          created_by: string | null
          host_member_id: string | null
          host_notes: string | null
          id: string
          is_paid_extra: boolean
          join_url: string | null
          member_id: string | null
          provider: string | null
          provider_room: string | null
          recording_path: string | null
          recording_status: string
          scheduled_end: string | null
          scheduled_start: string
          session_type: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          cohort_id?: string | null
          created_at?: string
          created_by?: string | null
          host_member_id?: string | null
          host_notes?: string | null
          id?: string
          is_paid_extra?: boolean
          join_url?: string | null
          member_id?: string | null
          provider?: string | null
          provider_room?: string | null
          recording_path?: string | null
          recording_status?: string
          scheduled_end?: string | null
          scheduled_start: string
          session_type: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          cohort_id?: string | null
          created_at?: string
          created_by?: string | null
          host_member_id?: string | null
          host_notes?: string | null
          id?: string
          is_paid_extra?: boolean
          join_url?: string | null
          member_id?: string | null
          provider?: string | null
          provider_room?: string | null
          recording_path?: string | null
          recording_status?: string
          scheduled_end?: string | null
          scheduled_start?: string
          session_type?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "mentoring_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_host_member_id_fkey"
            columns: ["host_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_watch_channels: {
        Row: {
          channel_id: string
          created_at: string | null
          expiration: string | null
          id: string
          registration_id: string
          resource_id: string | null
          token: string | null
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          expiration?: string | null
          id?: string
          registration_id: string
          resource_id?: string | null
          token?: string | null
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          expiration?: string | null
          id?: string
          registration_id?: string
          resource_id?: string | null
          token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_watch_channels_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_grants: {
        Row: {
          activated_at: string | null
          agreement_id: string | null
          clerk_user_id: string | null
          created_at: string
          ended_at: string | null
          ended_by: string | null
          ended_reason: string | null
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          granted_by_label: string | null
          id: string
          member_id: string
          missing: string[]
          reminded_at: string | null
          status: string
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          agreement_id?: string | null
          clerk_user_id?: string | null
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          ended_reason?: string | null
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          granted_by_label?: string | null
          id?: string
          member_id: string
          missing?: string[]
          reminded_at?: string | null
          status?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          agreement_id?: string | null
          clerk_user_id?: string | null
          created_at?: string
          ended_at?: string | null
          ended_by?: string | null
          ended_reason?: string | null
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          granted_by_label?: string | null
          id?: string
          member_id?: string
          missing?: string[]
          reminded_at?: string | null
          status?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_grants_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_grants_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "docusign_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_grants_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_grants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_role_settings: {
        Row: {
          id: boolean
          training_module_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          training_module_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          training_module_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_role_settings_training_module_id_fkey"
            columns: ["training_module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_role_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      store_event_discounts: {
        Row: {
          category: string | null
          event_slug: string | null
          id: string
          percent_off: number
          product_id: string | null
          scope: string
          tenant_id: string | null
        }
        Insert: {
          category?: string | null
          event_slug?: string | null
          id?: string
          percent_off: number
          product_id?: string | null
          scope?: string
          tenant_id?: string | null
        }
        Update: {
          category?: string | null
          event_slug?: string | null
          id?: string
          percent_off?: number
          product_id?: string | null
          scope?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_event_discounts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_event_discounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_order_items: {
        Row: {
          batch_id: string | null
          created_at: string
          fulfillment_mode: string
          fulfillment_status: string
          id: string
          line_source: string
          name: string | null
          order_id: string
          participant_member_id: string | null
          qty: number
          sku: string | null
          tenant_id: string | null
          unit_amount_cents: number
          variant_id: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          fulfillment_mode?: string
          fulfillment_status?: string
          id?: string
          line_source?: string
          name?: string | null
          order_id: string
          participant_member_id?: string | null
          qty?: number
          sku?: string | null
          tenant_id?: string | null
          unit_amount_cents?: number
          variant_id?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          fulfillment_mode?: string
          fulfillment_status?: string
          id?: string
          line_source?: string
          name?: string | null
          order_id?: string
          participant_member_id?: string | null
          qty?: number
          sku?: string | null
          tenant_id?: string | null
          unit_amount_cents?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "merch_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "store_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_items_participant_member_id_fkey"
            columns: ["participant_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "store_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_orders: {
        Row: {
          channel: string
          created_at: string
          discount_cents: number
          email: string
          event_slug: string | null
          id: string
          member_id: string | null
          pod_order_id: string | null
          registration_id: string | null
          ship_to: Json | null
          shipping_cents: number
          source_order_id: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number
          tax_cents: number
          tenant_id: string | null
          total_cents: number
          tracking_url: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          discount_cents?: number
          email: string
          event_slug?: string | null
          id?: string
          member_id?: string | null
          pod_order_id?: string | null
          registration_id?: string | null
          ship_to?: Json | null
          shipping_cents?: number
          source_order_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          tenant_id?: string | null
          total_cents?: number
          tracking_url?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          discount_cents?: number
          email?: string
          event_slug?: string | null
          id?: string
          member_id?: string | null
          pod_order_id?: string | null
          registration_id?: string | null
          ship_to?: Json | null
          shipping_cents?: number
          source_order_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          tenant_id?: string | null
          total_cents?: number
          tracking_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "store_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_products: {
        Row: {
          created_at: string
          description: string | null
          featured: boolean
          id: string
          images: Json
          is_event_shirt: boolean
          name: string
          pod_provider: string
          pod_sync_product_id: string | null
          product_type: string
          slug: string
          status: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          images?: Json
          is_event_shirt?: boolean
          name: string
          pod_provider?: string
          pod_sync_product_id?: string | null
          product_type?: string
          slug: string
          status?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          images?: Json
          is_event_shirt?: boolean
          name?: string
          pod_provider?: string
          pod_sync_product_id?: string | null
          product_type?: string
          slug?: string
          status?: string
        }
        Relationships: []
      }
      store_returns: {
        Row: {
          created_at: string
          id: string
          member_id: string | null
          order_id: string
          reason: string | null
          status: string
          stripe_refund_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          member_id?: string | null
          order_id: string
          reason?: string | null
          status?: string
          stripe_refund_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string | null
          order_id?: string
          reason?: string | null
          status?: string
          stripe_refund_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_returns_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "store_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_tier_discounts: {
        Row: {
          category: string | null
          id: string
          percent_off: number
          product_id: string | null
          scope: string
          tier_id: string
        }
        Insert: {
          category?: string | null
          id?: string
          percent_off: number
          product_id?: string | null
          scope?: string
          tier_id: string
        }
        Update: {
          category?: string | null
          id?: string
          percent_off?: number
          product_id?: string | null
          scope?: string
          tier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_tier_discounts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_tier_discounts_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      store_variants: {
        Row: {
          active: boolean
          id: string
          inventory_qty: number | null
          label: string | null
          market_price_cents: number
          options: Json
          pod_sync_variant_id: string | null
          product_id: string
          sku: string
        }
        Insert: {
          active?: boolean
          id?: string
          inventory_qty?: number | null
          label?: string | null
          market_price_cents?: number
          options?: Json
          pod_sync_variant_id?: string | null
          product_id: string
          sku: string
        }
        Update: {
          active?: boolean
          id?: string
          inventory_qty?: number | null
          label?: string | null
          market_price_cents?: number
          options?: Json
          pod_sync_variant_id?: string | null
          product_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          id: string
          received_at: string
          type: string
        }
        Insert: {
          id: string
          received_at?: string
          type: string
        }
        Update: {
          id?: string
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      support_consents: {
        Row: {
          approved_at: string | null
          decided_by_clerk_user_id: string | null
          declined_at: string | null
          expires_at: string
          id: string
          platform_admin_user_id: string
          reason: string
          requested_at: string
          tenant_id: string
          used_at: string | null
          withdrawn_at: string | null
        }
        Insert: {
          approved_at?: string | null
          decided_by_clerk_user_id?: string | null
          declined_at?: string | null
          expires_at: string
          id?: string
          platform_admin_user_id: string
          reason: string
          requested_at?: string
          tenant_id: string
          used_at?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          approved_at?: string | null
          decided_by_clerk_user_id?: string | null
          declined_at?: string | null
          expires_at?: string
          id?: string
          platform_admin_user_id?: string
          reason?: string
          requested_at?: string
          tenant_id?: string
          used_at?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_consents_platform_admin_user_id_fkey"
            columns: ["platform_admin_user_id"]
            isOneToOne: false
            referencedRelation: "platform_admins"
            referencedColumns: ["clerk_user_id"]
          },
          {
            foreignKeyName: "support_consents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_sessions: {
        Row: {
          closed_at: string | null
          consent_id: string | null
          ends_at: string
          id: string
          mode: string
          opened_at: string
          platform_admin_user_id: string
          reason: string
          renewal_reason: string | null
          renewed_at: string | null
          tenant_id: string
        }
        Insert: {
          closed_at?: string | null
          consent_id?: string | null
          ends_at: string
          id?: string
          mode?: string
          opened_at?: string
          platform_admin_user_id: string
          reason: string
          renewal_reason?: string | null
          renewed_at?: string | null
          tenant_id: string
        }
        Update: {
          closed_at?: string | null
          consent_id?: string | null
          ends_at?: string
          id?: string
          mode?: string
          opened_at?: string
          platform_admin_user_id?: string
          reason?: string
          renewal_reason?: string | null
          renewed_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_sessions_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "support_consents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_sessions_platform_admin_user_id_fkey"
            columns: ["platform_admin_user_id"]
            isOneToOne: false
            referencedRelation: "platform_admins"
            referencedColumns: ["clerk_user_id"]
          },
          {
            foreignKeyName: "support_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_access_log: {
        Row: {
          action: string
          actor: string
          at: string
          detail: Json | null
          distribution_id: string | null
          event_slug: string | null
          id: string
          response_id: string | null
          row_count: number | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor: string
          at?: string
          detail?: Json | null
          distribution_id?: string | null
          event_slug?: string | null
          id?: string
          response_id?: string | null
          row_count?: number | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          at?: string
          detail?: Json | null
          distribution_id?: string | null
          event_slug?: string | null
          id?: string
          response_id?: string | null
          row_count?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_access_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_answers: {
        Row: {
          created_at: string
          question_key: string
          response_id: string
          tenant_id: string | null
          value_numeric: number | null
          value_options: string[] | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          question_key: string
          response_id: string
          tenant_id?: string | null
          value_numeric?: number | null
          value_options?: string[] | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          question_key?: string
          response_id?: string
          tenant_id?: string | null
          value_numeric?: number | null
          value_options?: string[] | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_answers_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_answers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_definitions: {
        Row: {
          created_at: string
          definition: Json
          definition_sha256: string
          id: string
          key: string
          published_at: string | null
          published_by: string | null
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          definition: Json
          definition_sha256: string
          id?: string
          key: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          title: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          definition?: Json
          definition_sha256?: string
          id?: string
          key?: string
          published_at?: string | null
          published_by?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      survey_distributions: {
        Row: {
          audiences: string[]
          closed_at: string | null
          closed_by: string | null
          closes_at: string
          created_at: string
          created_by: string | null
          definition_id: string
          event_date: string
          event_slug: string
          event_time_zone: string
          event_title: string | null
          gate_certificate: boolean
          id: string
          last_run_at: string | null
          minor_agreement_override: boolean
          minor_agreement_override_set_at: string | null
          minor_agreement_override_set_by: string | null
          opened_at: string | null
          opened_by: string | null
          opened_by_label: string | null
          opens_at: string
          opens_at_set_at: string | null
          opens_at_source: string
          paused_at: string | null
          schedule_flag: string | null
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          audiences?: string[]
          closed_at?: string | null
          closed_by?: string | null
          closes_at: string
          created_at?: string
          created_by?: string | null
          definition_id: string
          event_date: string
          event_slug: string
          event_time_zone: string
          event_title?: string | null
          gate_certificate?: boolean
          id?: string
          last_run_at?: string | null
          minor_agreement_override?: boolean
          minor_agreement_override_set_at?: string | null
          minor_agreement_override_set_by?: string | null
          opened_at?: string | null
          opened_by?: string | null
          opened_by_label?: string | null
          opens_at: string
          opens_at_set_at?: string | null
          opens_at_source?: string
          paused_at?: string | null
          schedule_flag?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          audiences?: string[]
          closed_at?: string | null
          closed_by?: string | null
          closes_at?: string
          created_at?: string
          created_by?: string | null
          definition_id?: string
          event_date?: string
          event_slug?: string
          event_time_zone?: string
          event_title?: string | null
          gate_certificate?: boolean
          id?: string
          last_run_at?: string | null
          minor_agreement_override?: boolean
          minor_agreement_override_set_at?: string | null
          minor_agreement_override_set_by?: string | null
          opened_at?: string | null
          opened_by?: string | null
          opened_by_label?: string | null
          opens_at?: string
          opens_at_set_at?: string | null
          opens_at_source?: string
          paused_at?: string | null
          schedule_flag?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_distributions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_distributions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "survey_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_distributions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_distributions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_email_budget: {
        Row: {
          day: string
          sent: number
        }
        Insert: {
          day: string
          sent?: number
        }
        Update: {
          day?: string
          sent?: number
        }
        Relationships: []
      }
      survey_invitations: {
        Row: {
          adult_relationship: string | null
          created_at: string
          distribution_id: string
          email: string
          first_name: string | null
          first_opened_at: string | null
          id: string
          is_minor: boolean
          last_activity_at: string | null
          last_reminder_at: string | null
          last_send_error: string | null
          member_id: string | null
          opened_from: string | null
          participant_id: string | null
          recipient_key: string
          reminder_count: number
          reminders_opted_out_at: string | null
          respondent_role: string
          resume_reminder_count: number
          send_attempts: number
          send_via: string
          sent_at: string | null
          status: string
          tenant_id: string | null
          token_hash: string
          token_version: number
          updated_at: string
        }
        Insert: {
          adult_relationship?: string | null
          created_at?: string
          distribution_id: string
          email: string
          first_name?: string | null
          first_opened_at?: string | null
          id?: string
          is_minor?: boolean
          last_activity_at?: string | null
          last_reminder_at?: string | null
          last_send_error?: string | null
          member_id?: string | null
          opened_from?: string | null
          participant_id?: string | null
          recipient_key: string
          reminder_count?: number
          reminders_opted_out_at?: string | null
          respondent_role: string
          resume_reminder_count?: number
          send_attempts?: number
          send_via?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string | null
          token_hash: string
          token_version?: number
          updated_at?: string
        }
        Update: {
          adult_relationship?: string | null
          created_at?: string
          distribution_id?: string
          email?: string
          first_name?: string | null
          first_opened_at?: string | null
          id?: string
          is_minor?: boolean
          last_activity_at?: string | null
          last_reminder_at?: string | null
          last_send_error?: string | null
          member_id?: string | null
          opened_from?: string | null
          participant_id?: string | null
          recipient_key?: string
          reminder_count?: number
          reminders_opted_out_at?: string | null
          respondent_role?: string
          resume_reminder_count?: number
          send_attempts?: number
          send_via?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string | null
          token_hash?: string
          token_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_invitations_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "survey_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_invitations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_invitations_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_question_catalog: {
        Row: {
          first_version: number | null
          label: string
          last_version: number | null
          options: Json | null
          question_key: string
          source: string
          survey_key: string | null
          type: string
          updated_at: string
        }
        Insert: {
          first_version?: number | null
          label: string
          last_version?: number | null
          options?: Json | null
          question_key: string
          source?: string
          survey_key?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          first_version?: number | null
          label?: string
          last_version?: number | null
          options?: Json | null
          question_key?: string
          source?: string
          survey_key?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      survey_responses: {
        Row: {
          context: Json
          created_at: string
          current_page: string | null
          definition_id: string
          distribution_id: string | null
          draft_answers: Json
          event_slug: string | null
          event_year: number | null
          followup_consent: boolean | null
          id: string
          invitation_id: string | null
          is_minor_at_submit: boolean | null
          last_saved_at: string | null
          legacy_ref: string | null
          member_id: string | null
          no_quote: boolean | null
          participant_id: string | null
          quote_consent: string | null
          quote_withdrawn_at: string | null
          quote_withdrawn_by: string | null
          respondent_role: string | null
          source: string
          started_at: string | null
          submitted_at: string | null
          submitted_from: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          context?: Json
          created_at?: string
          current_page?: string | null
          definition_id: string
          distribution_id?: string | null
          draft_answers?: Json
          event_slug?: string | null
          event_year?: number | null
          followup_consent?: boolean | null
          id?: string
          invitation_id?: string | null
          is_minor_at_submit?: boolean | null
          last_saved_at?: string | null
          legacy_ref?: string | null
          member_id?: string | null
          no_quote?: boolean | null
          participant_id?: string | null
          quote_consent?: string | null
          quote_withdrawn_at?: string | null
          quote_withdrawn_by?: string | null
          respondent_role?: string | null
          source?: string
          started_at?: string | null
          submitted_at?: string | null
          submitted_from?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          context?: Json
          created_at?: string
          current_page?: string | null
          definition_id?: string
          distribution_id?: string | null
          draft_answers?: Json
          event_slug?: string | null
          event_year?: number | null
          followup_consent?: boolean | null
          id?: string
          invitation_id?: string | null
          is_minor_at_submit?: boolean | null
          last_saved_at?: string | null
          legacy_ref?: string | null
          member_id?: string | null
          no_quote?: boolean | null
          participant_id?: string | null
          quote_consent?: string | null
          quote_withdrawn_at?: string | null
          quote_withdrawn_by?: string | null
          respondent_role?: string | null
          source?: string
          started_at?: string | null
          submitted_at?: string | null
          submitted_from?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "survey_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_distribution_id_fkey"
            columns: ["distribution_id"]
            isOneToOne: false
            referencedRelation: "survey_distributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: true
            referencedRelation: "survey_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      team_profiles: {
        Row: {
          answers: Json
          created_at: string
          definition_version: number
          event_slug: string
          first_sent_at: string | null
          id: string
          last_send_error: string | null
          last_sent_at: string | null
          member_id: string | null
          participant_id: string | null
          prefilled_from: string | null
          send_count: number
          submitted_at: string | null
          tenant_id: string | null
          token_hash: string
          token_version: number
          updated_at: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          definition_version?: number
          event_slug: string
          first_sent_at?: string | null
          id?: string
          last_send_error?: string | null
          last_sent_at?: string | null
          member_id?: string | null
          participant_id?: string | null
          prefilled_from?: string | null
          send_count?: number
          submitted_at?: string | null
          tenant_id?: string | null
          token_hash: string
          token_version?: number
          updated_at?: string
        }
        Update: {
          answers?: Json
          created_at?: string
          definition_version?: number
          event_slug?: string
          first_sent_at?: string | null
          id?: string
          last_send_error?: string | null
          last_sent_at?: string | null
          member_id?: string | null
          participant_id?: string | null
          prefilled_from?: string | null
          send_count?: number
          submitted_at?: string | null
          tenant_id?: string | null
          token_hash?: string
          token_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_profiles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_profiles_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_profiles_prefilled_from_fkey"
            columns: ["prefilled_from"]
            isOneToOne: false
            referencedRelation: "team_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenancy_derivation_log: {
        Row: {
          count: number
          day: string
          first_seen: string
          id: number
          last_seen: string
          reason: string
          sample_key: string | null
          sqlstate: string | null
          table_name: string
        }
        Insert: {
          count?: number
          day?: string
          first_seen?: string
          id?: never
          last_seen?: string
          reason: string
          sample_key?: string | null
          sqlstate?: string | null
          table_name: string
        }
        Update: {
          count?: number
          day?: string
          first_seen?: string
          id?: never
          last_seen?: string
          reason?: string
          sample_key?: string | null
          sqlstate?: string | null
          table_name?: string
        }
        Relationships: []
      }
      tenancy_settings: {
        Row: {
          derivation_mode: string
          expand_applied_at: string | null
          id: boolean
          note: string | null
          tenants_ready_at: string | null
          tenants_ready_note: string | null
          updated_at: string
        }
        Insert: {
          derivation_mode?: string
          expand_applied_at?: string | null
          id?: boolean
          note?: string | null
          tenants_ready_at?: string | null
          tenants_ready_note?: string | null
          updated_at?: string
        }
        Update: {
          derivation_mode?: string
          expand_applied_at?: string | null
          id?: boolean
          note?: string | null
          tenants_ready_at?: string | null
          tenants_ready_note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tenant_data_keys: {
        Row: {
          created_at: string
          id: string
          key_id: string
          master_key_id: string
          retired_at: string | null
          tenant_id: string
          wrapped_dek: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_id: string
          master_key_id: string
          retired_at?: string | null
          tenant_id: string
          wrapped_dek: string
        }
        Update: {
          created_at?: string
          id?: string
          key_id?: string
          master_key_id?: string
          retired_at?: string | null
          tenant_id?: string
          wrapped_dek?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_data_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains: {
        Row: {
          created_at: string
          host: string
          is_primary: boolean
          tenant_id: string
        }
        Insert: {
          created_at?: string
          host: string
          is_primary?: boolean
          tenant_id: string
        }
        Update: {
          created_at?: string
          host?: string
          is_primary?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_email_settings: {
        Row: {
          domain_checked_at: string | null
          domain_status: string
          forge_status: string
          from_local_part: string
          from_name: string | null
          logo_url: string | null
          marketing_daily_cap: number | null
          marketing_monthly_cap: number | null
          marketing_paused_at: string | null
          paused_reason: string | null
          reply_to: string | null
          resend_domain_id: string | null
          sending_domain: string | null
          signature_html: string | null
          signature_text: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          domain_checked_at?: string | null
          domain_status?: string
          forge_status?: string
          from_local_part?: string
          from_name?: string | null
          logo_url?: string | null
          marketing_daily_cap?: number | null
          marketing_monthly_cap?: number | null
          marketing_paused_at?: string | null
          paused_reason?: string | null
          reply_to?: string | null
          resend_domain_id?: string | null
          sending_domain?: string | null
          signature_html?: string | null
          signature_text?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          domain_checked_at?: string | null
          domain_status?: string
          forge_status?: string
          from_local_part?: string
          from_name?: string | null
          logo_url?: string | null
          marketing_daily_cap?: number | null
          marketing_monthly_cap?: number | null
          marketing_paused_at?: string | null
          paused_reason?: string | null
          reply_to?: string | null
          resend_domain_id?: string | null
          sending_domain?: string | null
          signature_html?: string | null
          signature_text?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_email_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_feature_flags: {
        Row: {
          enabled: boolean
          flag: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled: boolean
          flag: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          flag?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_feature_flags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_guardian_consents: {
        Row: {
          agreement_id: string | null
          escalated_at: string | null
          expires_at: string
          id: string
          next_attempt_at: string | null
          participant_id: string
          registration_id: string
          removal_attempts: number
          requested_at: string
          settled_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          agreement_id?: string | null
          escalated_at?: string | null
          expires_at: string
          id?: string
          next_attempt_at?: string | null
          participant_id: string
          registration_id: string
          removal_attempts?: number
          requested_at?: string
          settled_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          agreement_id?: string | null
          escalated_at?: string | null
          expires_at?: string
          id?: string
          next_attempt_at?: string | null
          participant_id?: string
          registration_id?: string
          removal_attempts?: number
          requested_at?: string
          settled_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_guardian_consents_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_guardian_consents_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "docusign_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_guardian_consents_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: true
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_guardian_consents_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_guardian_consents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          clerk_user_id: string | null
          created_at: string
          id: string
          member_id: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          source: string
          tenant_id: string
        }
        Insert: {
          clerk_user_id?: string | null
          created_at?: string
          id?: string
          member_id?: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          source?: string
          tenant_id: string
        }
        Update: {
          clerk_user_id?: string | null
          created_at?: string
          id?: string
          member_id?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          abn: string | null
          branding: Json
          country: string
          created_at: string
          currency: string
          display_name: string
          ein: string | null
          gst_registered: boolean
          id: string
          is_platform_owner: boolean
          legal_name: string
          min_participant_age: number
          payment_region: string
          slug: string
          status: string
          time_zone: string
        }
        Insert: {
          abn?: string | null
          branding?: Json
          country: string
          created_at?: string
          currency: string
          display_name: string
          ein?: string | null
          gst_registered?: boolean
          id?: string
          is_platform_owner?: boolean
          legal_name: string
          min_participant_age?: number
          payment_region: string
          slug: string
          status?: string
          time_zone: string
        }
        Update: {
          abn?: string | null
          branding?: Json
          country?: string
          created_at?: string
          currency?: string
          display_name?: string
          ein?: string | null
          gst_registered?: boolean
          id?: string
          is_platform_owner?: boolean
          legal_name?: string
          min_participant_age?: number
          payment_region?: string
          slug?: string
          status?: string
          time_zone?: string
        }
        Relationships: []
      }
      tier_grant_rules: {
        Row: {
          conditions: Json
          created_at: string
          created_by: string | null
          duration_kind: string
          duration_months: number | null
          duration_until: string | null
          grant_credit_type: string | null
          grant_kind: string
          grant_object_ref: string | null
          grant_object_type: string | null
          grant_quantity: number | null
          grant_role: string | null
          grant_target: string
          grant_tier_id: string | null
          id: string
          is_active: boolean
          is_dynamic: boolean
          name: string
          object_anchor_ref: string | null
          object_type: string | null
          priority: number
          replaces_free: boolean
          tier_min: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          conditions?: Json
          created_at?: string
          created_by?: string | null
          duration_kind?: string
          duration_months?: number | null
          duration_until?: string | null
          grant_credit_type?: string | null
          grant_kind?: string
          grant_object_ref?: string | null
          grant_object_type?: string | null
          grant_quantity?: number | null
          grant_role?: string | null
          grant_target?: string
          grant_tier_id?: string | null
          id?: string
          is_active?: boolean
          is_dynamic?: boolean
          name: string
          object_anchor_ref?: string | null
          object_type?: string | null
          priority?: number
          replaces_free?: boolean
          tier_min?: string | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          conditions?: Json
          created_at?: string
          created_by?: string | null
          duration_kind?: string
          duration_months?: number | null
          duration_until?: string | null
          grant_credit_type?: string | null
          grant_kind?: string
          grant_object_ref?: string | null
          grant_object_type?: string | null
          grant_quantity?: number | null
          grant_role?: string | null
          grant_target?: string
          grant_tier_id?: string | null
          id?: string
          is_active?: boolean
          is_dynamic?: boolean
          name?: string
          object_anchor_ref?: string | null
          object_type?: string | null
          priority?: number
          replaces_free?: boolean
          tier_min?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_grant_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_grant_rules_grant_tier_id_fkey"
            columns: ["grant_tier_id"]
            isOneToOne: false
            referencedRelation: "membership_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      training_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          due_at: string | null
          event_ref: string
          event_role: string
          id: string
          is_mandatory: boolean
          module_id: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          event_ref: string
          event_role: string
          id?: string
          is_mandatory?: boolean
          module_id: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          event_ref?: string
          event_role?: string
          id?: string
          is_mandatory?: boolean
          module_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      training_certificates: {
        Row: {
          cert_number: string
          id: string
          issued_at: string
          issuer: string
          member_id: string
          module_id: string
        }
        Insert: {
          cert_number: string
          id?: string
          issued_at?: string
          issuer?: string
          member_id: string
          module_id: string
        }
        Update: {
          cert_number?: string
          id?: string
          issued_at?: string
          issuer?: string
          member_id?: string
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_certificates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_certificates_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      training_enrollments: {
        Row: {
          enrolled_at: string
          id: string
          member_id: string
          module_id: string
        }
        Insert: {
          enrolled_at?: string
          id?: string
          member_id: string
          module_id: string
        }
        Update: {
          enrolled_at?: string
          id?: string
          member_id?: string
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_enrollments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_enrollments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      training_item_resources: {
        Row: {
          created_at: string
          display_order: number
          external_url: string | null
          id: string
          item_id: string
          kind: string
          storage_path: string | null
          title: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          external_url?: string | null
          id?: string
          item_id: string
          kind: string
          storage_path?: string | null
          title: string
        }
        Update: {
          created_at?: string
          display_order?: number
          external_url?: string | null
          id?: string
          item_id?: string
          kind?: string
          storage_path?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_item_resources_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "training_items"
            referencedColumns: ["id"]
          },
        ]
      }
      training_items: {
        Row: {
          body: string | null
          content_kind: string
          created_at: string
          display_order: number
          estimated_minutes: number | null
          external_url: string | null
          id: string
          interactive_key: string | null
          module_id: string
          recording_path: string | null
          recording_status: string
          section_id: string | null
          status: string
          storage_path: string | null
          title: string
        }
        Insert: {
          body?: string | null
          content_kind: string
          created_at?: string
          display_order?: number
          estimated_minutes?: number | null
          external_url?: string | null
          id?: string
          interactive_key?: string | null
          module_id: string
          recording_path?: string | null
          recording_status?: string
          section_id?: string | null
          status?: string
          storage_path?: string | null
          title: string
        }
        Update: {
          body?: string | null
          content_kind?: string
          created_at?: string
          display_order?: number
          estimated_minutes?: number | null
          external_url?: string | null
          id?: string
          interactive_key?: string | null
          module_id?: string
          recording_path?: string | null
          recording_status?: string
          section_id?: string | null
          status?: string
          storage_path?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_items_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "training_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      training_modules: {
        Row: {
          cert_template_path: string | null
          course_type: string
          created_at: string
          created_by: string | null
          credential_criteria: string | null
          credential_description: string | null
          credential_skills: string[]
          credential_title: string | null
          description: string | null
          display_order: number
          escalate_supervisor: boolean
          event_ref: string | null
          id: string
          is_published: boolean
          material_kind: string
          min_tier_rank: number
          remind_1d: boolean
          remind_1wk: boolean
          remind_2d: boolean
          remind_2wk: boolean
          remind_email: boolean
          remind_inapp: boolean
          remind_sms: boolean
          start_date: string | null
          tenant_id: string | null
          theme: string | null
          title: string
          updated_at: string
        }
        Insert: {
          cert_template_path?: string | null
          course_type?: string
          created_at?: string
          created_by?: string | null
          credential_criteria?: string | null
          credential_description?: string | null
          credential_skills?: string[]
          credential_title?: string | null
          description?: string | null
          display_order?: number
          escalate_supervisor?: boolean
          event_ref?: string | null
          id?: string
          is_published?: boolean
          material_kind?: string
          min_tier_rank?: number
          remind_1d?: boolean
          remind_1wk?: boolean
          remind_2d?: boolean
          remind_2wk?: boolean
          remind_email?: boolean
          remind_inapp?: boolean
          remind_sms?: boolean
          start_date?: string | null
          tenant_id?: string | null
          theme?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          cert_template_path?: string | null
          course_type?: string
          created_at?: string
          created_by?: string | null
          credential_criteria?: string | null
          credential_description?: string | null
          credential_skills?: string[]
          credential_title?: string | null
          description?: string | null
          display_order?: number
          escalate_supervisor?: boolean
          event_ref?: string | null
          id?: string
          is_published?: boolean
          material_kind?: string
          min_tier_rank?: number
          remind_1d?: boolean
          remind_1wk?: boolean
          remind_2d?: boolean
          remind_2wk?: boolean
          remind_email?: boolean
          remind_inapp?: boolean
          remind_sms?: boolean
          start_date?: string | null
          tenant_id?: string | null
          theme?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_modules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_modules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      training_progress: {
        Row: {
          completed_at: string | null
          id: string
          item_id: string
          member_id: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          item_id: string
          member_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          item_id?: string
          member_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_progress_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "training_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_progress_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sections: {
        Row: {
          created_at: string
          display_order: number
          drip_days: number
          id: string
          module_id: string
          title: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          drip_days?: number
          id?: string
          module_id: string
          title: string
        }
        Update: {
          created_at?: string
          display_order?: number
          drip_days?: number
          id?: string
          module_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_sections_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_daily: {
        Row: {
          day: string
          kind: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          day: string
          kind: string
          tenant_id: string
          total: number
          updated_at?: string
        }
        Update: {
          day?: string
          kind?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_daily_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          count: number
          id: number
          kind: string
          occurred_at: string
          tenant_id: string
        }
        Insert: {
          count?: number
          id?: number
          kind: string
          occurred_at?: string
          tenant_id: string
        }
        Update: {
          count?: number
          id?: number
          kind?: string
          occurred_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      video_watermark_jobs: {
        Row: {
          attempts: number
          bucket: string
          created_at: string
          id: string
          kind: string
          last_error: string | null
          status: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          bucket: string
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          status?: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          bucket?: string
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: []
      }
      volunteer_event_interest: {
        Row: {
          created_at: string
          event_slug: string
          event_title: string
          id: string
          member_id: string
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_slug: string
          event_title: string
          id?: string
          member_id: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_slug?: string
          event_title?: string
          id?: string
          member_id?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_event_interest_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_event_interest_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      access_redundancy_audit: {
        Row: {
          manager_role: string | null
          manager_source: string | null
          member_id: string | null
          object_id: string | null
          object_type: string | null
          roster_role: string | null
        }
        Relationships: []
      }
      docusign_envelope_recipients: {
        Row: {
          attested_at: string | null
          consented_at: string | null
          created_at: string | null
          declined_at: string | null
          declined_reason: string | null
          delivered_at: string | null
          disclosure_version: string | null
          email: string | null
          envelope_row: string | null
          failed_token_attempts: number | null
          id: string | null
          invite_attempts: number | null
          invite_email_id: string | null
          invite_error: string | null
          invite_sent_at: string | null
          last_synced_at: string | null
          member_id: string | null
          name: string | null
          recipient_id: string | null
          role_name: string | null
          routing_order: number | null
          signature_image_path: string | null
          signature_kind: string | null
          signature_text: string | null
          signed_at: string | null
          signed_ip: string | null
          signed_user_agent: string | null
          signer_values: Json | null
          status: string | null
          token_expires_at: string | null
          token_version: number | null
          viewed_at: string | null
        }
        Insert: {
          attested_at?: string | null
          consented_at?: string | null
          created_at?: string | null
          declined_at?: string | null
          declined_reason?: string | null
          delivered_at?: string | null
          disclosure_version?: string | null
          email?: string | null
          envelope_row?: string | null
          failed_token_attempts?: number | null
          id?: string | null
          invite_attempts?: number | null
          invite_email_id?: string | null
          invite_error?: string | null
          invite_sent_at?: string | null
          last_synced_at?: string | null
          member_id?: string | null
          name?: string | null
          recipient_id?: string | null
          role_name?: string | null
          routing_order?: number | null
          signature_image_path?: string | null
          signature_kind?: string | null
          signature_text?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_user_agent?: string | null
          signer_values?: Json | null
          status?: string | null
          token_expires_at?: string | null
          token_version?: number | null
          viewed_at?: string | null
        }
        Update: {
          attested_at?: string | null
          consented_at?: string | null
          created_at?: string | null
          declined_at?: string | null
          declined_reason?: string | null
          delivered_at?: string | null
          disclosure_version?: string | null
          email?: string | null
          envelope_row?: string | null
          failed_token_attempts?: number | null
          id?: string | null
          invite_attempts?: number | null
          invite_email_id?: string | null
          invite_error?: string | null
          invite_sent_at?: string | null
          last_synced_at?: string | null
          member_id?: string | null
          name?: string | null
          recipient_id?: string | null
          role_name?: string | null
          routing_order?: number | null
          signature_image_path?: string | null
          signature_kind?: string | null
          signature_text?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_user_agent?: string | null
          signer_values?: Json | null
          status?: string | null
          token_expires_at?: string | null
          token_version?: number | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docusign_envelope_recipients_envelope_row_fkey"
            columns: ["envelope_row"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelope_recipients_envelope_row_fkey"
            columns: ["envelope_row"]
            isOneToOne: false
            referencedRelation: "docusign_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelope_recipients_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      docusign_envelopes: {
        Row: {
          archive_attempts: number | null
          archive_error: string | null
          archived_at: string | null
          certificate_bytes: number | null
          certificate_path: string | null
          completed_at: string | null
          completion_notified_at: string | null
          created_at: string | null
          credential_sharing_opt_out: boolean | null
          declined_at: string | null
          envelope_id: string | null
          envelope_type: string | null
          event_slug: string | null
          event_title: string | null
          form_data_read_at: string | null
          id: string | null
          issue_error: string | null
          last_manual_resend_at: string | null
          member_id: string | null
          minor_name: string | null
          participant_id: string | null
          prefill: Json | null
          provider: string | null
          reminder_count: number | null
          reminder_sent_at: string | null
          replicated_at: string | null
          restricted_at: string | null
          retain_until: string | null
          reused_from: string | null
          seal_kind: string | null
          sealed_at: string | null
          sent_at: string | null
          signed_pdf_bytes: number | null
          signed_pdf_path: string | null
          signed_pdf_sha256: string | null
          signer_email: string | null
          signer_name: string | null
          signers_completed: number | null
          signers_total: number | null
          status: string | null
          template_id: string | null
          updated_at: string | null
        }
        Insert: {
          archive_attempts?: number | null
          archive_error?: string | null
          archived_at?: string | null
          certificate_bytes?: number | null
          certificate_path?: string | null
          completed_at?: string | null
          completion_notified_at?: string | null
          created_at?: string | null
          credential_sharing_opt_out?: boolean | null
          declined_at?: string | null
          envelope_id?: string | null
          envelope_type?: string | null
          event_slug?: string | null
          event_title?: string | null
          form_data_read_at?: string | null
          id?: string | null
          issue_error?: string | null
          last_manual_resend_at?: string | null
          member_id?: string | null
          minor_name?: string | null
          participant_id?: string | null
          prefill?: Json | null
          provider?: string | null
          reminder_count?: number | null
          reminder_sent_at?: string | null
          replicated_at?: string | null
          restricted_at?: string | null
          retain_until?: string | null
          reused_from?: string | null
          seal_kind?: string | null
          sealed_at?: string | null
          sent_at?: string | null
          signed_pdf_bytes?: number | null
          signed_pdf_path?: string | null
          signed_pdf_sha256?: string | null
          signer_email?: string | null
          signer_name?: string | null
          signers_completed?: number | null
          signers_total?: number | null
          status?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archive_attempts?: number | null
          archive_error?: string | null
          archived_at?: string | null
          certificate_bytes?: number | null
          certificate_path?: string | null
          completed_at?: string | null
          completion_notified_at?: string | null
          created_at?: string | null
          credential_sharing_opt_out?: boolean | null
          declined_at?: string | null
          envelope_id?: string | null
          envelope_type?: string | null
          event_slug?: string | null
          event_title?: string | null
          form_data_read_at?: string | null
          id?: string | null
          issue_error?: string | null
          last_manual_resend_at?: string | null
          member_id?: string | null
          minor_name?: string | null
          participant_id?: string | null
          prefill?: Json | null
          provider?: string | null
          reminder_count?: number | null
          reminder_sent_at?: string | null
          replicated_at?: string | null
          restricted_at?: string | null
          retain_until?: string | null
          reused_from?: string | null
          seal_kind?: string | null
          sealed_at?: string | null
          sent_at?: string | null
          signed_pdf_bytes?: number | null
          signed_pdf_path?: string | null
          signed_pdf_sha256?: string | null
          signer_email?: string | null
          signer_name?: string | null
          signers_completed?: number | null
          signers_total?: number | null
          status?: string | null
          template_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docusign_envelopes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_reused_from_fkey"
            columns: ["reused_from"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_reused_from_fkey"
            columns: ["reused_from"]
            isOneToOne: false
            referencedRelation: "docusign_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docusign_envelopes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "esign_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_answers_long: {
        Row: {
          adult_relationship: string | null
          event_slug: string | null
          event_year: number | null
          first_time: boolean | null
          is_minor_at_submit: boolean | null
          member_id: string | null
          participant_ethnicity: string[] | null
          participant_id: string | null
          profile_gender: string | null
          profile_grade: string | null
          question_key: string | null
          respondent_role: string | null
          response_id: string | null
          school_id: string | null
          school_name: string | null
          school_state: string | null
          source: string | null
          submitted_at: string | null
          submitted_from: string | null
          survey_key: string | null
          survey_version: number | null
          value_numeric: number | null
          value_options: string[] | null
          value_text: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_answers_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      app_tenant_id: { Args: never; Returns: string }
      book_addon_lines: {
        Args: { p_addon: string; p_lines: Json }
        Returns: {
          addon_id: string
          booked_by_member_id: string | null
          booked_by_role: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          checked_at: string | null
          created_at: string
          currency: string
          group_invoice_id: string | null
          group_method: string | null
          id: string
          minor_rule_override: boolean
          order_id: string | null
          paid_at: string | null
          participant_id: string
          payer: string
          quantity: number
          registration_id: string
          status: string
          store_order_item_id: string | null
          tenant_id: string | null
          unit_price_cents: number
          updated_at: string
          variant_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "registration_addons"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      bump_email_quota: { Args: { p_day: string }; Returns: number }
      can_read_chat_channel: {
        Args: { _channel_id: string; _clerk_sub: string }
        Returns: boolean
      }
      can_read_space: {
        Args: { p_clerk_user_id: string; p_space_id: string }
        Returns: boolean
      }
      decrement_post_comment_count: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      ensure_tier_space: { Args: { p_tier_id: string }; Returns: string }
      esign_append_audit: {
        Args: {
          p_detail?: Json
          p_envelope: string
          p_event: string
          p_ip?: string
          p_recipient: string
          p_ua?: string
        }
        Returns: {
          at: string
          detail: Json
          envelope_row: string
          event: string
          hash: string
          id: number
          ip: string | null
          prev_hash: string | null
          recipient_row: string | null
          tenant_id: string | null
          user_agent: string | null
        }
        SetofOptions: {
          from: "*"
          to: "esign_audit_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      esign_audit_digest: {
        Args: {
          p_at: string
          p_detail: Json
          p_envelope: string
          p_event: string
          p_ip: string
          p_prev: string
          p_recipient: string
          p_ua: string
        }
        Returns: string
      }
      esign_audit_heads: {
        Args: never
        Returns: {
          envelope_row: string
          hash: string
          last_id: number
        }[]
      }
      esign_claim_email: {
        Args: { p_day: string; p_limit: number }
        Returns: boolean
      }
      esign_note_failed_check: {
        Args: { p_id: string; p_max: number }
        Returns: number
      }
      esign_purge_audit: { Args: { p_envelope: string }; Returns: number }
      esign_verify_audit: { Args: { p_envelope: string }; Returns: number }
      event_slug_inventory: {
        Args: never
        Returns: {
          event_slug: string
          row_count: number
          table_name: string
        }[]
      }
      event_slug_row_counts: {
        Args: { p_slug: string }
        Returns: {
          row_count: number
          table_name: string
        }[]
      }
      increment_post_comment_count: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      increment_resource_download: { Args: { rid: string }; Returns: undefined }
      merge_members: {
        Args: {
          p_actor: string
          p_drop: string
          p_fields: Json
          p_keep: string
          p_summary?: Json
        }
        Returns: Json
      }
      participant_eligibility_refusal: {
        Args: {
          p_date_of_birth: string
          p_event_slug: string
          p_registration_tenant: string
        }
        Returns: string
      }
      platform_audit_append: {
        Args: {
          p_action: string
          p_actor: string
          p_actor_kind: string
          p_metadata?: Json
          p_reason?: string
          p_target_id?: string
          p_target_table?: string
          p_tenant: string
        }
        Returns: {
          action: string
          actor: string
          actor_kind: string
          chain_seq: number
          hash: string
          id: number
          metadata: Json
          occurred_at: string
          prev_hash: string | null
          reason: string | null
          target_id: string | null
          target_table: string | null
          tenant_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_audit_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_audit_canonical: {
        Args: {
          p_action: string
          p_actor: string
          p_actor_kind: string
          p_metadata: Json
          p_occurred_at: string
          p_reason: string
          p_seq: number
          p_target_id: string
          p_target_table: string
          p_tenant: string
        }
        Returns: string
      }
      platform_audit_digest: {
        Args: {
          p_action: string
          p_actor: string
          p_actor_kind: string
          p_metadata: Json
          p_occurred_at: string
          p_prev: string
          p_reason: string
          p_seq: number
          p_target_id: string
          p_target_table: string
          p_tenant: string
        }
        Returns: string
      }
      platform_audit_field: { Args: { p_value: string }; Returns: string }
      platform_audit_heads: {
        Args: never
        Returns: {
          chain_seq: number
          hash: string
          tenant_id: string
        }[]
      }
      platform_audit_verify: {
        Args: { p_tenant: string }
        Returns: {
          checked: number
          first_bad_id: number
          first_bad_seq: number
          head_hash: string
          head_seq: number
          ok: boolean
          problem: string
        }[]
      }
      platform_quota_usage: {
        Args: never
        Returns: {
          database_bytes: number
          storage_bytes: number
        }[]
      }
      promote_grades: { Args: never; Returns: undefined }
      prune_email_outbox_blobs: { Args: never; Returns: number }
      rate_limit_gc: { Args: never; Returns: number }
      rate_limit_take: {
        Args: { p_keys: string[]; p_limits: number[]; p_windows: number[] }
        Returns: {
          allowed: boolean
          retry_after: number
        }[]
      }
      record_app_error: {
        Args: {
          p_count?: number
          p_digest: string
          p_message: string
          p_route: string
          p_tenant_id?: string
        }
        Returns: undefined
      }
      rename_event_slug: {
        Args: { p_new: string; p_old: string }
        Returns: {
          rows_updated: number
          table_name: string
        }[]
      }
      set_training_progress: {
        Args: { p_item_id: string; p_member_id: string; p_status: string }
        Returns: undefined
      }
      space_unread_counts: {
        Args: { _member_id: string }
        Returns: {
          space_id: string
          unread: number
        }[]
      }
      storage_object_tenant_id: { Args: { p_name: string }; Returns: string }
      support_break_glass_open: {
        Args: { p_admin: string; p_consent_id: string; p_reason: string }
        Returns: {
          ends_at: string
          session_id: string
          tenant_id: string
        }[]
      }
      support_break_glass_renew: {
        Args: { p_admin: string; p_reason: string; p_session_id: string }
        Returns: string
      }
      support_consent_decide: {
        Args: {
          p_approve: boolean
          p_approver: string
          p_consent_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      support_consent_withdraw: {
        Args: { p_consent_id: string; p_tenant_id: string }
        Returns: boolean
      }
      survey_claim_email: {
        Args: { p_day: string; p_limit: number }
        Returns: boolean
      }
      survey_current_member_id: { Args: never; Returns: string }
      survey_purge_person: {
        Args: {
          p_actor: string
          p_emails: string[]
          p_member_id: string
          p_participant_ids: string[]
        }
        Returns: Json
      }
      survey_redact_answer: {
        Args: {
          p_actor: string
          p_question_key: string
          p_reason: string
          p_response_id: string
        }
        Returns: boolean
      }
      survey_submit_response: {
        Args: {
          p_answers: Json
          p_followup_consent: boolean
          p_is_minor: boolean
          p_no_quote: boolean
          p_quote_consent: string
          p_response_id: string
          p_submitted_from: string
        }
        Returns: string
      }
      tenancy_backfill_child_tenant_ids: {
        Args: { p_tables: string[] }
        Returns: {
          rows_updated: number
          tbl: string
        }[]
      }
      tenancy_backfill_tenant_ids: {
        Args: never
        Returns: {
          rows_updated: number
          tbl: string
        }[]
      }
      tenancy_hidden_from_tenant_session: {
        Args: { p_event_slug: string; p_tenant: string }
        Returns: boolean
      }
      tenancy_log_derivation: {
        Args: {
          p_key: string
          p_reason: string
          p_sqlstate?: string
          p_table: string
        }
        Returns: undefined
      }
      tenant_host_map: {
        Args: never
        Returns: {
          host: string
          tenant_id: string
          tenant_slug: string
        }[]
      }
      tenant_self_ref_visible: {
        Args: { p_id: string; p_table: string }
        Returns: boolean
      }
      tier_space_slug: { Args: { p_name: string }; Returns: string }
      usage_rollup: { Args: { p_day: string }; Returns: number }
    }
    Enums: {
      age_bracket_type: "high_school" | "college" | "adult"
      audit_action_type: "INSERT" | "UPDATE" | "DELETE"
      event_role_type:
        | "participant"
        | "mentor"
        | "teacher"
        | "donor"
        | "parent"
        | "subscriber"
        | "adult"
        | "school_student_manager"
        | "volunteer"
      gender_type: "male" | "female" | "other" | "prefer_not_to_say"
      grade_type:
        | "grade_6"
        | "grade_7"
        | "grade_8"
        | "grade_9"
        | "grade_10"
        | "grade_11"
        | "grade_12"
        | "college_freshman"
        | "college_sophomore"
        | "college_junior"
        | "college_senior"
        | "grad_phd"
      member_role_type:
        | "staff"
        | "coach"
        | "mentor"
        | "moderator"
        | "student_manager"
        | "teacher"
        | "member"
        | "participant"
        | "volunteer"
        | "donor_sponsor"
        | "parent"
      membership_renewal_status:
        | "active"
        | "pending_renewal"
        | "expired"
        | "cancelled"
        | "complimentary"
      tenant_role: "tenant_admin" | "staff" | "event_manager" | "duty_holder"
      tshirt_size_type:
        | "S"
        | "M"
        | "L"
        | "XL"
        | "2XL"
        | "3XL_plus"
        | "3XL (or larger)"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      age_bracket_type: ["high_school", "college", "adult"],
      audit_action_type: ["INSERT", "UPDATE", "DELETE"],
      event_role_type: [
        "participant",
        "mentor",
        "teacher",
        "donor",
        "parent",
        "subscriber",
        "adult",
        "school_student_manager",
        "volunteer",
      ],
      gender_type: ["male", "female", "other", "prefer_not_to_say"],
      grade_type: [
        "grade_6",
        "grade_7",
        "grade_8",
        "grade_9",
        "grade_10",
        "grade_11",
        "grade_12",
        "college_freshman",
        "college_sophomore",
        "college_junior",
        "college_senior",
        "grad_phd",
      ],
      member_role_type: [
        "staff",
        "coach",
        "mentor",
        "moderator",
        "student_manager",
        "teacher",
        "member",
        "participant",
        "volunteer",
        "donor_sponsor",
        "parent",
      ],
      membership_renewal_status: [
        "active",
        "pending_renewal",
        "expired",
        "cancelled",
        "complimentary",
      ],
      tenant_role: ["tenant_admin", "staff", "event_manager", "duty_holder"],
      tshirt_size_type: [
        "S",
        "M",
        "L",
        "XL",
        "2XL",
        "3XL_plus",
        "3XL (or larger)",
      ],
    },
  },
} as const

