-- Insights' own Supabase project (CRM Insights, gbxjvsrgqcomkjxakbso). Standalone: no CRM tables.
create schema if not exists private;
create table public.insight_settings (name text primary key, value text not null);
alter table public.insight_settings enable row level security;

create table public.insight_plans (key text primary key, name text not null, monthly_sessions integer, retention_days integer not null, sort_order integer not null default 0);
insert into public.insight_plans values ('free','Free',1000,30,1),('starter','Starter',10000,90,2),('pro','Pro',50000,180,3),('internal','Internal (unlimited)',null,90,9);

-- Our own CRM businesses, only to label/link our own websites (their enquiries link to visits in the CRM).
create table public.crm_businesses (id uuid primary key, name text not null);

create table public.insight_sites (
  id uuid primary key default gen_random_uuid(), name text not null, owner_name text, domains text[] not null default '{}',
  site_key uuid not null unique default gen_random_uuid(), business_unit_id uuid, plan text not null default 'starter' references public.insight_plans(key),
  session_limit integer, retention_days integer, consent_mode text not null default 'wait' check (consent_mode in ('wait','auto')),
  is_active boolean not null default true, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.insight_site_members (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.insight_sites(id) on delete cascade, email text not null,
  user_id uuid references auth.users(id) on delete set null, role text not null default 'viewer' check (role in ('viewer','manager')),
  invited_by uuid, invited_at timestamptz not null default now(), accepted_at timestamptz, unique (site_id, email));
create index on public.insight_site_members(user_id);
-- Insights admins: by email, linked to the login when they first sign in.
create table public.insight_admins (email text primary key, user_id uuid references auth.users(id) on delete set null, added_by uuid, added_at timestamptz not null default now());

create table public.web_sessions (
  id uuid primary key, site_id uuid references public.insight_sites(id) on delete cascade, business text, host text, visitor_id uuid,
  started_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), first_ts bigint, last_ts bigint,
  duration_ms integer not null default 0, page_count integer not null default 0, click_count integer not null default 0, rage_clicks integer not null default 0,
  error_count integer not null default 0, warning_count integer not null default 0, paths text[] not null default '{}', landing_path text, exit_path text,
  referrer text, utm_source text, utm_medium text, utm_campaign text, gclid text, device text, browser text, os text, screen text,
  browser_version text, os_version text, viewport text, language text, timezone text, connection text, touch boolean, country text,
  form_submitted boolean not null default false, form_at timestamptz, chunk_count integer not null default 0, bytes bigint not null default 0,
  lead_id uuid, user_key text, user_email text, user_name text, created_at timestamptz not null default now());
create index on public.web_sessions(site_id, started_at desc);
create index on public.web_sessions(site_id, user_key, started_at desc);
create table public.web_session_chunks (
  session_id uuid not null references public.web_sessions(id) on delete cascade, seq integer not null, page integer not null default 0,
  storage_path text not null, bytes integer not null default 0, first_ts bigint, last_ts bigint, created_at timestamptz not null default now(), primary key (session_id, seq));

create table public.insight_users (
  site_id uuid not null references public.insight_sites(id) on delete cascade, user_key text not null, external_id text, email text, name text,
  traits jsonb not null default '{}'::jsonb, first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  sessions integer not null default 0, pageviews integer not null default 0, events integer not null default 0, errors integer not null default 0,
  last_device text, last_browser text, last_os text, timezone text, first_source text, first_path text, merged_into text, primary key (site_id, user_key));
create index on public.insight_users(site_id, last_seen desc);
create table public.insight_events (
  id bigint generated always as identity primary key, site_id uuid not null references public.insight_sites(id) on delete cascade,
  session_id uuid not null references public.web_sessions(id) on delete cascade, user_key text, name text not null, props jsonb not null default '{}'::jsonb,
  path text, pageview_id uuid, ts timestamptz not null default now());
create index on public.insight_events(site_id, ts desc);
create index on public.insight_events(site_id, name, ts desc);
create index on public.insight_events(session_id, ts);
create index on public.insight_events(site_id, user_key, ts desc);
create table public.insight_pageviews (
  id uuid primary key, site_id uuid not null references public.insight_sites(id) on delete cascade, session_id uuid not null references public.web_sessions(id) on delete cascade,
  user_key text, path text, url text, title text, referrer text, ts timestamptz not null, duration_ms integer, scroll integer, ttfb integer, fcp integer, lcp integer,
  cls numeric, inp integer, load_ms integer, dom_ms integer, heap_mb numeric, device text, browser text, os text);
create index on public.insight_pageviews(site_id, ts desc);
create index on public.insight_pageviews(session_id, ts);
create table public.marketing_funnels (
  id uuid primary key default gen_random_uuid(), site_id uuid references public.insight_sites(id) on delete cascade, business_unit_id uuid, name text not null,
  steps jsonb not null default '[]'::jsonb, count_by text not null default 'sessions', sort_order integer not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.insight_charts (
  id uuid primary key default gen_random_uuid(), site_id uuid not null references public.insight_sites(id) on delete cascade, title text not null,
  config jsonb not null default '{}'::jsonb, sort_order integer not null default 0, is_active boolean not null default true, created_by uuid default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on public.insight_charts(site_id, sort_order);

insert into storage.buckets(id, name, public, file_size_limit) values ('web-recordings','web-recordings',false,2097152) on conflict (id) do nothing;
