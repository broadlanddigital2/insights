// The tracker is served by the Insights app (public/t.js, from tracker.src.js via `npm run tracker`), so it can be
// updated without redeploying this function. Loaded once per instance.
export const TRACKER_URL = 'https://insights.racecargraphics.uk/t.js';
let cached: { at: number; text: string } | null = null;
export async function tracker(): Promise<string> {
  if (cached && Date.now() - cached.at < 300_000) return cached.text;
  const r = await fetch(TRACKER_URL, { cf: { cacheTtl: 300 } } as any);
  if (!r.ok) { if (cached) return cached.text; throw new Error('Tracker unavailable'); }
  cached = { at: Date.now(), text: await r.text() };
  return cached.text;
}
