-- Teacher name badges (17 Nov 2026): a fourth badge audience.
--   teachers   participants registered as a teacher (event_role = 'teacher')
-- Optional and event-only: a teacher's badge uses the event's Teachers
-- background, else Everyone (the event's own, else the theme default), else a
-- plain badge (lib/badge-layout.ts pickTemplate). No theme default for it, so
-- default_badge_templates is unchanged.
--
-- Expand only: widens the CHECK. Code that never writes 'teachers' is unaffected.

ALTER TABLE public.event_badge_templates DROP CONSTRAINT IF EXISTS event_badge_templates_audience_check;
ALTER TABLE public.event_badge_templates
  ADD CONSTRAINT event_badge_templates_audience_check
  CHECK (audience IN ('everyone', 'mentors', 'teachers', 'company'));
