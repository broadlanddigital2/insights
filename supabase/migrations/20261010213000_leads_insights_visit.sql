-- Leads: the Insights tracker (t.js) adds the visit as "insights_visit" to every form; the older RCG tracker used
-- "rcg_session". When a lead is linked to a visit, the visitor's Insights profile gets the lead's name and email,
-- so the person shows by name in Users and Sessions.
create or replace function private.leads_capture_ad_click()
returns trigger language plpgsql set search_path = '' as $function$
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
    begin new.web_session_id := nullif(coalesce(p->>'insights_visit', flds->>'insights_visit', p->>'rcg_session', flds->>'rcg_session',
                                                substring(u from '[?&]insights_visit=([0-9a-fA-F-]{36})'), substring(u from '[?&]rcg_session=([0-9a-fA-F-]{36})')), '')::uuid;
    exception when others then new.web_session_id := null; end;
  end if;
  return new;
end $function$;

create or replace function private.leads_link_web_session()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare s public.web_sessions; nm text;
begin
  if new.web_session_id is not null then
    update public.web_sessions set lead_id = new.id where id = new.web_session_id and lead_id is null returning * into s;
    if s.id is not null and s.user_key is not null and s.site_id is not null then
      nm := nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '');
      update public.insight_users set email = coalesce(email, nullif(lower(trim(new.email)), '')), name = coalesce(name, nm),
             traits = traits || jsonb_strip_nulls(jsonb_build_object('lead', true, 'phone', nullif(new.phone, '')))
       where site_id = s.site_id and user_key = s.user_key;
      update public.web_sessions set user_email = coalesce(user_email, nullif(lower(trim(new.email)), '')), user_name = coalesce(user_name, nm)
       where site_id = s.site_id and user_key = s.user_key;
    end if;
  end if;
  return new;
end $function$;
