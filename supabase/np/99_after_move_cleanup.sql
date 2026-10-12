-- Leftovers from the 12 Oct 2026 move (the Supabase connector refuses DROP statements; run these in the SQL Editor).

-- 1) CRM project (dipjypzrfigkzuarlsov): one-off copy helpers (crons already unscheduled; harmless if left)
drop function if exists private.insights_copy_tick();
drop function if exists private.insights_event_tick();
drop table if exists private.insights_copy_queue;
drop table if exists private.insights_event_queue;

-- 2) Insights project (gbxjvsrgqcomkjxakbso): one-off import helpers
drop function if exists public.insights_missing_recordings(text, text[]);
drop function if exists public.insights_import_events_dedup(text, jsonb);

-- 3) LATER, once you're happy with Insights: the CRM project's old Insights data. Empty the web-recordings bucket in
--    Storage first (8,016 files, ~116 MB, all copied to the Insights project), then drop the old tables in the CRM
--    project (web_sessions, web_session_chunks, insight_*, marketing_funnels and the old insights_* functions).
