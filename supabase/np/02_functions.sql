-- Insights functions (copied from the CRM project, admins from insight_admins).
create or replace function private.insight_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.insight_admins a where a.user_id = (select auth.uid()) or lower(a.email) = lower(coalesce((select auth.jwt())->>'email', '-')))
$$;

create or replace function private.insight_role(p_site uuid) returns text language sql stable security definer set search_path = '' as $$
  select case when private.insight_is_admin() then 'admin'
              else (select m.role from public.insight_site_members m where m.site_id = p_site and m.user_id = (select auth.uid()) limit 1) end
$$;

create or replace function private.insight_can_manage(p_site uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.insight_role(p_site) in ('admin','manager')
$$;

create or replace function private.insight_can_view(p_site uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.insight_role(p_site) is not null
$$;

create or replace function private.insight_limits(p_site uuid, out monthly_sessions integer, out retention_days integer)
language sql stable security definer set search_path = '' as $$
  select coalesce(s.session_limit, p.monthly_sessions), coalesce(s.retention_days, p.retention_days)
    from public.insight_sites s join public.insight_plans p on p.key = s.plan where s.id = p_site
$$;

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

  -- A site stuck in an error loop can send thousands of the same error: keep the first 30 per visit (still counted).
  with prior as (select count(*) n from public.insight_events q where q.session_id = sid and q.name = '$error'),
       raw as (select x, i, case when x->>'name' = '$error' then sum(case when x->>'name' = '$error' then 1 else 0 end) over (order by i) end en
                 from jsonb_array_elements(coalesce(p->'events', '[]'::jsonb)) with ordinality t(x, i) where i <= 300),
       e as (select x from raw, prior where raw.en is null or prior.n + raw.en <= 30)
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

create or replace function public.insights_my_sites()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'domains', s.domains, 'role', private.insight_role(s.id), 'plan', p.name, 'plan_key', s.plan,
           'limit', coalesce(s.session_limit, p.monthly_sessions), 'retention_days', coalesce(s.retention_days, p.retention_days), 'is_active', s.is_active,
           'business_unit_id', s.business_unit_id, 'owner_name', s.owner_name, 'site_key', case when private.insight_can_manage(s.id) then s.site_key end, 'consent_mode', s.consent_mode,
           'used', (select count(*) from public.web_sessions w where w.site_id = s.id and w.started_at >= date_trunc('month', now() at time zone 'Europe/London') at time zone 'Europe/London'),
           'last_visit', (select max(started_at) from public.web_sessions w where w.site_id = s.id)) order by s.name), '[]'::jsonb)
    from public.insight_sites s join public.insight_plans p on p.key = s.plan
   where private.insight_can_view(s.id)
$$;

create or replace function public.insights_claim_invites()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.insight_site_members set user_id = auth.uid(), accepted_at = coalesce(accepted_at, now())
   where user_id is null and lower(email) = lower(coalesce(auth.jwt()->>'email', ''));
  get diagnostics n = row_count;
  update public.insight_admins set user_id = auth.uid() where user_id is null and lower(email) = lower(coalesce(auth.jwt()->>'email', ''));
  return n;
end $$;

create or replace function public.insights_me() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('admin', private.insight_is_admin(),
    'insights_only', coalesce((select (u.raw_app_meta_data->>'insights_only')::boolean from auth.users u where u.id = (select auth.uid())), false),
    'name', (select nullif(trim(coalesce(u.raw_user_meta_data->>'first_name','')||' '||coalesce(u.raw_user_meta_data->>'last_name','')),'') from auth.users u where u.id = (select auth.uid())))
$$;

create or replace function private.insights_range(p_from date, p_to date, out f timestamptz, out t timestamptz)
language sql immutable set search_path = '' as $$
  select (p_from::timestamp at time zone 'Europe/London'), ((p_to + 1)::timestamp at time zone 'Europe/London');
$$;

create or replace function private.insights_source(utm_source text, gclid text, referrer text) returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(utm_source, ''), case when gclid is not null then 'google (ads)' end, nullif(substring(referrer from '^https?://(?:www\.)?([^/]+)'), ''), 'Direct');
$$;

create or replace function public.insights_overview(p_site uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz; t timestamptz; r jsonb;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  select x.f, x.t into f, t from private.insights_range(p_from, p_to) x;
  with s as (select w.*, coalesce(w.user_key, 'v:' || coalesce(w.visitor_id, w.id)) uk from public.web_sessions w
              where w.site_id = p_site and w.started_at >= f and w.started_at < t and w.page_count > 0),
       u as (select uk, min(started_at) first_in_range from s group by uk),
       nu as (select u.uk, coalesce(iu.first_seen, u.first_in_range) >= f as is_new, iu.external_id is not null as identified
                from u left join public.insight_users iu on iu.site_id = p_site and iu.user_key = u.uk),
       ev as (select e.* from public.insight_events e where e.site_id = p_site and e.ts >= f and e.ts < t)
  select jsonb_build_object(
    'totals', (select jsonb_build_object('users', (select count(*) from u), 'new_users', (select count(*) from nu where is_new), 'returning_users', (select count(*) from nu where not is_new),
                 'identified', (select count(*) from nu where identified), 'visitors', (select count(*) from u),
                 'sessions', count(*), 'pageviews', coalesce(sum(page_count), 0), 'bounced', count(*) filter (where page_count <= 1), 'forms', count(*) filter (where form_submitted),
                 'avg_seconds', coalesce(round(avg(duration_ms) / 1000.0), 0), 'from_ads', count(*) filter (where gclid is not null or utm_medium ilike any (array['cpc','ppc','paid%'])),
                 'rage', count(*) filter (where rage_clicks > 0), 'errors', count(*) filter (where error_count > 0), 'error_count', coalesce(sum(error_count), 0),
                 'events', (select count(*) from ev where name not in ('$click', '$pageview')),
                 'replays', count(*) filter (where chunk_count > 0)) from s),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'pageviews', pv, 'visitors', v, 'sessions', n, 'errors', er) order by d), '[]'::jsonb) from (
        select gs::date d, coalesce(sum(s.page_count), 0) pv, count(distinct s.uk) v, count(s.id) n, coalesce(sum(s.error_count), 0) er
          from generate_series(p_from, p_to, interval '1 day') gs left join s on (s.started_at at time zone 'Europe/London')::date = gs::date group by 1) z),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'sessions', n) order by h), '[]'::jsonb) from (
        select g.h, count(s.id) n from generate_series(0, 23) g(h) left join s on extract(hour from s.started_at at time zone 'Europe/London') = g.h group by g.h) z),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('path', pth, 'views', n, 'visitors', v) order by n desc), '[]'::jsonb) from (
        select pth, count(*) n, count(distinct s.uk) v from s, unnest(s.paths) pth group by pth order by count(*) desc limit 25) z),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('path', landing_path, 'sessions', n) order by n desc), '[]'::jsonb) from (
        select landing_path, count(*) n from s where landing_path is not null group by landing_path order by count(*) desc limit 15) z),
    'exits', (select coalesce(jsonb_agg(jsonb_build_object('path', exit_path, 'sessions', n) order by n desc), '[]'::jsonb) from (
        select exit_path, count(*) n from s where exit_path is not null and not form_submitted group by exit_path order by count(*) desc limit 15) z),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('label', src, 'sessions', n) order by n desc), '[]'::jsonb) from (
        select private.insights_source(utm_source, gclid, referrer) src, count(*) n from s group by 1 order by count(*) desc limit 15) z),
    'campaigns', (select coalesce(jsonb_agg(jsonb_build_object('label', c, 'sessions', n) order by n desc), '[]'::jsonb) from (
        select coalesce(utm_campaign, '(none)') c, count(*) n from s where utm_campaign is not null or gclid is not null group by 1 order by count(*) desc limit 15) z),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(device, 'Unknown'), 'sessions', n) order by n desc), '[]'::jsonb) from (select device, count(*) n from s group by device) z),
    'browsers', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(browser, 'Unknown'), 'sessions', n) order by n desc), '[]'::jsonb) from (select browser, count(*) n from s group by browser) z),
    'os', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(os, 'Unknown'), 'sessions', n) order by n desc), '[]'::jsonb) from (select os, count(*) n from s group by os) z),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('country', country, 'timezone', tz, 'sessions', n) order by n desc), '[]'::jsonb) from (
        select country, case when country is null then timezone end tz, count(*) n from s group by 1, 2 order by count(*) desc limit 25) z),
    'top_events', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n, 'users', us) order by n desc), '[]'::jsonb) from (
        select name, count(*) n, count(distinct user_key) us from ev where name not in ('$click', '$pageview', '$error') group by name order by count(*) desc limit 10) z)
  ) into r;
  return r;
end $fn$;

create or replace function public.insights_events(p_site uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz; t timestamptz;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  select x.f, x.t into f, t from private.insights_range(p_from, p_to) x;
  return (with ev as (select * from public.insight_events e where e.site_id = p_site and e.ts >= f and e.ts < t)
    select jsonb_build_object(
      'events', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n, 'sessions', ss, 'users', us, 'last', lst, 'auto', left(name, 1) = '$') order by n desc), '[]'::jsonb) from (
          select name, count(*) n, count(distinct session_id) ss, count(distinct user_key) us, max(ts) lst from ev group by name) z),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'custom', c, 'auto', a) order by d), '[]'::jsonb) from (
          select gs::date d, count(ev.id) filter (where left(ev.name, 1) <> '$') c, count(ev.id) filter (where left(ev.name, 1) = '$') a
            from generate_series(p_from, p_to, interval '1 day') gs left join ev on (ev.ts at time zone 'Europe/London')::date = gs::date group by 1) z)));
end $fn$;

create or replace function public.insights_event_detail(p_site uuid, p_name text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz; t timestamptz;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  select x.f, x.t into f, t from private.insights_range(p_from, p_to) x;
  return (with ev as (select * from public.insight_events e where e.site_id = p_site and e.name = p_name and e.ts >= f and e.ts < t)
    select jsonb_build_object(
      'count', (select count(*) from ev), 'sessions', (select count(distinct session_id) from ev), 'users', (select count(distinct user_key) from ev),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', n) order by d), '[]'::jsonb) from (
          select gs::date d, count(ev.id) n from generate_series(p_from, p_to, interval '1 day') gs left join ev on (ev.ts at time zone 'Europe/London')::date = gs::date group by 1) z),
      'pages', (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'count', n) order by n desc), '[]'::jsonb) from (
          select coalesce(path, '/') path, count(*) n from ev group by 1 order by count(*) desc limit 10) z),
      'props', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'values', vals) order by k), '[]'::jsonb) from (
          select k, jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc) vals from (
            select k, v, n, row_number() over (partition by k order by n desc) rn from (
              select kv.key k, left(kv.value #>> '{}', 120) v, count(*) n from ev, jsonb_each(ev.props) kv
               where kv.key not in ('trace', 'fields') and jsonb_typeof(kv.value) in ('string', 'number', 'boolean') group by 1, 2) a) b
           where rn <= 8 group by k) z),
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('ts', ts, 'session_id', session_id, 'user_key', user_key, 'path', path, 'props', props) order by ts desc), '[]'::jsonb) from (
          select * from ev order by ts desc limit 50) z)));
end $fn$;

create or replace function private.insights_step_match(st jsonb, it jsonb) returns boolean language sql immutable set search_path = '' as $$
  select case coalesce(st->>'type', 'page')
    when 'page' then it->>'k' = 'p' and (coalesce(st->>'value', '') in ('', '/') and coalesce(it->>'path', '/') = '/' or coalesce(st->>'value', '') not in ('', '/') and it->>'path' ilike '%' || (st->>'value') || '%')
    when 'event' then it->>'k' = 'e' and it->>'name' = st->>'value'
      and (coalesce(st->>'prop', '') = '' or (it->'props'->>(st->>'prop')) ilike '%' || coalesce(st->>'prop_value', '') || '%')
    when 'click' then it->>'k' = 'e' and it->>'name' = '$click' and (it->'props'->>'text' ilike '%' || coalesce(st->>'value', '') || '%' or it->'props'->>'href' ilike '%' || coalesce(st->>'value', '') || '%')
    when 'form' then it->>'k' = 'f' or it->>'k' = 'e' and it->>'name' = '$form_submit' and (coalesce(st->>'value', '') = '' or it->>'path' ilike '%' || (st->>'value') || '%')
    else false end;
$$;

create or replace function public.insights_funnel_steps(p_site uuid, p_steps jsonb, p_from date, p_to date, p_by text default 'sessions')
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz; t timestamptz; n int := jsonb_array_length(coalesce(p_steps, '[]'::jsonb)); counts int[]; secs numeric[]; u record; i int; k int; pos int; prev_ts timestamptz; cur jsonb; m int; matched boolean;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  if n = 0 then return '[]'::jsonb; end if;
  select x.f, x.t into f, t from private.insights_range(p_from, p_to) x;
  counts := array_fill(0, array[n]); secs := array_fill(0::numeric, array[n]);
  for u in
    with s as (select w.id, w.started_at, w.paths, w.form_submitted, case when p_by = 'users' then coalesce(w.user_key, 'v:' || coalesce(w.visitor_id, w.id)) else w.id::text end unit
                 from public.web_sessions w where w.site_id = p_site and w.started_at >= f and w.started_at < t and w.page_count > 0),
         items as (
           select s.unit, pv.ts, jsonb_build_object('k', 'p', 'path', pv.path) it from s join public.insight_pageviews pv on pv.session_id = s.id
           union all
           select s.unit, s.started_at + make_interval(secs => g.o), jsonb_build_object('k', 'p', 'path', g.p) from s, unnest(s.paths) with ordinality g(p, o)
            where not exists (select 1 from public.insight_pageviews pv where pv.session_id = s.id)
           union all
           select s.unit, e.ts, jsonb_build_object('k', 'e', 'name', e.name, 'path', e.path, 'props', e.props) from s join public.insight_events e on e.session_id = s.id and e.name <> '$pageview'
           union all
           select s.unit, s.started_at + interval '1 day', jsonb_build_object('k', 'f') from s where s.form_submitted and not exists (select 1 from public.insight_events e where e.session_id = s.id and e.name = '$form_submit'))
    select unit, jsonb_agg(jsonb_build_object('ts', ts, 'it', it) order by ts) tl from items group by unit
  loop
    pos := 0; prev_ts := null; m := jsonb_array_length(u.tl);
    for i in 1..n loop
      matched := false;
      for k in pos..m - 1 loop
        cur := u.tl->k;
        if private.insights_step_match(p_steps->(i - 1), cur->'it') then
          matched := true; counts[i] := counts[i] + 1;
          if prev_ts is not null then secs[i] := secs[i] + greatest(0, extract(epoch from ((cur->>'ts')::timestamptz - prev_ts))); end if;
          prev_ts := (cur->>'ts')::timestamptz; pos := k + 1; exit;
        end if;
      end loop;
      exit when not matched;
    end loop;
  end loop;
  return (select jsonb_agg(jsonb_build_object('label', coalesce(nullif(p_steps->(g.x - 1)->>'label', ''), p_steps->(g.x - 1)->>'value'), 'count', counts[g.x],
            'avg_seconds', case when g.x > 1 and counts[g.x] > 0 then round(secs[g.x] / counts[g.x]) end) order by g.x) from generate_series(1, n) g(x));
end $fn$;

create or replace function public.insights_funnel(p_funnel uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare fn public.marketing_funnels;
begin
  select * into fn from public.marketing_funnels where id = p_funnel;
  if fn.id is null or not private.insight_can_view(fn.site_id) then raise exception 'Funnel not found'; end if;
  return public.insights_funnel_steps(fn.site_id, fn.steps, p_from, p_to, coalesce(fn.count_by, 'sessions'));
end $fn$;

create or replace function public.insights_performance(p_site uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz; t timestamptz;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  select x.f, x.t into f, t from private.insights_range(p_from, p_to) x;
  return (with pv as (select * from public.insight_pageviews p where p.site_id = p_site and p.ts >= f and p.ts < t),
    th(m, good, poor) as (values ('lcp', 2500, 4000), ('fcp', 1800, 3000), ('ttfb', 800, 1800), ('cls', 0.1, 0.25), ('inp', 200, 500), ('load_ms', 3000, 6000)),
    vals as (select 'lcp' m, lcp::numeric v, pv.* from pv where lcp is not null union all select 'fcp', fcp, pv.* from pv where fcp is not null
      union all select 'ttfb', ttfb, pv.* from pv where ttfb is not null union all select 'cls', cls, pv.* from pv where cls is not null
      union all select 'inp', inp, pv.* from pv where inp is not null union all select 'load_ms', load_ms, pv.* from pv where load_ms is not null)
    select jsonb_build_object(
      'pageviews', (select count(*) from pv),
      'metrics', (select coalesce(jsonb_object_agg(th.m, jsonb_build_object('p75', z.p75, 'p50', z.p50, 'samples', coalesce(z.n, 0), 'good', coalesce(z.g, 0), 'ni', coalesce(z.ni, 0), 'poor', coalesce(z.pr, 0), 'good_at', th.good, 'poor_at', th.poor)), '{}'::jsonb)
          from th left join (select vals.m, round(percentile_cont(0.75) within group (order by v)::numeric, 3) p75, round(percentile_cont(0.5) within group (order by v)::numeric, 3) p50, count(*) n,
                 count(*) filter (where v <= th2.good) g, count(*) filter (where v > th2.good and v <= th2.poor) ni, count(*) filter (where v > th2.poor) pr
                 from vals join th th2 on th2.m = vals.m group by vals.m) z on z.m = th.m),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'lcp', lcp, 'fcp', fcp, 'ttfb', ttfb, 'inp', inp, 'cls', cls, 'load_ms', load_ms) order by d), '[]'::jsonb) from (
          select gs::date d, round(percentile_cont(0.75) within group (order by pv.lcp)) lcp, round(percentile_cont(0.75) within group (order by pv.fcp)) fcp,
                 round(percentile_cont(0.75) within group (order by pv.ttfb)) ttfb, round(percentile_cont(0.75) within group (order by pv.inp)) inp, round(percentile_cont(0.75) within group (order by pv.cls)::numeric, 3) cls, round(percentile_cont(0.75) within group (order by pv.load_ms)) load_ms
            from generate_series(p_from, p_to, interval '1 day') gs left join pv on (pv.ts at time zone 'Europe/London')::date = gs::date group by 1) z),
      'pages', (select coalesce(jsonb_agg(to_jsonb(z) order by z.views desc), '[]'::jsonb) from (
          select path, count(*) views, round(percentile_cont(0.75) within group (order by lcp)) lcp, round(percentile_cont(0.75) within group (order by fcp)) fcp,
                 round(percentile_cont(0.75) within group (order by ttfb)) ttfb, round(percentile_cont(0.75) within group (order by inp)) inp,
                 round(percentile_cont(0.75) within group (order by cls)::numeric, 3) cls, round(percentile_cont(0.75) within group (order by load_ms)) load_ms,
                 round(avg(duration_ms) / 1000.0) avg_seconds, round(avg(scroll)) scroll
            from pv group by path order by count(*) desc limit 30) z),
      'devices', (select coalesce(jsonb_agg(to_jsonb(z) order by z.views desc), '[]'::jsonb) from (
          select coalesce(device, 'Unknown') label, count(*) views, round(percentile_cont(0.75) within group (order by lcp)) lcp, round(percentile_cont(0.75) within group (order by inp)) inp,
                 round(percentile_cont(0.75) within group (order by cls)::numeric, 3) cls, round(percentile_cont(0.75) within group (order by ttfb)) ttfb from pv group by 1) z),
      'browsers', (select coalesce(jsonb_agg(to_jsonb(z) order by z.views desc), '[]'::jsonb) from (
          select coalesce(browser, 'Unknown') label, count(*) views, round(percentile_cont(0.75) within group (order by lcp)) lcp, round(percentile_cont(0.75) within group (order by inp)) inp,
                 round(percentile_cont(0.75) within group (order by cls)::numeric, 3) cls, round(percentile_cont(0.75) within group (order by ttfb)) ttfb from pv group by 1 order by count(*) desc limit 10) z)));
end $fn$;

create or replace function public.insights_errors(p_site uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz; t timestamptz;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  select x.f, x.t into f, t from private.insights_range(p_from, p_to) x;
  return (with ev as (select e.*, coalesce(nullif(left(e.props->>'message', 500), ''), '(no message)') msg, coalesce(e.props->>'level', 'error') lvl, s.browser, s.os, s.device
                        from public.insight_events e join public.web_sessions s on s.id = e.session_id
                       where e.site_id = p_site and e.name = '$error' and e.ts >= f and e.ts < t)
    select jsonb_build_object(
      'total', (select count(*) from ev), 'sessions', (select count(distinct session_id) from ev), 'users', (select count(distinct user_key) from ev),
      'daily', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'count', n) order by d), '[]'::jsonb) from (
          select gs::date d, count(ev.id) n from generate_series(p_from, p_to, interval '1 day') gs left join ev on (ev.ts at time zone 'Europe/London')::date = gs::date group by 1) z),
      'groups', (select coalesce(jsonb_agg(to_jsonb(z) order by z.count desc), '[]'::jsonb) from (
          select msg message, lvl level, count(*) count, count(distinct session_id) sessions, count(distinct user_key) users, min(ts) first_seen, max(ts) last_seen,
                 mode() within group (order by path) top_path, mode() within group (order by browser) top_browser,
                 (array_agg(props->>'trace' order by ts desc) filter (where props->>'trace' is not null))[1] trace,
                 (array_agg(session_id order by ts desc))[1:10] recent_sessions,
                 (select jsonb_agg(jsonb_build_object('path', pth, 'count', n) order by n desc) from (
                    select coalesce(e2.path, '(unknown)') pth, count(*) n from ev e2 where e2.msg = ev.msg and e2.lvl = ev.lvl group by 1 order by 2 desc limit 5) p5) pages,
                 (select jsonb_agg(jsonb_build_object('browser', b, 'count', n) order by n desc) from (
                    select concat_ws(' · ', e2.browser, e2.os, e2.device) b, count(*) n from ev e2 where e2.msg = ev.msg and e2.lvl = ev.lvl group by 1 order by 2 desc limit 5) b5) browsers
            from ev group by msg, lvl order by count(*) desc limit 100) z)));
end $fn$;

create or replace function public.insights_metric(p_site uuid, p jsonb, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz; t timestamptz; metric text := coalesce(p->>'metric', 'pageviews'); grp text := coalesce(nullif(p->>'group', ''), 'none');
  iv text := coalesce(nullif(p->>'interval', ''), case when p_to - p_from <= 2 then 'hour' else 'day' end);
  aggs text[]; src text; val text; tcol text; pagecol text; sx text; gexpr text; cond text := ''; aggsel text := ''; a text; q text; r jsonb;
  ev text := nullif(p->>'event', ''); prop text := nullif(p->>'prop', ''); flt text := nullif(p->>'page', ''); distinct_count boolean := false; zero_fill boolean;
begin
  if not private.insight_can_view(p_site) then raise exception 'You do not have access to this site'; end if;
  select x.f, x.t into f, t from private.insights_range(p_from, p_to) x;
  if iv not in ('hour', 'day', 'week') then iv := 'day'; end if;
  if iv = 'hour' and p_to - p_from > 14 then iv := 'day'; end if;
  aggs := array(select a2 from jsonb_array_elements_text(coalesce(p->'aggs', '["avg"]'::jsonb)) a2
                 where a2 in ('count', 'sum', 'avg', 'min', 'max', 'p50', 'p75', 'p90', 'p95', 'p99') limit 6);
  if cardinality(aggs) = 0 then aggs := array['avg']; end if;

  case
    when metric = 'pageviews' then src := 'pv'; val := '1'; aggs := array['count'];
    when metric in ('lcp', 'fcp', 'ttfb', 'inp', 'cls', 'load_ms', 'dom_ms', 'heap_mb', 'scroll') then src := 'pv'; val := 'x.' || metric;
    when metric = 'time_on_page' then src := 'pv'; val := 'x.duration_ms / 1000.0';
    when metric = 'sessions' then src := 's'; val := '1'; aggs := array['count'];
    when metric = 'users' then src := 's'; val := 'coalesce(x.user_key, x.id::text)'; aggs := array['count']; distinct_count := true;
    when metric = 'session_duration' then src := 's'; val := 'x.duration_ms / 1000.0';
    when metric = 'pages_per_session' then src := 's'; val := 'x.page_count';
    when metric = 'bounce_rate' then src := 's'; val := 'case when x.page_count <= 1 then 100.0 else 0 end'; aggs := array['avg'];
    when metric = 'conversion_rate' then src := 's'; val := 'case when x.form_submitted then 100.0 else 0 end'; aggs := array['avg'];
    when metric in ('error_count', 'click_count', 'rage_clicks') then src := 's'; val := 'x.' || metric;
    when metric = 'events' then src := 'e'; val := '1'; aggs := array['count'];
    when metric = 'event_users' then src := 'e'; val := 'coalesce(x.user_key, x.session_id::text)'; aggs := array['count']; distinct_count := true;
    when metric = 'event_value' then
      if prop is null then raise exception 'Choose the event property to measure'; end if;
      src := 'e'; val := $v$case when x.props->>$6 ~ '^-?[0-9]+(\.[0-9]+)?$' then (x.props->>$6)::numeric end$v$;
    else raise exception 'Unknown metric %', metric;
  end case;
  zero_fill := aggs <@ array['count', 'sum'];

  if src = 'pv' then
    q := 'from public.insight_pageviews x left join public.web_sessions s on s.id = x.session_id where x.site_id = $1 and x.ts >= $2 and x.ts < $3';
    tcol := 'x.ts'; pagecol := 'x.path'; sx := 's';
    if val <> '1' then cond := cond || ' and ' || val || ' is not null'; end if;
  elsif src = 's' then
    q := 'from public.web_sessions x where x.site_id = $1 and x.started_at >= $2 and x.started_at < $3 and x.page_count > 0';
    tcol := 'x.started_at'; pagecol := 'x.landing_path'; sx := 'x';
  else
    q := 'from public.insight_events x left join public.web_sessions s on s.id = x.session_id where x.site_id = $1 and x.ts >= $2 and x.ts < $3';
    tcol := 'x.ts'; pagecol := 'x.path'; sx := 's';
    if ev is not null then cond := cond || ' and x.name = $4'; end if;
    if metric = 'event_value' then cond := cond || ' and ' || val || ' is not null'; end if;
  end if;
  if flt is not null then
    cond := cond || case when src = 's' then ' and exists (select 1 from unnest(x.paths) pp where pp ilike ''%'' || $5 || ''%'')' else ' and x.path ilike ''%'' || $5 || ''%''' end;
  end if;

  gexpr := case grp
    when 'page' then 'coalesce(' || pagecol || ', ''/'')'
    when 'device' then 'coalesce(' || sx || '.device, ''Unknown'')'
    when 'browser' then 'coalesce(' || sx || '.browser, ''Unknown'')'
    when 'os' then 'coalesce(' || sx || '.os, ''Unknown'')'
    when 'country' then 'coalesce(' || sx || '.country, ''Unknown'')'
    when 'source' then 'private.insights_source(' || sx || '.utm_source, ' || sx || '.gclid, ' || sx || '.referrer)'
    when 'user_type' then 'case when ' || sx || '.user_key like ''u:%'' then ''Identified'' else ''Anonymous'' end'
    when 'event' then case when src = 'e' then 'x.name' else '''All''' end
    when 'prop' then case when src = 'e' and prop is not null then 'coalesce(left(x.props->>$6, 80), ''(none)'')' else '''All''' end
    else '''All''' end;

  foreach a in array aggs loop
    aggsel := aggsel || ', ' || case
      when a = 'count' and distinct_count then 'count(distinct v)'
      when a = 'count' then 'count(v)'
      when a = 'sum' then 'round(sum(v::numeric), 3)'
      when a = 'avg' then 'round(avg(v::numeric), 3)'
      when a = 'min' then 'round(min(v::numeric), 3)'
      when a = 'max' then 'round(max(v::numeric), 3)'
      else format('round(percentile_cont(%s) within group (order by v::float8)::numeric, 3)', '0.' || substr(a, 2)) end
      || format(' as %I', a);
  end loop;

  q := format($q$
    with base as (select date_trunc(%L, %s at time zone 'Europe/London') b, (%s)::text g, %s v %s %s),
    top as (select g from base group by g order by count(*) desc limit 8),
    agg as (select b, g %s from base where g in (select g from top) group by b, g),
    tot as (select g, count(*) n %s from base where g in (select g from top) group by g)
    select jsonb_build_object(
      'interval', %L,
      'buckets', (select coalesce(jsonb_agg(to_char(gs, 'YYYY-MM-DD"T"HH24:MI') order by gs), '[]'::jsonb)
                    from generate_series(date_trunc(%L, $2 at time zone 'Europe/London'), date_trunc(%L, ($3 - interval '1 second') at time zone 'Europe/London'), ('1 ' || %L)::interval) gs),
      'series', (select coalesce(jsonb_agg(jsonb_build_object('group', tot.g, 'total', to_jsonb(tot) - 'g' - 'n', 'samples', tot.n,
                   'points', (select jsonb_object_agg(to_char(agg.b, 'YYYY-MM-DD"T"HH24:MI'), to_jsonb(agg) - 'b' - 'g') from agg where agg.g = tot.g)) order by tot.n desc), '[]'::jsonb) from tot))$q$,
    iv, tcol, gexpr, case when distinct_count then val else '(' || val || ')' end, q, cond, aggsel, aggsel, iv, iv, iv, iv);
  execute q into r using p_site, f, t, ev, flt, prop;
  return r || jsonb_build_object('aggs', to_jsonb(aggs), 'zero_fill', zero_fill, 'metric', metric, 'group', grp);
end $fn$;
