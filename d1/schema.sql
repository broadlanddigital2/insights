-- Insights database (Cloudflare D1, binding DB). Recordings are in R2 (binding REC): <site>/<session>/<seq>.json.gz
-- Times are ISO 8601 UTC text; "day" (YYYY-MM-DD) and "hour" are the Europe/London date and hour, set when stored.
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plans (key TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_sessions INTEGER, retention_days INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO plans VALUES ('free','Free',1000,30,1),('starter','Starter',10000,90,2),('pro','Pro',50000,180,3),('internal','Internal (unlimited)',NULL,90,9);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT, first_name TEXT, last_name TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS login_tokens (id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL, next TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_name TEXT, domains TEXT NOT NULL DEFAULT '[]', site_key TEXT NOT NULL UNIQUE,
  business_unit_id TEXT, plan TEXT NOT NULL DEFAULT 'starter', session_limit INTEGER, retention_days INTEGER,
  consent_mode TEXT NOT NULL DEFAULT 'wait', is_active INTEGER NOT NULL DEFAULT 1, max_errors INTEGER NOT NULL DEFAULT 50,
  replay_sample INTEGER NOT NULL DEFAULT 100, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_members (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE, user_id TEXT, role TEXT NOT NULL DEFAULT 'viewer',
  invited_by TEXT, invited_at TEXT NOT NULL, accepted_at TEXT, UNIQUE(site_id, email));
CREATE INDEX IF NOT EXISTS site_members_user ON site_members(user_id);

CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, host TEXT, visitor_id TEXT, started_at TEXT NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL,
  last_seen_at TEXT NOT NULL, first_ts INTEGER, last_ts INTEGER, duration_ms INTEGER NOT NULL DEFAULT 0, page_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0, rage_clicks INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0,
  paths TEXT NOT NULL DEFAULT '[]', landing_path TEXT, exit_path TEXT, referrer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, gclid TEXT,
  device TEXT, browser TEXT, os TEXT, screen TEXT, browser_version TEXT, os_version TEXT, viewport TEXT, language TEXT, timezone TEXT, connection TEXT, touch INTEGER,
  country TEXT, form_submitted INTEGER NOT NULL DEFAULT 0, form_at TEXT, chunk_count INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  lead_id TEXT, user_key TEXT, user_email TEXT, user_name TEXT, legacy INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS web_sessions_site_started ON web_sessions(site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS web_sessions_site_day ON web_sessions(site_id, day);
CREATE INDEX IF NOT EXISTS web_sessions_site_user ON web_sessions(site_id, user_key, started_at DESC);

CREATE TABLE IF NOT EXISTS chunks (session_id TEXT NOT NULL, seq INTEGER NOT NULL, page INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  first_ts INTEGER, last_ts INTEGER, legacy_path TEXT, PRIMARY KEY (session_id, seq));

CREATE TABLE IF NOT EXISTS insight_users (
  site_id TEXT NOT NULL, user_key TEXT NOT NULL, external_id TEXT, email TEXT, name TEXT, traits TEXT NOT NULL DEFAULT '{}',
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, sessions INTEGER NOT NULL DEFAULT 0, pageviews INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0, last_device TEXT, last_browser TEXT, last_os TEXT, timezone TEXT, first_source TEXT, first_path TEXT, merged_into TEXT,
  PRIMARY KEY (site_id, user_key));
CREATE INDEX IF NOT EXISTS insight_users_last_seen ON insight_users(site_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS insight_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL, session_id TEXT NOT NULL, user_key TEXT, name TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}',
  path TEXT, pageview_id TEXT, ts TEXT NOT NULL, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS insight_events_site_day ON insight_events(site_id, day, name);
CREATE INDEX IF NOT EXISTS insight_events_session ON insight_events(session_id, ts);
CREATE INDEX IF NOT EXISTS insight_events_user ON insight_events(site_id, user_key, ts DESC);

CREATE TABLE IF NOT EXISTS insight_pageviews (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, session_id TEXT NOT NULL, user_key TEXT, path TEXT, url TEXT, title TEXT, referrer TEXT, ts TEXT NOT NULL, day TEXT NOT NULL,
  duration_ms INTEGER, scroll INTEGER, ttfb INTEGER, fcp INTEGER, lcp INTEGER, cls REAL, inp INTEGER, load_ms INTEGER, dom_ms INTEGER, heap_mb REAL,
  device TEXT, browser TEXT, os TEXT);
CREATE INDEX IF NOT EXISTS insight_pageviews_site_day ON insight_pageviews(site_id, day);
CREATE INDEX IF NOT EXISTS insight_pageviews_session ON insight_pageviews(session_id, ts);

CREATE TABLE IF NOT EXISTS marketing_funnels (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', count_by TEXT NOT NULL DEFAULT 'sessions',
  sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS insight_charts (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, title TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
