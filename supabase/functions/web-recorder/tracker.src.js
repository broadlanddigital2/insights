// Insights tracker v2 — visits, users, events, page performance, errors and screen recordings for any website.
// Source for tracker.ts (served as web-recorder?asset=t.js). After editing, regenerate tracker.ts:
//   python3 -c "import json;open('tracker.ts','w').write('export const TRACKER = '+json.dumps(open('tracker.src.js').read())+';\n')"
//
// <script src="https://gbxjvsrgqcomkjxakbso.supabase.co/functions/v1/web-recorder?asset=t.js" data-site="SITE KEY" defer></script>
//   data-consent="wait" (default)  nothing is recorded until Insights.consent(true) (call it from your cookie banner)
//   data-consent="auto"            records straight away (the site owner is responsible for consent)
//   data-replay="off"              analytics, events and performance only — no screen recording
// API:  Insights.consent(true|false)   Insights.identify(id, {email, name, ...})   Insights.track(name, {props})
//       Insights.reset() (on sign-out)  Insights.visitId()  Insights.visitorId()
// Calls made before the script loads can be queued: window.insightsQ = window.insightsQ || []; insightsQ.push(["track", "x", {}]);
// Privacy: typing is always hidden; data-private hides an element's text; data-no-record leaves an element out.
(function () {
  var SCRIPT = document.currentScript;
  var SITE = SCRIPT && SCRIPT.getAttribute("data-site");
  var CONSENT_MODE = (SCRIPT && SCRIPT.getAttribute("data-consent")) || "wait";
  var REPLAY = !SCRIPT || SCRIPT.getAttribute("data-replay") !== "off";
  if (!SITE || window.__insights) return; window.__insights = true;
  // Insights has its own Supabase project; older snippets load this file from the CRM project's address, so always
  // send to (and load the recorder from) Insights' own.
  var REC = "https://gbxjvsrgqcomkjxakbso.supabase.co/functions/v1/web-recorder";
  var TRACK = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  var IDLE = 30 * 60 * 1000, FLUSH_MS = 10000;

  function get(k, store) { try { return JSON.parse((store || localStorage).getItem(k) || "null"); } catch (e) { return null; } }
  function put(k, v, store) { try { (store || localStorage).setItem(k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, function (c) { return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16); }); }
  function cookie(n, v, days) { document.cookie = n + "=" + encodeURIComponent(v) + "; Max-Age=" + days * 86400 + "; Path=/; SameSite=Lax; Secure"; }
  function now() { return Date.now(); }
  function clip(v, n) { return v == null ? null : String(v).slice(0, n || 300); }
  function consent() { return CONSENT_MODE === "auto" || get("ins-consent") === true; }

  // ---------- ad click (landing address) ----------
  try {
    var q = new URLSearchParams(location.search), found = {};
    TRACK.forEach(function (k) { var v = q.get(k); if (v) found[k] = v.slice(0, 300); });
    if (Object.keys(found).length) { found.landing = location.pathname; found.at = now(); put("ins-ad-pending", found, sessionStorage); }
  } catch (e) {}
  function adClick() { var a = get("ins-ad-click"); return a && now() - a.at < 90 * 864e5 ? a : null; }

  // ---------- environment ----------
  var UA = navigator.userAgent;
  function device() { var w = Math.min(screen.width, screen.height); return /iPad|Tablet/i.test(UA) || (w >= 600 && /Android/i.test(UA) && !/Mobile/i.test(UA)) ? "tablet" : /Mobi|Android|iPhone/i.test(UA) ? "mobile" : "desktop"; }
  function browser() { return /Edg\//.test(UA) ? "Edge" : /OPR\//.test(UA) ? "Opera" : /SamsungBrowser/.test(UA) ? "Samsung" : /CriOS|Chrome\//.test(UA) ? "Chrome" : /FxiOS|Firefox\//.test(UA) ? "Firefox" : /Safari\//.test(UA) ? "Safari" : "Other"; }
  function os() { return /iPhone|iPad|iPod/.test(UA) ? "iOS" : /Android/.test(UA) ? "Android" : /Windows/.test(UA) ? "Windows" : /Mac OS X/.test(UA) ? "macOS" : /CrOS/.test(UA) ? "ChromeOS" : /Linux/.test(UA) ? "Linux" : "Other"; }
  function browserVersion() { var m = UA.match(/(?:Edg|OPR|SamsungBrowser|CriOS|FxiOS|Chrome|Firefox|Version)\/(\d+(?:\.\d+)?)/); return m ? m[1] : null; }
  function osVersion() { var m = UA.match(/(?:iPhone OS|CPU OS|Android|Windows NT|Mac OS X) ([\d._]+)/); return m ? m[1].replace(/_/g, ".") : null; }
  function connection() { var c = navigator.connection; return c ? [c.effectiveType, c.saveData ? "data saver" : ""].filter(Boolean).join(" ") : null; }
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; } }

  // ---------- state ----------
  var started = false, state = null, rrweb = [], queue = [], pages = {}, pageStart = true, newSession = false, user = get("ins-user");
  var counters = { clicks: 0, rage: 0, errors: 0, warnings: 0, form: false };
  var current = null; // the current page view
  var recordFn = null, consoleCount = 0, earlyConsole = [], lastClicks = [], errSeen = {}, errSent = 0;

  function event(name, props) {
    if (!started) return;
    queue.push({ name: clip(name, 80), props: props || {}, path: location.pathname, ts: now(), pv: current && current.id });
    if (queue.length > 200) flush();
  }

  // ---------- page views and performance ----------
  function newPage() {
    if (current) closePage();
    current = { id: uuid(), path: location.pathname, url: clip(location.href, 1000), title: clip(document.title, 200), ts: now(), referrer: clip(document.referrer, 500), scroll: 0, vitals: {}, sent: false };
    pages[current.id] = current; vitalsFor(current);
  }
  function closePage() { if (!current) return; current.duration = now() - current.ts; current.closed = true; }
  function scrollPct() { var h = document.documentElement, b = document.body; var max = Math.max(h.scrollHeight, b ? b.scrollHeight : 0) - innerHeight; return max <= 0 ? 100 : Math.min(100, Math.round((scrollY / max) * 100)); }
  addEventListener("scroll", function () { if (current) current.scroll = Math.max(current.scroll, scrollPct()); }, { passive: true });
  function vitalsFor(pv) {
    var v = pv.vitals;
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav && pv === pages[Object.keys(pages)[0]]) {
        v.ttfb = Math.round(nav.responseStart); v.dom = Math.round(nav.domContentLoadedEventEnd || 0) || null;
        var setLoad = function () { var n = performance.getEntriesByType("navigation")[0]; if (n && n.loadEventEnd) v.load = Math.round(n.loadEventEnd); };
        if (document.readyState === "complete") setLoad(); else addEventListener("load", function () { setTimeout(setLoad, 0); });
      }
    } catch (e) {}
    try { var fcp = performance.getEntriesByName("first-contentful-paint")[0]; if (fcp) v.fcp = Math.round(fcp.startTime); } catch (e) {}
  }
  try {
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.name === "first-contentful-paint" && current) current.vitals.fcp = Math.round(e.startTime); }); }).observe({ type: "paint", buffered: true });
    new PerformanceObserver(function (l) { var es = l.getEntries(), e = es[es.length - 1]; if (e && current) current.vitals.lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput && current) current.vitals.cls = Math.round(((current.vitals.cls || 0) + e.value) * 1000) / 1000; }); }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.interactionId && current) current.vitals.inp = Math.max(current.vitals.inp || 0, Math.round(e.duration)); }); }).observe({ type: "event", buffered: true, durationThreshold: 40 });
  } catch (e) {}
  function memory() { try { return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null; } catch (e) { return null; } }
  function pageRows() {
    var out = [];
    Object.keys(pages).forEach(function (id) {
      var p = pages[id], v = p.vitals;
      var sig = JSON.stringify([v, p.scroll, p.closed]);
      if (p.sig === sig && p.sent) return; p.sig = sig; p.sent = true;
      out.push({ id: p.id, path: p.path, url: p.url, title: p.title, referrer: p.referrer, ts: p.ts, duration: p.closed ? p.duration : now() - p.ts, scroll: p.scroll,
        ttfb: v.ttfb, fcp: v.fcp, lcp: v.lcp, cls: v.cls, inp: v.inp, load: v.load, dom: v.dom, heap: memory() });
      if (p.closed) delete pages[id];
    });
    return out;
  }

  // ---------- console, errors, failed requests ----------
  function text(v) { try { if (v instanceof Error) return v.name + ": " + v.message; if (typeof v === "string") return v; return JSON.stringify(v, function (k, x) { return typeof x === "function" ? "[function]" : (typeof Node !== "undefined" && x instanceof Node) ? "<" + (x.nodeName || "node").toLowerCase() + ">" : x; }); } catch (e) { return String(v); } }
  function logConsole(level, args, trace) {
    if (consoleCount > 300) return; consoleCount++;
    var message = Array.prototype.map.call(args, text).join(" ").slice(0, 2000);
    if (level === "error" || level === "network") {
      counters.errors++;
      // A page stuck in an error loop: send each message a few times and at most 25 errors a page (all are counted).
      var key = message.slice(0, 200); errSeen[key] = (errSeen[key] || 0) + 1;
      if (errSeen[key] <= 3 && errSent < 25) { errSent++; event("$error", { level: level, message: message.slice(0, 500), trace: trace ? String(trace).slice(0, 1500) : null }); }
    }
    else if (level === "warn") counters.warnings++;
    var payload = { level: level, message: message, trace: trace ? String(trace).slice(0, 2000) : null, url: location.pathname };
    var add = recordFn && recordFn.addCustomEvent;
    if (add) { try { add("console", payload); } catch (e) {} } else if (earlyConsole.length < 50) earlyConsole.push(payload);
  }
  function hookConsole() {
    ["error", "warn", "info", "log", "debug"].forEach(function (level) {
      var orig = console[level]; if (!orig || orig.__ins) return;
      var wrapped = function () { try { logConsole(level, arguments, level === "error" ? (new Error().stack || "").split("\n").slice(2, 7).join("\n") : null); } catch (e) {} return orig.apply(this, arguments); };
      wrapped.__ins = true; console[level] = wrapped;
    });
    addEventListener("error", function (e) {
      if (e && e.target && e.target !== window && (e.target.src || e.target.href)) { logConsole("network", ["Failed to load " + (e.target.tagName || "").toLowerCase() + ": " + (e.target.src || e.target.href)]); return; }
      logConsole("error", [(e && e.message) || "Script error", e && e.filename ? "(" + e.filename + ":" + e.lineno + ":" + e.colno + ")" : ""], e && e.error && e.error.stack);
    }, true);
    addEventListener("unhandledrejection", function (e) { var r = e && e.reason; logConsole("error", ["Unhandled promise rejection:", r && r.message ? r.message : r], r && r.stack); });
    if (window.fetch && !window.fetch.__ins) {
      var of = window.fetch, wf = function (input, init) {
        var url = typeof input === "string" ? input : input && input.url, method = (init && init.method) || (input && input.method) || "GET";
        return of.apply(this, arguments).then(function (res) { if (res.status >= 400 && String(url).indexOf("web-recorder") < 0) logConsole("network", [method + " " + url + " → " + res.status]); return res; },
          function (err) { if (String(url).indexOf("web-recorder") < 0) logConsole("network", [method + " " + url + " failed: " + (err && err.message)]); throw err; });
      };
      wf.__ins = true; window.fetch = wf;
    }
  }

  // ---------- clicks, forms, navigation ----------
  function describe(el) {
    if (!el || !el.tagName) return {};
    var t = el.closest ? el.closest("a,button,[role=button],input[type=submit],input[type=button],label,summary") || el : el;
    if (t.closest && t.closest("[data-no-record],[data-private]")) return { tag: t.tagName.toLowerCase(), text: null };
    var txt = (t.innerText || t.value || t.getAttribute("aria-label") || t.title || "").trim().replace(/\s+/g, " ").slice(0, 80);
    return { tag: t.tagName.toLowerCase(), text: txt || null, id: t.id || null, href: t.href ? clip(t.href, 300) : null, cls: typeof t.className === "string" ? t.className.split(/\s+/).slice(0, 3).join(" ") : null };
  }
  addEventListener("click", function (ev) {
    if (!started) return;
    var d = describe(ev.target); counters.clicks++;
    var t = now(); lastClicks = lastClicks.filter(function (x) { return t - x.t < 1000 && Math.abs(x.x - ev.clientX) < 40 && Math.abs(x.y - ev.clientY) < 40; });
    lastClicks.push({ t: t, x: ev.clientX, y: ev.clientY });
    if (lastClicks.length === 3) { counters.rage++; event("$rage_click", d); }
    event("$click", d);
    if (d.href) { try { var u = new URL(d.href); if (u.host && u.host !== location.host && /^https?:/.test(u.protocol)) event("$outbound", { href: d.href, text: d.text }); if (/\.(pdf|zip|docx?|xlsx?|csv|mp4)(\?|$)/i.test(u.pathname)) event("$download", { href: d.href }); } catch (e) {} if (/^mailto:/.test(d.href)) event("$email_click", { href: d.href }); if (/^tel:/.test(d.href)) event("$phone_click", { href: d.href }); }
  }, true);
  document.addEventListener("submit", function (ev) {
    var f = ev.target; if (!f || f.tagName !== "FORM") return;
    var add = function (n, v) { if (!v || f.querySelector('input[name="' + n + '"]')) return; var i = document.createElement("input"); i.type = "hidden"; i.name = n; i.value = v; f.appendChild(i); };
    var a = adClick(); if (a) TRACK.forEach(function (k) { add(k, a[k]); });
    if (!state) return;
    add("insights_visit", state.sid);
    counters.form = true;
    event("$form_submit", { id: f.id || null, name: f.getAttribute("name") || null, action: clip(f.getAttribute("action"), 200), fields: f.elements ? f.elements.length : null });
    flush(true);
  }, true);
  // Single-page apps: count each route change as a page view.
  ["pushState", "replaceState"].forEach(function (m) {
    var o = history[m]; if (!o) return;
    history[m] = function () { var before = location.pathname; var r = o.apply(this, arguments); if (started && location.pathname !== before) { newPage(); event("$pageview", { title: document.title }); } return r; };
  });
  addEventListener("popstate", function () { if (started && current && location.pathname !== current.path) { newPage(); event("$pageview", { title: document.title }); } });

  // ---------- sending ----------
  function flush(final) {
    if (!state || typeof CompressionStream === "undefined") return;
    var pv = pageRows();
    if (!rrweb.length && !queue.length && !pv.length && !counters.form) return;
    var events = rrweb; rrweb = []; var evs = queue; queue = [];
    var s = get("ins-rec") || state; var seq = s.seq || 0; s.seq = seq + 1; s.last = now(); put("ins-rec", s); state = s;
    var a = adClick() || {};
    var meta = { site: SITE, sid: s.sid, vid: get("ins-vid"), seq: seq, page: s.page, page_start: pageStart, path: location.pathname,
      referrer: newSession ? clip(document.referrer, 500) : null,
      utm_source: a.utm_source || (a.gclid ? "google" : a.fbclid ? "facebook" : a.msclkid ? "bing" : null), utm_medium: a.utm_medium || (a.gclid || a.msclkid || a.fbclid ? "cpc" : null), utm_campaign: a.utm_campaign || null, gclid: a.gclid || a.gbraid || a.wbraid || null,
      device: device(), browser: browser(), os: os(), screen: screen.width + "x" + screen.height,
      browser_version: browserVersion(), os_version: osVersion(), viewport: innerWidth + "x" + innerHeight, language: navigator.language || null,
      timezone: tz(), connection: connection(), touch: navigator.maxTouchPoints > 0,
      clicks: counters.clicks, rage: counters.rage, errors: counters.errors, warnings: counters.warnings, form: counters.form,
      user: user, events: evs, pageviews: pv, replay: REPLAY };
    pageStart = false; newSession = false; counters = { clicks: 0, rage: 0, errors: 0, warnings: 0, form: false };
    var body = new Blob([JSON.stringify({ meta: meta, events: events })]).stream().pipeThrough(new CompressionStream("gzip"));
    new Response(body).arrayBuffer().then(function (gz) {
      var small = gz.byteLength < 60000;
      if (final && small && navigator.sendBeacon) { navigator.sendBeacon(REC + "?op=chunk", new Blob([gz])); return; }
      fetch(REC + "?op=chunk", { method: "POST", body: gz, mode: "no-cors", keepalive: small, credentials: "omit" }).catch(function () {});
    });
  }

  // ---------- start ----------
  function start() {
    if (started || !consent() || navigator.webdriver) return; started = true;
    var pend = get("ins-ad-pending", sessionStorage);
    if (pend) { put("ins-ad-click", pend); var qs = {}; TRACK.forEach(function (k) { if (pend[k]) qs[k] = pend[k]; }); cookie("ins_ad", new URLSearchParams(qs).toString(), 90); try { sessionStorage.removeItem("ins-ad-pending"); } catch (e) {} }
    if (!get("ins-vid")) put("ins-vid", uuid());
    var t = now(), s = get("ins-rec");
    if (!s || t - (s.last || 0) > IDLE) { s = { sid: uuid(), seq: 0, page: 0 }; newSession = true; } else { s.page = (s.page || 0) + 1; }
    s.last = t; put("ins-rec", s); state = s; cookie("ins_sid", s.sid, 1);
    hookConsole();
    newPage(); event("$pageview", { title: document.title });
    if (REPLAY) {
      var sc = document.createElement("script"); sc.src = REC + "?asset=record.js"; sc.async = true; sc.crossOrigin = "anonymous";
      sc.onload = function () {
        var r = window.rrwebRecord; if (!r) return; var record = r.record || r; if (!record.addCustomEvent && r.addCustomEvent) record.addCustomEvent = r.addCustomEvent; recordFn = record;
        record({ emit: function (e) { rrweb.push(e); if (rrweb.length > 400) flush(); },
          maskAllInputs: true, maskTextSelector: "[data-private]", blockSelector: "[data-no-record]",
          sampling: { mousemove: 100, scroll: 150, input: "last", media: 800 }, slimDOMOptions: "all", recordCanvas: false, collectFonts: false, inlineImages: false });
        earlyConsole.splice(0).forEach(function (p) { try { record.addCustomEvent("console", p); } catch (e) {} });
      };
      document.head.appendChild(sc);
    }
    setInterval(function () { flush(); }, FLUSH_MS);
    setTimeout(function () { flush(); }, 3000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(true); });
    addEventListener("pagehide", function () { closePage(); flush(true); });
    runQueue();
  }

  // ---------- public API ----------
  var api = {
    consent: function (yes) { put("ins-consent", !!yes); if (yes) start(); },
    identify: function (id, traits) {
      if (id == null || id === "") return; traits = traits || {};
      user = { id: clip(id, 200), email: clip(traits.email, 200), name: clip(traits.name || [traits.first_name, traits.last_name].filter(Boolean).join(" "), 200), traits: traits };
      put("ins-user", user); event("$identify", { id: user.id }); flush();
    },
    track: function (name, props) { if (name) event(String(name), props && typeof props === "object" ? props : {}); },
    reset: function () { event("$reset", {}); flush(); user = null; del("ins-user"); put("ins-vid", uuid()); },
    visitId: function () { return state && state.sid; },
    visitorId: function () { return get("ins-vid"); },
    adClick: adClick
  };
  window.Insights = api;
  function runQueue() { var q = window.insightsQ; if (q && q.length) { q.splice(0).forEach(function (c) { try { api[c[0]] && api[c[0]].apply(null, c.slice(1)); } catch (e) {} }); } window.insightsQ = { push: function (c) { try { api[c[0]] && api[c[0]].apply(null, c.slice(1)); } catch (e) {} } }; }
  addEventListener("insights:consent", function () { api.consent(true); });
  if (consent()) start(); else runQueue();
})();
