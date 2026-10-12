-- Row level security: Insights admins see everything; everyone else only the sites they're a member of.
alter table public.insight_plans enable row level security;
alter table public.crm_businesses enable row level security;
alter table public.insight_sites enable row level security;
alter table public.insight_site_members enable row level security;
alter table public.insight_admins enable row level security;
alter table public.web_sessions enable row level security;
alter table public.web_session_chunks enable row level security;
alter table public.insight_users enable row level security;
alter table public.insight_events enable row level security;
alter table public.insight_pageviews enable row level security;
alter table public.marketing_funnels enable row level security;
alter table public.insight_charts enable row level security;
create policy plans_read on public.insight_plans for select to authenticated using (true);
create policy crm_businesses_read on public.crm_businesses for select to authenticated using (private.insight_is_admin());
create policy sites_read on public.insight_sites for select to authenticated using (private.insight_can_view(id));
create policy members_read on public.insight_site_members for select to authenticated using (user_id = (select auth.uid()) or private.insight_can_manage(site_id));
create policy admins_read on public.insight_admins for select to authenticated using (private.insight_is_admin());
create policy sessions_read on public.web_sessions for select to authenticated using (private.insight_can_view(site_id));
create policy chunks_read on public.web_session_chunks for select to authenticated using (exists (select 1 from public.web_sessions s where s.id = session_id and private.insight_can_view(s.site_id)));
create policy users_read on public.insight_users for select to authenticated using (private.insight_can_view(site_id));
create policy events_read on public.insight_events for select to authenticated using (private.insight_can_view(site_id));
create policy pageviews_read on public.insight_pageviews for select to authenticated using (private.insight_can_view(site_id));
create policy funnels_read on public.marketing_funnels for select to authenticated using (private.insight_can_view(site_id));
create policy funnels_write on public.marketing_funnels for all to authenticated using (private.insight_can_manage(site_id)) with check (private.insight_can_manage(site_id));
create policy charts_read on public.insight_charts for select to authenticated using (private.insight_can_view(site_id));
create policy charts_write on public.insight_charts for all to authenticated using (private.insight_can_manage(site_id)) with check (private.insight_can_manage(site_id));
grant usage on schema private to authenticated;
grant select on public.insight_plans, public.crm_businesses, public.insight_sites, public.insight_site_members, public.insight_admins, public.web_sessions, public.web_session_chunks,
  public.insight_users, public.insight_events, public.insight_pageviews to authenticated;
grant select, insert, update, delete on public.marketing_funnels, public.insight_charts to authenticated;
revoke all on public.insight_settings from anon, authenticated;
grant execute on function public.insights_my_sites(), public.insights_claim_invites(), public.insights_me(), public.insights_overview(uuid, date, date), public.insights_events(uuid, date, date),
  public.insights_event_detail(uuid, text, date, date), public.insights_funnel_steps(uuid, jsonb, date, date, text), public.insights_funnel(uuid, date, date),
  public.insights_performance(uuid, date, date), public.insights_errors(uuid, date, date), public.insights_metric(uuid, jsonb, date, date) to authenticated;
revoke execute on function public.insights_record_chunk(jsonb) from public, anon, authenticated;
