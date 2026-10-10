-- Insights v2 reports: overview (users, new vs returning, locations), events, funnels over pages/events/clicks/forms
-- counted by sessions or users, web vitals (p75 + good/needs improvement/poor) and grouped errors.
alter table public.web_sessions add column if not exists country text;
alter table public.marketing_funnels add column if not exists count_by text not null default 'sessions';

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

-- One funnel step matches a timeline item. Steps: {type: page|event|click|form, value, prop, prop_value, label}
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
  return (with ev as (select e.*, coalesce(nullif(left(e.props->>'message', 300), ''), '(no message)') msg, coalesce(e.props->>'level', 'error') lvl, s.browser, s.os, s.device
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
                 (array_agg(session_id order by ts desc))[1:10] recent_sessions
            from ev group by msg, lvl order by count(*) desc limit 100) z)));
end $fn$;

grant execute on function public.insights_overview(uuid, date, date), public.insights_events(uuid, date, date), public.insights_event_detail(uuid, text, date, date),
  public.insights_funnel_steps(uuid, jsonb, date, date, text), public.insights_funnel(uuid, date, date), public.insights_performance(uuid, date, date),
  public.insights_errors(uuid, date, date) to authenticated;
