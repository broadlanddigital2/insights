-- Website funnels shown in Marketing → Website (data from PostHog). Steps: {"label","type":"page"|"form"|"event","value"}.
create table if not exists public.marketing_funnels (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  name text not null,
  steps jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_funnels_steps_array check (jsonb_typeof(steps) = 'array')
);
alter table public.marketing_funnels enable row level security;
create policy marketing_funnels_admin on public.marketing_funnels for all to authenticated using (private.is_admin()) with check (private.is_admin());
grant select, insert, update, delete on public.marketing_funnels to authenticated;

insert into public.marketing_funnels(business_unit_id, name, steps, sort_order)
select b.id, f.name, f.steps::jsonb, f.ord from public.business_units b
join (values
  ('race-car-graphics', 'Website enquiry', '[{"label":"Visited the website","type":"page","value":"/"},{"label":"Opened the contact page","type":"page","value":"/contact-us"},{"label":"Sent an enquiry form","type":"form","value":""}]', 1),
  ('race-car-graphics', 'Online shop', '[{"label":"Viewed a product","type":"page","value":"/product/"},{"label":"Opened the basket","type":"page","value":"/basket"},{"label":"Started checkout","type":"page","value":"/checkout"},{"label":"Order complete","type":"page","value":"/checkout/complete"}]', 2),
  ('auto-opulence', 'Valet booking', '[{"label":"Visited the website","type":"page","value":"/"},{"label":"Opened booking","type":"page","value":"/booking"},{"label":"Paid","type":"page","value":"/booking/payment-complete"}]', 1)
) as f(slug, name, steps, ord) on f.slug = b.slug
where not exists (select 1 from public.marketing_funnels m where m.business_unit_id = b.id);
