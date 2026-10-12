// A small fetch-only stand-in for the parts of supabase-js these functions use (PostgREST queries, rpc, auth admin,
// storage). No remote imports, so the functions deploy without the bundler fetching packages.
type Res = { data: any; error: any; count?: number | null };
const err = async (r: Response) => { const t = await r.text(); try { const j = JSON.parse(t); return { message: j.message || j.msg || j.error_description || j.error || t, ...j }; } catch { return { message: t || r.statusText, status: r.status }; } };

class Query implements PromiseLike<Res> {
  private p = new URLSearchParams(); private method = 'GET'; private body: any; private prefer: string[] = [];
  private mode: '' | 'single' | 'maybe' = ''; private head = false; private wantCount = false;
  constructor(private c: Client, private table: string) {}
  select(cols = '*', o: { count?: string; head?: boolean } = {}) {
    this.p.set('select', cols);
    if (this.method !== 'GET') this.prefer.push('return=representation');
    if (o.count) { this.prefer.push('count=' + o.count); this.wantCount = true; }
    if (o.head) this.head = true;
    return this;
  }
  insert(rows: any) { this.method = 'POST'; this.body = rows; return this; }
  upsert(rows: any, o: { onConflict?: string } = {}) { this.method = 'POST'; this.body = rows; this.prefer.push('resolution=merge-duplicates'); if (o.onConflict) this.p.set('on_conflict', o.onConflict); return this; }
  update(patch: any) { this.method = 'PATCH'; this.body = patch; return this; }
  delete() { this.method = 'DELETE'; return this; }
  private f(c: string, op: string, v: any) { this.p.append(c, op + '.' + v); return this; }
  eq(c: string, v: any) { return this.f(c, 'eq', v); }
  neq(c: string, v: any) { return this.f(c, 'neq', v); }
  gt(c: string, v: any) { return this.f(c, 'gt', v); }
  gte(c: string, v: any) { return this.f(c, 'gte', v); }
  lt(c: string, v: any) { return this.f(c, 'lt', v); }
  lte(c: string, v: any) { return this.f(c, 'lte', v); }
  ilike(c: string, v: any) { return this.f(c, 'ilike', v); }
  is(c: string, v: any) { return this.f(c, 'is', v === null ? 'null' : v); }
  in(c: string, vs: any[]) { return this.f(c, 'in', '(' + vs.map((v) => '"' + String(v).replace(/"/g, '\\"') + '"').join(',') + ')'); }
  or(s: string) { this.p.append('or', '(' + s + ')'); return this; }
  order(c: string, o: { ascending?: boolean } = {}) { const prev = this.p.get('order'); const v = c + '.' + (o.ascending === false ? 'desc' : 'asc'); this.p.set('order', prev ? prev + ',' + v : v); return this; }
  limit(n: number) { this.p.set('limit', String(n)); return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  async run(): Promise<Res> {
    const h: Record<string, string> = { ...this.c.headers, 'Content-Type': 'application/json' };
    if (this.prefer.length) h['Prefer'] = this.prefer.join(',');
    if (this.mode === 'single') h['Accept'] = 'application/vnd.pgrst.object+json';
    const r = await fetch(this.c.url + '/rest/v1/' + this.table + '?' + this.p.toString(), { method: this.head ? 'HEAD' : this.method, headers: h, body: this.body === undefined ? undefined : JSON.stringify(this.body) });
    let count: number | null = null;
    if (this.wantCount) { const m = /\/(\d+)$/.exec(r.headers.get('content-range') || ''); count = m ? Number(m[1]) : null; }
    if (!r.ok) return { data: null, error: await err(r), count };
    if (this.head) return { data: null, error: null, count };
    const t = await r.text(); let data: any = t ? JSON.parse(t) : null;
    if (this.mode === 'maybe') { if (Array.isArray(data)) data = data[0] ?? null; }
    return { data, error: null, count };
  }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, no?: ((e: any) => B | PromiseLike<B>) | null) { return this.run().then(ok, no); }
}

class Bucket {
  constructor(private c: Client, private b: string) {}
  async upload(path: string, bytes: Uint8Array | Blob, o: { contentType?: string; upsert?: boolean } = {}) {
    const r = await fetch(this.c.url + '/storage/v1/object/' + this.b + '/' + path, { method: 'POST', headers: { ...this.c.headers, 'Content-Type': o.contentType || 'application/octet-stream', 'x-upsert': o.upsert ? 'true' : 'false' }, body: bytes });
    return r.ok ? { data: await r.json().catch(() => ({})), error: null } : { data: null, error: await err(r) };
  }
  async remove(paths: string[]) {
    const r = await fetch(this.c.url + '/storage/v1/object/' + this.b, { method: 'DELETE', headers: { ...this.c.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
    return r.ok ? { data: await r.json().catch(() => []), error: null } : { data: null, error: await err(r) };
  }
  async createSignedUrls(paths: string[], expiresIn: number) {
    const r = await fetch(this.c.url + '/storage/v1/object/sign/' + this.b, { method: 'POST', headers: { ...this.c.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn, paths }) });
    if (!r.ok) return { data: null, error: await err(r) };
    const list = await r.json();
    return { data: list.map((x: any) => ({ path: x.path, error: x.error || null, signedUrl: x.signedURL ? this.c.url + '/storage/v1' + x.signedURL : null })), error: null };
  }
  async download(path: string) {
    const r = await fetch(this.c.url + '/storage/v1/object/' + this.b + '/' + path, { headers: this.c.headers });
    return r.ok ? { data: await r.blob(), error: null } : { data: null, error: await err(r) };
  }
}

const linkOut = (j: any) => { const { action_link, email_otp, hashed_token, redirect_to, verification_type, ...user } = j || {}; return { properties: { action_link, email_otp, hashed_token, redirect_to, verification_type }, user }; };

export class Client {
  headers: Record<string, string>;
  constructor(public url: string, key: string, o: { global?: { headers?: Record<string, string> } } = {}) {
    this.url = url.replace(/\/$/, '');
    this.headers = { apikey: key, Authorization: 'Bearer ' + key, ...(o.global?.headers || {}) };
  }
  from(t: string) { return new Query(this, t); }
  async rpc(fn: string, args: any = {}): Promise<Res> {
    const r = await fetch(this.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { ...this.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!r.ok) return { data: null, error: await err(r) };
    const t = await r.text(); return { data: t ? JSON.parse(t) : null, error: null };
  }
  storage = { from: (b: string) => new Bucket(this, b) };
  private async gt(path: string, method = 'GET', body?: any, auth?: string) {
    const h: Record<string, string> = { ...this.headers, 'Content-Type': 'application/json' };
    if (auth) h['Authorization'] = 'Bearer ' + auth;
    const r = await fetch(this.url + '/auth/v1' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return r.ok ? { j: await r.json().catch(() => ({})), error: null } : { j: null, error: await err(r) };
  }
  auth = {
    getUser: async (jwt: string) => { const { j, error } = await this.gt('/user', 'GET', undefined, jwt); return { data: { user: error ? null : j }, error }; },
    admin: {
      generateLink: async (o: { type: string; email: string; options?: { data?: any; redirectTo?: string } }) => {
        const { j, error } = await this.gt('/admin/generate_link', 'POST', { type: o.type, email: o.email, data: o.options?.data, redirect_to: o.options?.redirectTo });
        return error ? { data: null as any, error } : { data: linkOut(j), error: null };
      },
      createUser: async (o: any) => { const { j, error } = await this.gt('/admin/users', 'POST', o); return { data: { user: j }, error }; },
      listUsers: async (o: { page?: number; perPage?: number } = {}) => { const { j, error } = await this.gt('/admin/users?page=' + (o.page || 1) + '&per_page=' + (o.perPage || 50)); return { data: { users: j?.users || [] }, error }; },
      updateUserById: async (id: string, attrs: any) => { const { j, error } = await this.gt('/admin/users/' + id, 'PUT', attrs); return { data: { user: j }, error }; },
    },
  };
}
export function createClient(url: string, key: string, o: any = {}) { return new Client(url, key, o); }
