-- Insights v2: users (a person across all their visits and devices), events, page views with performance, errors.
-- A visitor is anonymous ("v:" + browser visitor ID) until the site calls Insights.identify(id, {email, name}); then
-- all of that browser's earlier visits move onto the identified user ("u:" + id), and visits from other devices that
-- identify with the same ID join the same user.
alter table public.web_sessions add column if not exists country text, add column if not exists user_key text, add column if not exists user_email text, add column if not exists user_name text;
create index if not exists web_sessions_site_user on public.web_sessions(site_id, user_key, started_at desc);

create table if not exists public.insight_users (
  site_id uuid not null references public.insight_sites(id) on delete cascade,
  user_key text not null,
  external_id text, email text, name text, traits jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  sessions integer not null default 0, pageviews integer not null default 0, events integer not null default 0, errors integer not null default 0,
  last_device text, last_browser text, last_os text, timezone text, first_source text, first_path text,
  merged_into text,
  primary key (site_id, user_key)
);
create index if not exists insight_users_last_seen on public.insight_users(site_id, last_seen desc);

create table if not exists public.insight_events (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.insight_sites(id) on delete cascade,
  session_id uuid not null references public.web_sessions(id) on delete cascade,
  user_key text, name text not null, props jsonb not null default '{}'::jsonb, path text, pageview_id uuid,
  ts timestamptz not null default now()
);
create index if not exists insight_events_site_ts on public.insight_events(site_id, ts desc);
create index if not exists insight_events_site_name_ts on public.insight_events(site_id, name, ts desc);
create index if not exists insight_events_session on public.insight_events(session_id, ts);
create index if not exists insight_events_user on public.insight_events(site_id, user_key, ts desc);

create table if not exists public.insight_pageviews (
  id uuid primary key,
  site_id uuid not null references public.insight_sites(id) on delete cascade,
  session_id uuid not null references public.web_sessions(id) on delete cascade,
  user_key text, path text, url text, title text, referrer text, ts timestamptz not null,
  duration_ms integer, scroll integer, ttfb integer, fcp integer, lcp integer, cls numeric, inp integer, load_ms integer, dom_ms integer, heap_mb numeric,
  device text, browser text, os text
);
create index if not exists insight_pageviews_site_ts on public.insight_pageviews(site_id, ts desc);
create index if not exists insight_pageviews_session on public.insight_pageviews(session_id, ts);

alter table public.insight_users enable row level security;
alter table public.insight_events enable row level security;
alter table public.insight_pageviews enable row level security;
create policy insight_users_team_read on public.insight_users for select to authenticated using (private.is_admin() or private.insight_can_view(site_id));
create policy insight_events_team_read on public.insight_events for select to authenticated using (private.is_admin() or private.insight_can_view(site_id));
create policy insight_pageviews_team_read on public.insight_pageviews for select to authenticated using (private.is_admin() or private.insight_can_view(site_id));
grant select on public.insight_users, public.insight_events, public.insight_pageviews to authenticated;

-- Chunks without screen recording (analytics only) have no stored file.
create or replace function private.web_record_chunk(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid := (p->>'sid')::uuid; pth text := left(coalesce(p->>'path', '/'), 300);
  newpage boolean := coalesce((p->>'page_start')::boolean, false) and p->'pageviews' is null;
  fts bigint := nullif(p->>'first_ts', '')::bigint; lts bigint := nullif(p->>'last_ts', '')::bigint; stored boolean := p->>'storage_path' is not null;
begin
  insert into public.web_sessions(id, business, host, visitor_id, first_ts, last_ts, landing_path, exit_path, paths, referrer, utm_source, utm_medium, utm_campaign, gclid, device, browser, os, screen,
                                  browser_version, os_version, viewport, language, timezone, connection, touch)
  values (sid, left(p->>'business', 40), left(p->>'host', 120), nullif(p->>'vid', '')::uuid, fts, lts, pth, pth, '{}', left(p->>'referrer', 500),
          left(p->>'utm_source', 120), left(p->>'utm_medium', 120), left(p->>'utm_campaign', 200), left(p->>'gclid', 300),
          left(p->>'device', 20), left(p->>'browser', 40), left(p->>'os', 40), left(p->>'screen', 20),
          left(p->>'browser_version', 20), left(p->>'os_version', 20), left(p->>'viewport', 20), left(p->>'language', 20), left(p->>'timezone', 60), left(p->>'connection', 30), (p->>'touch')::boolean)
  on conflict (id) do nothing;
  update public.web_sessions s set
     last_seen_at = now(),
     first_ts = least(coalesce(s.first_ts, fts), coalesce(fts, s.first_ts)),
     last_ts = greatest(coalesce(s.last_ts, lts), coalesce(lts, s.last_ts)),
     duration_ms = least(2147483647, greatest(0, greatest(coalesce(s.last_ts, lts), coalesce(lts, s.last_ts)) - least(coalesce(s.first_ts, fts), coalesce(fts, s.first_ts))))::int,
     page_count = s.page_count + case when newpage then 1 else 0 end,
     paths = case when newpage and (cardinality(s.paths) = 0 or s.paths[cardinality(s.paths)] is distinct from pth) and cardinality(s.paths) < 200 then s.paths || pth else s.paths end,
     exit_path = case when newpage then pth else s.exit_path end,
     click_count = s.click_count + least(coalesce((p->>'clicks')::int, 0), 5000),
     rage_clicks = s.rage_clicks + least(coalesce((p->>'rage')::int, 0), 500),
     error_count = s.error_count + least(coalesce((p->>'errors')::int, 0), 500),
     warning_count = s.warning_count + least(coalesce((p->>'warnings')::int, 0), 500),
     viewport = coalesce(left(p->>'viewport', 20), s.viewport),
     referrer = coalesce(s.referrer, left(p->>'referrer', 500)),
     form_submitted = s.form_submitted or coalesce((p->>'form')::boolean, false),
     form_at = case when coalesce((p->>'form')::boolean, false) and s.form_at is null then now() else s.form_at end,
     chunk_count = s.chunk_count + case when stored then 1 else 0 end,
     bytes = s.bytes + case when stored then coalesce((p->>'bytes')::int, 0) else 0 end
   where s.id = sid;
  if stored then
    insert into public.web_session_chunks(session_id, seq, page, storage_path, bytes, first_ts, last_ts)
    values (sid, (p->>'seq')::int, coalesce((p->>'page')::int, 0), p->>'storage_path', coalesce((p->>'bytes')::int, 0), fts, lts)
    on conflict (session_id, seq) do nothing;
  end if;
end $$;

-- Users, events and page views for a chunk.
create or replace function private.insights_record_analytics(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare site uuid := (p->>'site_id')::uuid; sid uuid := (p->>'sid')::uuid; vid text := nullif(p->>'vid', '');
  uid text := left(nullif(p->'user'->>'id', ''), 200); ukey text; old_key text; sess public.web_sessions; n_ev int := 0; n_pv int := 0; n_err int := 0; pv jsonb; ins boolean;
begin
  select * into sess from public.web_sessions where id = sid;
  if sess.id is null then return; end if;
  ukey := case when uid is not null then 'u:' || uid when vid is not null then 'v:' || vid else 's:' || sid end;
  old_key := sess.user_key;
  -- First time this browser identifies: move its anonymous history onto the user (the anonymous row is kept, marked merged).
  if uid is not null and vid is not null and exists (select 1 from public.insight_users where site_id = site and user_key = 'v:' || vid and merged_into is null) then
    update public.web_sessions set user_key = ukey where site_id = site and user_key = 'v:' || vid;
    update public.insight_events set user_key = ukey where site_id = site and user_key = 'v:' || vid;
    update public.insight_pageviews set user_key = ukey where site_id = site and user_key = 'v:' || vid;
    insert into public.insight_users(site_id, user_key, first_seen, last_seen, sessions, pageviews, events, errors, last_device, last_browser, last_os, timezone, first_source, first_path)
    select site, ukey, first_seen, last_seen, sessions, pageviews, events, errors, last_device, last_browser, last_os, timezone, first_source, first_path
      from public.insight_users where site_id = site and user_key = 'v:' || vid
    on conflict (site_id, user_key) do update set first_seen = least(public.insight_users.first_seen, excluded.first_seen), sessions = public.insight_users.sessions + excluded.sessions,
      pageviews = public.insight_users.pageviews + excluded.pageviews, events = public.insight_users.events + excluded.events, errors = public.insight_users.errors + excluded.errors,
      first_source = coalesce(public.insight_users.first_source, excluded.first_source), first_path = coalesce(public.insight_users.first_path, excluded.first_path);
    update public.insight_users set merged_into = ukey, sessions = 0, pageviews = 0, events = 0, errors = 0 where site_id = site and user_key = 'v:' || vid;
    select user_key into old_key from public.web_sessions where id = sid;
  end if;
  update public.web_sessions set user_key = ukey,
         user_email = coalesce(left(p->'user'->>'email', 200), user_email), user_name = coalesce(left(p->'user'->>'name', 200), user_name)
   where id = sid;

  with e as (select x from jsonb_array_elements(coalesce(p->'events', '[]'::jsonb)) with ordinality t(x, i) where i <= 300)
  insert into public.insight_events(site_id, session_id, user_key, name, props, path, pageview_id, ts)
  select site, sid, ukey, left(coalesce(x->>'name', 'event'), 80), coalesce(case when jsonb_typeof(x->'props') = 'object' then x->'props' end, '{}'::jsonb),
         left(x->>'path', 300), case when x->>'pv' ~* '^[0-9a-f-]{36}$' then (x->>'pv')::uuid end,
         coalesce(to_timestamp(nullif(x->>'ts', '')::double precision / 1000), now())
    from e;
  get diagnostics n_ev = row_count;
  select count(*) into n_err from jsonb_array_elements(coalesce(p->'events', '[]'::jsonb)) x where x->>'name' = '$error';

  for pv in select x from jsonb_array_elements(coalesce(p->'pageviews', '[]'::jsonb)) with ordinality t(x, i) where i <= 100 loop
    continue when not (coalesce(pv->>'id', '') ~* '^[0-9a-f-]{36}$');
    insert into public.insight_pageviews(id, site_id, session_id, user_key, path, url, title, referrer, ts, duration_ms, scroll, ttfb, fcp, lcp, cls, inp, load_ms, dom_ms, heap_mb, device, browser, os)
    values ((pv->>'id')::uuid, site, sid, ukey, left(pv->>'path', 300), left(pv->>'url', 1000), left(pv->>'title', 200), left(pv->>'referrer', 500),
            coalesce(to_timestamp(nullif(pv->>'ts', '')::double precision / 1000), now()), nullif(least(coalesce((pv->>'duration')::numeric, -1), 86400000), -1)::int, nullif(least(coalesce((pv->>'scroll')::numeric, -1), 100), -1)::int,
            (pv->>'ttfb')::numeric::int, (pv->>'fcp')::numeric::int, (pv->>'lcp')::numeric::int, (pv->>'cls')::numeric, (pv->>'inp')::numeric::int, (pv->>'load')::numeric::int,
            (pv->>'dom')::numeric::int, (pv->>'heap')::numeric, sess.device, sess.browser, sess.os)
    on conflict (id) do update set duration_ms = coalesce(excluded.duration_ms, public.insight_pageviews.duration_ms), scroll = greatest(public.insight_pageviews.scroll, excluded.scroll),
      ttfb = coalesce(excluded.ttfb, public.insight_pageviews.ttfb), fcp = coalesce(excluded.fcp, public.insight_pageviews.fcp), lcp = coalesce(excluded.lcp, public.insight_pageviews.lcp),
      cls = coalesce(excluded.cls, public.insight_pageviews.cls), inp = coalesce(excluded.inp, public.insight_pageviews.inp), load_ms = coalesce(excluded.load_ms, public.insight_pageviews.load_ms),
      dom_ms = coalesce(excluded.dom_ms, public.insight_pageviews.dom_ms), heap_mb = coalesce(excluded.heap_mb, public.insight_pageviews.heap_mb)
    returning (xmax = 0) into ins;
    if ins then
      n_pv := n_pv + 1;
      update public.web_sessions s set page_count = s.page_count + 1, exit_path = left(pv->>'path', 300),
             paths = case when (cardinality(s.paths) = 0 or s.paths[cardinality(s.paths)] is distinct from left(pv->>'path', 300)) and cardinality(s.paths) < 200 then s.paths || left(pv->>'path', 300) else s.paths end,
             landing_path = case when s.page_count = 0 then left(pv->>'path', 300) else s.landing_path end
       where s.id = sid;
    end if;
  end loop;

  insert into public.insight_users(site_id, user_key, external_id, email, name, traits, first_seen, last_seen, sessions, pageviews, events, errors, last_device, last_browser, last_os, timezone, first_source, first_path)
  values (site, ukey, uid, left(p->'user'->>'email', 200), left(p->'user'->>'name', 200), coalesce(case when jsonb_typeof(p->'user'->'traits') = 'object' then p->'user'->'traits' end, '{}'::jsonb),
          sess.started_at, now(), 1, n_pv, n_ev, n_err, sess.device, sess.browser, sess.os, sess.timezone,
          coalesce(nullif(sess.utm_source, ''), case when sess.gclid is not null then 'google (ads)' end, nullif(substring(sess.referrer from '^https?://(?:www\.)?([^/]+)'), ''), 'Direct'), sess.landing_path)
  on conflict (site_id, user_key) do update set
    external_id = coalesce(excluded.external_id, public.insight_users.external_id), email = coalesce(excluded.email, public.insight_users.email), name = coalesce(excluded.name, public.insight_users.name),
    traits = public.insight_users.traits || excluded.traits, last_seen = now(), merged_into = null,
    sessions = public.insight_users.sessions + case when old_key is distinct from ukey then 1 else 0 end,
    pageviews = public.insight_users.pageviews + n_pv, events = public.insight_users.events + n_ev, errors = public.insight_users.errors + n_err,
    last_device = excluded.last_device, last_browser = excluded.last_browser, last_os = excluded.last_os, timezone = coalesce(excluded.timezone, public.insight_users.timezone);
end $$;

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
  update public.web_sessions set site_id = coalesce(site_id, site), country = coalesce(country, upper(left(p->>'country', 2))) where id = (p->>'sid')::uuid and (site_id is null or country is null and p->>'country' is not null);
  perform private.insights_record_analytics(p);
  return 'ok';
end $$;
