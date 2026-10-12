# Insights

Real-user monitoring for our websites and clients' websites: visitors and the people behind them, sessions with screen
recordings, events, funnels, metrics, Core Web Vitals and errors. Live at **https://insights.racecargraphics.uk**.

Split out of the Race Car Graphics CRM (`broadlanddigital2/race-car-graphics-crm`) in October 2026. Since 12 October 2026
it has **its own Supabase project, "CRM Insights" (`gbxjvsrgqcomkjxakbso`)**: its own database, logins and storage, so
client websites can never slow the CRM down.

- **Admins:** table `insight_admins` (by email; Insights → Admins). They add websites for anyone, set plans and limits,
  and see every site. Everyone else only sees the websites they're invited to.
- **Any website:** a site has a free-text "client or owner". `crm_businesses` lists our own CRM businesses; linking a site
  to one only matters for our own websites, whose enquiries (leads) link to the visit they came from.
- **The CRM** reaches Insights only through bridge actions on `insights-admin` (shared secret
  `insight_settings.bridge_secret` = CRM `ecommerce_system_secrets.insights_bridge_secret`): `bridge_sso` ("Open in
  Insights"), `bridge_summary` (Marketing → Website) and `bridge_lead` (a website enquiry linked to its visit).
- **Old tracker address:** websites set up before the move load `https://dipjypzrfigkzuarlsov.supabase.co/functions/v1/web-recorder?asset=t.js`.
  That CRM-project function (`supabase/crm-bridge/web-recorder`) passes the tracker through; the tracker itself always
  sends to Insights' project.
- **Error loops:** a site with a JavaScript error loop sends each message at most 3 times a page (25 errors a page) and
  at most 30 errors a visit are stored; all are still counted.

## What's where

| Path | What it is |
| --- | --- |
| `app/page.tsx` | Sign-in, the list of websites you can see, and a site's dashboard (`?site=<id>`). `?add=1` opens "Add a website" for CRM admins. |
| `app/accept/page.tsx` | Where invitation, sign-in and "Open in Insights" links land (`?token_hash=…&type=…&next=/…`). |
| `components/SiteDashboard.tsx` | The dashboard shell (side menu, date range, light/dark), Funnels, Tracking & settings, Team. |
| `components/reports.tsx` | Overview, Events, Web vitals, Errors. |
| `components/people.tsx` | Sessions (with the session timeline) and Users (profiles). |
| `components/metrics.tsx` | Metrics: Web vitals and Website visits dashboards, custom charts. |
| `components/player.tsx` | Screen-recording player (rrweb) with events, console, pages and details. |
| `components/setup.tsx` | Add-a-website wizard, install guide + installation check, multi-person invitations. |
| `components/lib.tsx` | Formatting, people/location labels and the SVG charts. |
| `app/insights.css` | All styles (themes are CSS variables on `.rum` / `.rum.light`). |
| `supabase/functions/web-recorder` | Public: the tracker (`?asset=t.js`), recording/analytics ingestion (`?op=chunk`), rrweb assets, playback links, nightly cleanup. |
| `supabase/functions/web-recorder/tracker.src.js` | Tracker source. After editing run `npm run tracker` (copies it to `public/t.js`, which the function serves). |
| `supabase/functions/insights-admin` | Sites, keys, installation check, invitations/team, sign-in links. |
| `supabase/migrations` | Insights database changes (tables `insight_*`, `web_sessions`, `web_session_chunks`, `marketing_funnels`; report functions `insights_*`). |

## Publishing changes

- **Website (this app):** push to `main`. Cloudflare Workers Builds runs `npm run deploy` (see `CLOUDFLARE_BUILD.txt`).
  GitHub Actions "Validate Insights build" checks the build.
- **Edge functions:** push to `main` with changes under `supabase/functions/` — the "Deploy Supabase edge functions"
  action deploys the changed function(s). Needs the repository secret `SUPABASE_ACCESS_TOKEN`
  (Supabase → Account → Access tokens). Deployed with JWT verification off; each function checks access itself.
- **Database:** apply migrations to the shared project, then save them in `supabase/migrations`.
  Don't change CRM tables from here except the documented links (`leads.web_session_id` and the lead triggers).

## Tracking code

```html
<script src="https://gbxjvsrgqcomkjxakbso.supabase.co/functions/v1/web-recorder?asset=t.js" data-site="SITE KEY" defer></script>
```

Options: `data-consent="auto"` (record without waiting for `Insights.consent(true)`), `data-replay="off"` (analytics only).
API: `Insights.consent(bool)`, `Insights.identify(id, {email, name, …})`, `Insights.track(name, props)`, `Insights.reset()`.
