-- Insights: the visit recorder as a standalone module for any website (ours or third parties').
-- A site has a public key used by the tracking snippet, the domains allowed to send to it, a plan (monthly visit
-- limit and how long recordings are kept) and a team: viewers watch and see reports, managers can also change
-- settings and funnels and invite people. CRM admins and super users can see every site.
create table if not exists public.insight_plans (
  key text primary key, name text not null, monthly_sessions integer, retention_days integer not null, sort_order integer not null default 0
);
insert into public.insight_plans(key, name, monthly_sessions, retention_days, sort_order) values
  ('free', 'Free', 1000, 30, 1), ('starter', 'Starter', 10000, 90, 2), ('pro', 'Pro', 50000, 180, 3), ('internal', 'Internal (unlimited)', null, 90, 9)
on conflict (key) do nothing;
alter table public.insight_plans enable row level security;
create policy insight_plans_read on public.insight_plans for select to authenticated using (true);
grant select on public.insight_plans to authenticated;

create table if not exists public.insight_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domains text[] not null default '{}',
  site_key uuid not null unique default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete set null,
  plan text not null default 'starter' references public.insight_plans(key),
  session_limit integer, retention_days integer,
  consent_mode text not null default 'wait' check (consent_mode in ('wait','auto')),
  is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.insight_site_members (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.insight_sites(id) on delete cascade,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  role text not null default 'viewer' check (role in ('viewer','manager')),
  invited_by uuid, invited_at timestamptz not null default now(), accepted_at timestamptz,
  unique (site_id, email)
);
create index if not exists insight_site_members_user on public.insight_site_members(user_id);

alter table public.web_sessions add column if not exists site_id uuid references public.insight_sites(id) on delete cascade;
create index if not exists web_sessions_site_started on public.web_sessions(site_id, started_at desc);
alter table public.marketing_funnels add column if not exists site_id uuid references public.insight_sites(id) on delete cascade;
alter table public.marketing_funnels alter column business_unit_id drop not null;

-- Who may see / manage a site.
create or replace function private.insight_role(p_site uuid) returns text language sql stable security definer set search_path = '' as $$
  select case when private.is_admin() then 'admin'
              else (select m.role from public.insight_site_members m where m.site_id = p_site and m.user_id = (select auth.uid()) limit 1) end
$$;
create or replace function private.insight_can_view(p_site uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.insight_role(p_site) is not null
$$;
create or replace function private.insight_can_manage(p_site uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.insight_role(p_site) in ('admin','manager')
$$;

alter table public.insight_sites enable row level security;
alter table public.insight_site_members enable row level security;
create policy insight_sites_read on public.insight_sites for select to authenticated using (private.insight_can_view(id));
create policy insight_members_read on public.insight_site_members for select to authenticated using (user_id = (select auth.uid()) or private.insight_can_manage(site_id));
grant select on public.insight_sites, public.insight_site_members to authenticated;

-- Recordings and funnels: anyone on the site's team (CRM admins see all).
alter policy web_sessions_admin_read on public.web_sessions using (private.is_admin() or private.insight_can_view(site_id));
alter policy web_session_chunks_admin_read on public.web_session_chunks
  using (exists (select 1 from public.web_sessions s where s.id = session_id and (private.is_admin() or private.insight_can_view(s.site_id))));
alter policy marketing_funnels_admin on public.marketing_funnels using (private.is_admin() or private.insight_can_manage(site_id)) with check (private.is_admin() or private.insight_can_manage(site_id));
create policy marketing_funnels_team_read on public.marketing_funnels for select to authenticated using (private.insight_can_view(site_id));

-- Our own sites.
insert into public.insight_sites(name, domains, business_unit_id, plan, consent_mode)
select 'Race Car Graphics website', array['racecargraphics.uk','www.racecargraphics.uk','rcg-website.justin-b8f.workers.dev'], b.id, 'internal', 'wait'
  from public.business_units b where b.slug = 'race-car-graphics' and not exists (select 1 from public.insight_sites s where s.business_unit_id = b.id);
insert into public.insight_sites(name, domains, business_unit_id, plan, consent_mode)
select 'Auto Opulence website', array['autoopulence.co.uk','www.autoopulence.co.uk','autoopulence.justin-b8f.workers.dev'], b.id, 'internal', 'wait'
  from public.business_units b where b.slug = 'auto-opulence' and not exists (select 1 from public.insight_sites s where s.business_unit_id = b.id);
update public.web_sessions w set site_id = s.id from public.insight_sites s join public.business_units b on b.id = s.business_unit_id
 where w.site_id is null and w.business = b.slug;
update public.marketing_funnels f set site_id = s.id from public.insight_sites s
 where f.site_id is null and s.business_unit_id = f.business_unit_id;

-- Limits for a site: its own override, otherwise the plan's.
create or replace function private.insight_limits(p_site uuid, out monthly_sessions integer, out retention_days integer)
language sql stable security definer set search_path = '' as $$
  select coalesce(s.session_limit, p.monthly_sessions), coalesce(s.retention_days, p.retention_days)
    from public.insight_sites s join public.insight_plans p on p.key = s.plan where s.id = p_site
$$;

-- Called by web-recorder for each chunk. Returns 'ok', or 'limit' when a new visit would go over the monthly limit.
create or replace function public.insights_record_chunk(p jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare site uuid := (p->>'site_id')::uuid; lim integer; used integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.web_sessions where id = (p->>'sid')::uuid) then
    select monthly_sessions into lim from private.insight_limits(site);
    if lim is not null then
      select count(*) into used from public.web_sessions where site_id = site and started_at >= date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London';
      if used >= lim then return 'limit'; end if;
    end if;
  end if;
  perform private.web_record_chunk(p);
  update public.web_sessions set site_id = site where id = (p->>'sid')::uuid and site_id is null;
  return 'ok';
end $$;

-- The signed-in person's sites with this month's usage (the Insights home page).
create or replace function public.insights_my_sites()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'domains', s.domains, 'role', private.insight_role(s.id), 'plan', p.name, 'plan_key', s.plan,
           'limit', coalesce(s.session_limit, p.monthly_sessions), 'retention_days', coalesce(s.retention_days, p.retention_days), 'is_active', s.is_active,
           'business_unit_id', s.business_unit_id, 'site_key', case when private.insight_can_manage(s.id) then s.site_key end, 'consent_mode', s.consent_mode,
           'used', (select count(*) from public.web_sessions w where w.site_id = s.id and w.started_at >= date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London'),
           'last_visit', (select max(started_at) from public.web_sessions w where w.site_id = s.id)) order by s.name), '[]'::jsonb)
    from public.insight_sites s join public.insight_plans p on p.key = s.plan
   where private.insight_can_view(s.id)
$$;
grant execute on function public.insights_my_sites() to authenticated;

-- Link invitations to the signed-in person (by email) the first time they sign in.
create or replace function public.insights_claim_invites()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.insight_site_members set user_id = auth.uid(), accepted_at = coalesce(accepted_at, now())
   where user_id is null and lower(email) = lower(coalesce(auth.jwt()->>'email', ''));
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.insights_claim_invites() to authenticated;

-- Reports by site.
create or replace function public.insights_overview(p_site uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz := (p_from::timestamp at time zone 'Europe/London'); t timestamptz := ((p_to + 1)::timestamp at time zone 'Europe/London'); r jsonb;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  with s as (select * from public.web_sessions w where w.site_id = p_site and w.started_at >= f and w.started_at < t and w.page_count > 0)
  select jsonb_build_object(
    'totals', (select jsonb_build_object('visitors', count(distinct coalesce(visitor_id, id)), 'sessions', count(*), 'pageviews', coalesce(sum(page_count), 0),
                 'bounced', count(*) filter (where page_count <= 1), 'forms', count(*) filter (where form_submitted),
                 'avg_seconds', coalesce(round(avg(duration_ms) / 1000.0), 0), 'from_ads', count(*) filter (where gclid is not null or utm_medium ilike any (array['cpc','ppc','paid%'])),
                 'rage', count(*) filter (where rage_clicks > 0), 'errors', count(*) filter (where error_count > 0)) from s),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'pageviews', pv, 'visitors', v) order by d), '[]'::jsonb) from (
        select gs::date d, coalesce(sum(s.page_count), 0) pv, count(distinct coalesce(s.visitor_id, s.id)) filter (where s.id is not null) v
          from generate_series(p_from, p_to, interval '1 day') gs left join s on (s.started_at at time zone 'Europe/London')::date = gs::date group by 1) z),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('path', pth, 'views', n, 'visitors', v) order by n desc), '[]'::jsonb) from (
        select pth, count(*) n, count(distinct coalesce(s.visitor_id, s.id)) v from s, unnest(s.paths) pth group by pth order by count(*) desc limit 20) z),
    'exits', (select coalesce(jsonb_agg(jsonb_build_object('path', exit_path, 'sessions', n) order by n desc), '[]'::jsonb) from (
        select exit_path, count(*) n from s where exit_path is not null and not form_submitted group by exit_path order by count(*) desc limit 15) z),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('label', src, 'sessions', n) order by n desc), '[]'::jsonb) from (
        select coalesce(nullif(utm_source, ''), case when gclid is not null then 'google (ads)' end, nullif(substring(referrer from '^https?://(?:www\.)?([^/]+)'), ''), 'Direct') src, count(*) n
          from s group by 1 order by count(*) desc limit 15) z),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(device, 'Unknown'), 'sessions', n) order by n desc), '[]'::jsonb) from (select device, count(*) n from s group by device) z),
    'browsers', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(browser, 'Unknown'), 'sessions', n) order by n desc), '[]'::jsonb) from (select browser, count(*) n from s group by browser) z)
  ) into r;
  return r;
end $fn$;
grant execute on function public.insights_overview(uuid, date, date) to authenticated;

create or replace function public.insights_funnel(p_funnel uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare fn public.marketing_funnels; steps jsonb; n int; counts int[]; s record; pos int; ok boolean; i int; st jsonb; k int; found int;
  f timestamptz := (p_from::timestamp at time zone 'Europe/London'); t timestamptz := ((p_to + 1)::timestamp at time zone 'Europe/London');
begin
  select * into fn from public.marketing_funnels where id = p_funnel;
  if fn.id is null or not private.insight_can_view(fn.site_id) then raise exception 'Funnel not found'; end if;
  steps := fn.steps; n := jsonb_array_length(steps); counts := array_fill(0, array[n]);
  for s in select paths, form_submitted from public.web_sessions w where w.site_id = fn.site_id and w.started_at >= f and w.started_at < t and w.page_count > 0 loop
    pos := 1; ok := true;
    for i in 1..n loop
      exit when not ok;
      st := steps->(i - 1);
      if st->>'type' = 'form' then ok := s.form_submitted;
      else
        found := 0;
        for k in pos..cardinality(s.paths) loop
          if coalesce(st->>'value', '') in ('', '/') or s.paths[k] ilike '%' || (st->>'value') || '%' then found := k; exit; end if;
        end loop;
        ok := found > 0; if ok then pos := found + case when i = 1 then 0 else 1 end; end if;
      end if;
      if ok then counts[i] := counts[i] + 1; end if;
    end loop;
  end loop;
  return (select jsonb_agg(jsonb_build_object('label', steps->(g.x - 1)->>'label', 'count', counts[g.x]) order by g.x) from generate_series(1, n) g(x));
end $fn$;
grant execute on function public.insights_funnel(uuid, date, date) to authenticated;
