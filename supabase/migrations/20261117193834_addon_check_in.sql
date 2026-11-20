-- Event add-ons at the check-in desk (docs/PLAN-event-add-ons-2026-11-17.md, Phase 5, US-23):
-- when a person's extra was ticked off (on the tour bus, accommodation collected).
ALTER TABLE public.registration_addons ADD COLUMN IF NOT EXISTS checked_at timestamptz;
