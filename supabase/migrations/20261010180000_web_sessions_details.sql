-- More visit details (browser/OS versions, window size, language, time zone, connection) and console warnings.
alter table public.web_sessions add column if not exists browser_version text, add column if not exists os_version text,
  add column if not exists viewport text, add column if not exists language text, add column if not exists timezone text,
  add column if not exists connection text, add column if not exists touch boolean, add column if not exists warning_count integer not null default 0;

create or replace function private.web_record_chunk(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid := (p->>'sid')::uuid; pth text := left(coalesce(p->>'path', '/'), 300); newpage boolean := coalesce((p->>'page_start')::boolean, false);
  fts bigint := nullif(p->>'first_ts', '')::bigint; lts bigint := nullif(p->>'last_ts', '')::bigint;
begin
  insert into public.web_sessions(id, business, host, visitor_id, first_ts, last_ts, landing_path, exit_path, paths, referrer, utm_source, utm_medium, utm_campaign, gclid, device, browser, os, screen,
                                  browser_version, os_version, viewport, language, timezone, connection, touch)
  values (sid, left(p->>'business', 40), left(p->>'host', 120), nullif(p->>'vid', '')::uuid, fts, lts, pth, pth, '{}', left(p->>'referrer', 300),
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
     form_submitted = s.form_submitted or coalesce((p->>'form')::boolean, false),
     form_at = case when coalesce((p->>'form')::boolean, false) and s.form_at is null then now() else s.form_at end,
     chunk_count = s.chunk_count + 1,
     bytes = s.bytes + coalesce((p->>'bytes')::int, 0)
   where s.id = sid;
  insert into public.web_session_chunks(session_id, seq, page, storage_path, bytes, first_ts, last_ts)
  values (sid, (p->>'seq')::int, coalesce((p->>'page')::int, 0), p->>'storage_path', coalesce((p->>'bytes')::int, 0), fts, lts)
  on conflict (session_id, seq) do nothing;
end $$;
