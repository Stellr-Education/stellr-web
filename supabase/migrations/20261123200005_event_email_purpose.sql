-- Email plan Workstream B (23 Nov 2026): every event email says whether it is
-- logistics (about an event the recipient registered for: transactional, no
-- marketing unsubscribe) or promotional (community stream: sent only to
-- members who have marketing consent, never to minors, with one-click
-- unsubscribe). Existing rows are logistics, which is what they were written as.

ALTER TABLE public.event_emails
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'logistics'
  CONSTRAINT event_emails_purpose_check CHECK (purpose IN ('logistics', 'promotional'));

ALTER TABLE public.event_email_templates
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'logistics'
  CONSTRAINT event_email_templates_purpose_check CHECK (purpose IN ('logistics', 'promotional'));

COMMENT ON COLUMN public.event_emails.purpose IS
  'logistics = transactional stream; promotional = community stream, consented adult members only, one-click unsubscribe (lib/event-emails/send.ts).';
