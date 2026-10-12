-- Insights runs on its own: its own administrators (not CRM roles) and Insights-only logins.
--  • insight_admins: people who manage Insights itself (add websites for anyone, plans, all sites, other admins).
--    Seeded with the CRM admins and super users so nobody loses access; after that it is managed in Insights.
--  • Logins made by Insights invitations are marked app_metadata.insights_only = true, and the CRM refuses them.
create table if not exists public.insight_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  added_by uuid, added_at timestamptz not null default now()
);
alter table public.insight_admins enable row level security;
insert into public.insight_admins(user_id, email)
select p.id, u.email from public.profiles p join auth.users u on u.id = p.id
 where p.is_active and p.role::text in ('admin','super_user') and u.email is not null
on conflict (user_id) do nothing;

create or replace function private.insight_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.insight_admins a where a.user_id = (select auth.uid()))
$$;
create policy insight_admins_read on public.insight_admins for select to authenticated using (private.insight_is_admin());

-- Site access comes from Insights alone: an Insights admin, or a member of the site's team.
create or replace function private.insight_role(p_site uuid) returns text language sql stable security definer set search_path = '' as $$
  select case when private.insight_is_admin() then 'admin'
              else (select m.role from public.insight_site_members m where m.site_id = p_site and m.user_id = (select auth.uid()) limit 1) end
$$;

-- Who the signed-in person is in Insights.
create or replace function public.insights_me() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('admin', private.insight_is_admin(),
    'insights_only', coalesce((select (u.raw_app_meta_data->>'insights_only')::boolean from auth.users u where u.id = (select auth.uid())), false),
    'name', (select nullif(trim(coalesce(u.raw_user_meta_data->>'first_name','')||' '||coalesce(u.raw_user_meta_data->>'last_name','')),'') from auth.users u where u.id = (select auth.uid())))
$$;
grant execute on function public.insights_me() to authenticated;

-- Who the website belongs to (any client, free text). business_unit_id stays only for our own CRM businesses
-- (it links their website enquiries to visits).
alter table public.insight_sites add column if not exists owner_name text;
-- insights_my_sites() also returns owner_name (see the live definition).
