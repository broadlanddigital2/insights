-- Insights Metrics (like Better Stack's Metrics): any measure over time with chosen aggregations (count, sum, avg,
-- min, max, p50–p99), optionally split by a dimension, plus saved custom charts per site.
create table if not exists public.insight_charts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.insight_sites(id) on delete cascade,
  title text not null,
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists insight_charts_site on public.insight_charts(site_id, sort_order);
alter table public.insight_charts enable row level security;
create policy insight_charts_read on public.insight_charts for select to authenticated using (private.is_admin() or private.insight_can_view(site_id));
create policy insight_charts_write on public.insight_charts for all to authenticated using (private.is_admin() or private.insight_can_manage(site_id)) with check (private.is_admin() or private.insight_can_manage(site_id));
grant select, insert, update on public.insight_charts to authenticated;

-- p: {metric, aggs[], group, interval (hour|day|week), page (contains), event (name), prop (event property)}
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
grant execute on function public.insights_metric(uuid, jsonb, date, date) to authenticated;
