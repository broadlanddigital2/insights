-- Our own website session recordings (replaces PostHog). The websites record visits with rrweb (only after the
-- visitor accepts analytics cookies, typing hidden) and send compressed chunks to the web-recorder function, which
-- stores them in the private "web-recordings" bucket and keeps one row per visit here. Funnels, drop-off pages and
-- visitor numbers for Marketing → Website are worked out from these rows.
create table if not exists public.web_sessions (
  id uuid primary key,
  business text,
  host text,
  visitor_id uuid,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  first_ts bigint, last_ts bigint,
  duration_ms integer not null default 0,
  page_count integer not null default 0,
  click_count integer not null default 0,
  rage_clicks integer not null default 0,
  error_count integer not null default 0,
  paths text[] not null default '{}',
  landing_path text, exit_path text,
  referrer text, utm_source text, utm_medium text, utm_campaign text, gclid text,
  device text, browser text, os text, screen text,
  form_submitted boolean not null default false, form_at timestamptz,
  chunk_count integer not null default 0, bytes bigint not null default 0,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists web_sessions_started on public.web_sessions(started_at desc);
create index if not exists web_sessions_business_started on public.web_sessions(business, started_at desc);
create table if not exists public.web_session_chunks (
  session_id uuid not null references public.web_sessions(id) on delete cascade,
  seq integer not null,
  page integer not null default 0,
  storage_path text not null,
  bytes integer not null default 0,
  first_ts bigint, last_ts bigint,
  created_at timestamptz not null default now(),
  primary key (session_id, seq)
);
alter table public.web_sessions enable row level security;
alter table public.web_session_chunks enable row level security;
create policy web_sessions_admin_read on public.web_sessions for select to authenticated using (private.is_admin());
create policy web_session_chunks_admin_read on public.web_session_chunks for select to authenticated using (private.is_admin());
grant select on public.web_sessions, public.web_session_chunks to authenticated;

insert into storage.buckets(id, name, public, file_size_limit) values ('web-recordings', 'web-recordings', false, 2097152)
on conflict (id) do nothing;

-- Called by the web-recorder function (service role) for every chunk received.
create or replace function private.web_record_chunk(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid := (p->>'sid')::uuid; pth text := left(coalesce(p->>'path', '/'), 300); newpage boolean := coalesce((p->>'page_start')::boolean, false);
  fts bigint := nullif(p->>'first_ts', '')::bigint; lts bigint := nullif(p->>'last_ts', '')::bigint;
begin
  insert into public.web_sessions(id, business, host, visitor_id, first_ts, last_ts, landing_path, exit_path, paths, referrer, utm_source, utm_medium, utm_campaign, gclid, device, browser, os, screen)
  values (sid, left(p->>'business', 40), left(p->>'host', 120), nullif(p->>'vid', '')::uuid, fts, lts, pth, pth, '{}', left(p->>'referrer', 300),
          left(p->>'utm_source', 120), left(p->>'utm_medium', 120), left(p->>'utm_campaign', 200), left(p->>'gclid', 300),
          left(p->>'device', 20), left(p->>'browser', 40), left(p->>'os', 40), left(p->>'screen', 20))
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
     form_submitted = s.form_submitted or coalesce((p->>'form')::boolean, false),
     form_at = case when coalesce((p->>'form')::boolean, false) and s.form_at is null then now() else s.form_at end,
     chunk_count = s.chunk_count + 1,
     bytes = s.bytes + coalesce((p->>'bytes')::int, 0)
   where s.id = sid;
  insert into public.web_session_chunks(session_id, seq, page, storage_path, bytes, first_ts, last_ts)
  values (sid, (p->>'seq')::int, coalesce((p->>'page')::int, 0), p->>'storage_path', coalesce((p->>'bytes')::int, 0), fts, lts)
  on conflict (session_id, seq) do nothing;
end $$;

create or replace function private.web_business_slug(p_business uuid) returns text language sql stable security definer set search_path = '' as $$
  select slug from public.business_units where id = p_business
$$;

-- Visitors, pages, drop-off and sources for Marketing → Website.
create or replace function public.web_overview(p_business uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare f timestamptz := (p_from::timestamp at time zone 'Europe/London'); t timestamptz := ((p_to + 1)::timestamp at time zone 'Europe/London');
  slug text := private.web_business_slug(p_business); r jsonb;
begin
  if not private.is_admin() then raise exception 'Website analytics is for admins and super users'; end if;
  with s as (select * from public.web_sessions w where w.started_at >= f and w.started_at < t and (p_business is null or w.business = slug) and w.page_count > 0)
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
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(device, 'Unknown'), 'sessions', n) order by n desc), '[]'::jsonb) from (select device, count(*) n from s group by device) z)
  ) into r;
  return r;
end $fn$;
grant execute on function public.web_overview(uuid, date, date) to authenticated;

-- How many visits got through each funnel step, in order (page steps match on the page address).
create or replace function public.web_funnel(p_funnel uuid, p_business uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare fn public.marketing_funnels; steps jsonb; n int; counts int[]; s record; pos int; ok boolean; i int; st jsonb; k int; found int;
  f timestamptz := (p_from::timestamp at time zone 'Europe/London'); t timestamptz := ((p_to + 1)::timestamp at time zone 'Europe/London'); slug text;
begin
  if not private.is_admin() then raise exception 'Website analytics is for admins and super users'; end if;
  select * into fn from public.marketing_funnels where id = p_funnel;
  if fn.id is null then raise exception 'Funnel not found'; end if;
  slug := private.web_business_slug(coalesce(p_business, fn.business_unit_id));
  steps := fn.steps; n := jsonb_array_length(steps); counts := array_fill(0, array[n]);
  for s in select paths, form_submitted from public.web_sessions w where w.started_at >= f and w.started_at < t and w.business = slug and w.page_count > 0 loop
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
grant execute on function public.web_funnel(uuid, uuid, date, date) to authenticated;

-- Leads from website forms remember the visit (rcg_session in the page address) so the CRM can play it back.
alter table public.leads add column if not exists web_session_id uuid;
create or replace function private.leads_capture_ad_click()
returns trigger language plpgsql set search_path = '' as $$
declare p jsonb := coalesce(new.raw_payload, '{}'::jsonb); flds jsonb := coalesce(new.raw_payload->'fields', new.raw_payload->'data', '{}'::jsonb); u text := coalesce(new.source_url, '');
begin
  if new.gclid is null then
    new.gclid := nullif(coalesce(p->>'gclid', flds->>'gclid', p->>'gbraid', flds->>'gbraid', p->>'wbraid', flds->>'wbraid',
                                 substring(u from '[?&]gclid=([^&#]+)'), substring(u from '[?&]gbraid=([^&#]+)'), substring(u from '[?&]wbraid=([^&#]+)')), '');
  end if;
  if new.utm_source is null then new.utm_source := nullif(coalesce(p->>'utm_source', flds->>'utm_source', substring(u from '[?&]utm_source=([^&#]+)')), ''); end if;
  if new.utm_medium is null then new.utm_medium := nullif(coalesce(p->>'utm_medium', flds->>'utm_medium', substring(u from '[?&]utm_medium=([^&#]+)')), ''); end if;
  if new.utm_campaign is null then new.utm_campaign := nullif(coalesce(p->>'utm_campaign', flds->>'utm_campaign', substring(u from '[?&]utm_campaign=([^&#]+)')), ''); end if;
  if new.gclid is not null and new.utm_source is null then new.utm_source := 'google'; new.utm_medium := coalesce(new.utm_medium, 'cpc'); end if;
  if new.web_session_id is null then
    begin new.web_session_id := nullif(coalesce(p->>'rcg_session', flds->>'rcg_session', substring(u from '[?&]rcg_session=([0-9a-fA-F-]{36})')), '')::uuid;
    exception when others then new.web_session_id := null; end;
  end if;
  return new;
end $$;
create or replace function private.leads_link_web_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.web_session_id is not null then update public.web_sessions set lead_id = new.id where id = new.web_session_id and lead_id is null; end if;
  return new;
end $$;
create or replace trigger leads_link_web_session after insert on public.leads for each row execute function private.leads_link_web_session();

-- Daily clean-up of recordings older than 90 days (run once via execute_sql):
-- select cron.schedule('web-recordings-cleanup','41 3 * * *', $$select net.http_post(url:='https://dipjypzrfigkzuarlsov.supabase.co/functions/v1/web-recorder', headers:=jsonb_build_object('Content-Type','application/json','x-quote-cron-token',(select secret_value from public.ecommerce_system_secrets where secret_name='quote_followup_cron_token')), body:='{"action":"cleanup"}'::jsonb, timeout_milliseconds:=120000);$$);

-- Entry point for the web-recorder function (service role only).
create or replace function public.web_record_chunk(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not allowed'; end if;
  perform private.web_record_chunk(p);
end $$;
