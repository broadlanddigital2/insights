-- Nightly tidy-up of visits WITHOUT a screen recording (applied 12 Oct 2026). Visits that have any recording are never deleted.
-- Removes: empty visits (no pages) older than a day, and unrecorded visits older than the site's retention
-- (insight_sites.retention_days, else the plan's, else 90 days). Events, page views and chunk rows go with them (cascade).
create or replace function private.insights_cleanup_unrecorded(p_limit int default 20000)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  with keep as (
    select s.id, coalesce(s.retention_days, p.retention_days, 90) days
      from public.insight_sites s left join public.insight_plans p on p.key = s.plan
  ), doomed as (
    select w.id from public.web_sessions w
      left join keep k on k.id = w.site_id
     where (  (w.page_count = 0 and w.started_at < now() - interval '1 day')
           or w.started_at < now() - make_interval(days => coalesce(k.days, 90)) )
       and not exists (select 1 from public.web_session_chunks c where c.session_id = w.id and c.storage_path is not null)
     limit p_limit
  )
  delete from public.web_sessions w using doomed d where w.id = d.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.insights_cleanup_unrecorded(int) from public, anon, authenticated;
select cron.schedule('insights-cleanup-unrecorded', '17 3 * * *', $c$select private.insights_cleanup_unrecorded()$c$);
