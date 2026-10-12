# Insights

Real-user monitoring for our websites and clients' websites: visitors and the people behind them, sessions with screen
recordings, events, funnels, metrics, Core Web Vitals and errors. Live at **https://insights.racecargraphics.uk**.

Split out of the Race Car Graphics CRM (`broadlanddigital2/race-car-graphics-crm`) in October 2026 so it can be updated
on its own. It still shares the CRM's Supabase project (`dipjypzrfigkzuarlsov`), but runs on its own:

- **Its own admins:** table `insight_admins` (managed in Insights → Admins), not CRM roles. Admins add websites for
  anyone, set plans and limits, and see every site. It was seeded with the CRM admins in October 2026.
- **Its own logins:** people invited from Insights get a login marked `app_metadata.insights_only`; the CRM refuses
  those logins. Each person can change their name and password under their email address (top right).
- **Any website:** a site has a free-text "client or owner"; linking it to a CRM business is optional and only used for
  our own websites, so their enquiries (leads) link to the visit they came from.

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
| `supabase/functions/web-recorder/tracker.src.js` | Tracker source. After editing run `npm run tracker` to regenerate `tracker.ts`. |
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
<script src="https://dipjypzrfigkzuarlsov.supabase.co/functions/v1/web-recorder?asset=t.js" data-site="SITE KEY" defer></script>
```

Options: `data-consent="auto"` (record without waiting for `Insights.consent(true)`), `data-replay="off"` (analytics only).
API: `Insights.consent(bool)`, `Insights.identify(id, {email, name, …})`, `Insights.track(name, props)`, `Insights.reset()`.
