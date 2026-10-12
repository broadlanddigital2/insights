// Insights: website screen recordings for our sites and third-party sites. Runs in Insights' own Supabase project
// (CRM Insights, gbxjvsrgqcomkjxakbso), separate from the CRM. Each site (insight_sites) has a public key and the domains allowed to send to it.
//  POST ?op=chunk        – public: a gzip-compressed chunk from the tracker (t.js / rcg-analytics.js): analytics in its
//                          meta (user, events, page views + web vitals) and, unless replay is off, rrweb events.
//                          Checked against the site's domains and monthly limit, stored as-is in the private
//                          "web-recordings" bucket, and the visit row updated (pages, clicks, errors, forms, ad click).
//  GET  ?asset=t.js      – public: the tracker for any site (<script … data-site="KEY">)
//  GET  ?asset=…         – public: the rrweb recorder / player files (pinned version, served with a JS content type)
//  POST {action:"playback", session_id} – anyone on the site's team: short-lived links to the visit's chunks
//  POST {action:"cleanup"}              – cron (x-insights-secret): deletes recordings past each site's retention
//  POST ?op=import&path=…                – the move from the CRM project (x-insights-secret): stores one recording file
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {tracker} from './tracker.ts';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const BUCKET='web-recordings';
const RRWEB='2.1.7';
const ASSETS:Record<string,[string,string]>={
 'record.js':[`https://cdn.jsdelivr.net/npm/@rrweb/record@${RRWEB}/dist/record.umd.min.cjs`,'application/javascript; charset=utf-8'],
 'player.js':[`https://cdn.jsdelivr.net/npm/rrweb-player@${RRWEB}/dist/rrweb-player.umd.min.cjs`,'application/javascript; charset=utf-8'],
 'player.css':[`https://cdn.jsdelivr.net/npm/rrweb-player@${RRWEB}/dist/style.min.css`,'text/css; charset=utf-8'],
};
const CRM_ORIGINS=['https://insights.racecargraphics.uk','https://insights.justin-b8f.workers.dev','http://localhost:3000'];
const ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')||'';
// Sites by key (cached for a minute per instance).
const siteCache=new Map<string,{at:number,site:any}>();
async function siteFor(key:string,host:string){
 let site:any=null;
 if(UUID.test(key)){const c=siteCache.get(key);if(c&&Date.now()-c.at<60_000)site=c.site;else{const {data}=await admin.from('insight_sites').select('id,domains,is_active,business_unit_id').eq('site_key',key).maybeSingle();site=data;siteCache.set(key,{at:Date.now(),site});}}
 else{const {data}=await admin.from('insight_sites').select('id,domains,is_active,business_unit_id').eq('is_active',true);site=(data||[]).find((s:any)=>hostAllowed(host,s.domains))||null;}
 if(!site||!site.is_active||!hostAllowed(host,site.domains))return null;
 return site;
}
// A site's domains also cover their subdomains (shop.example.com for example.com).
function hostAllowed(host:string,domains:string[]){host=String(host||'').toLowerCase();return (domains||[]).some(d=>{d=String(d).toLowerCase().replace(/^\*\./,'');return host===d||host.endsWith('.'+d)})}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=(v:any,n=300)=>v==null?null:String(v).replace(/\0/g,'').trim().slice(0,n)||null;
const cache=new Map<string,Uint8Array>();

async function gunzip(bytes:Uint8Array){return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}

// The shared secret for scheduled jobs and the CRM bridge (insight_settings.bridge_secret).
async function cronOk(req:Request){
 const t=req.headers.get('x-insights-secret')||req.headers.get('x-quote-cron-token');if(!t)return false;
 const {data}=await admin.from('insight_settings').select('value').eq('name','bridge_secret').maybeSingle();
 return !!data?.value&&t===data.value;
}
async function chunk(req:Request){
 const origin=req.headers.get('origin')||req.headers.get('referer')||'';
 let host='';try{host=new URL(origin).hostname}catch{}
 // Health check from the CRM's scheduler: a base64 chunk in JSON, with the cron token.
 const test=(req.headers.get('x-insights-secret')||req.headers.get('x-quote-cron-token'))&&await cronOk(req);
 if(test)host='racecargraphics.uk';
 const buf=test?Uint8Array.from(atob(String((await req.json().catch(()=>({}))).b64||'')),c=>c.charCodeAt(0)):new Uint8Array(await req.arrayBuffer());
 if(buf.length<20||buf.length>1_500_000)return new Response('Bad size',{status:413});
 let body:any;try{body=JSON.parse(await gunzip(buf));}catch{return new Response('Bad chunk',{status:400});}
 const m=body?.meta||{};
 const sid=String(m.sid||''),seq=Number(m.seq);
 if(!UUID.test(sid)||!Number.isInteger(seq)||seq<0||seq>20000||!Array.isArray(body.events))return new Response('Bad chunk',{status:400});
 if(m.vid&&!UUID.test(String(m.vid)))m.vid=null;
 const site=await siteFor(String(m.site||''),host);
 if(!site)return new Response('Not allowed',{status:403});
 const path=`${site.id}/${sid}/${String(seq).padStart(5,'0')}.json.gz`;
 // Analytics travel in the meta (custom/auto events, page views with timings, the identified user); the rrweb
 // events are the screen recording and are only stored when there are some (data-replay="off" sends none).
 const evs=Array.isArray(m.events)?m.events.slice(0,300):[],pvs=Array.isArray(m.pageviews)?m.pageviews.slice(0,100):[];
 const ts=[...body.events.map((e:any)=>Number(e?.timestamp)),...evs.map((e:any)=>Number(e?.ts)),...pvs.map((p:any)=>Number(p?.ts)),...pvs.map((p:any)=>Number(p?.ts)+Number(p?.duration))].filter((n:number)=>Number.isFinite(n)&&n>1e12);
 const replay=body.events.length>0;
 const user=m.user&&typeof m.user==='object'&&m.user.id?{id:clean(m.user.id,200),email:clean(m.user.email,200),name:clean(m.user.name,200),traits:m.user.traits&&typeof m.user.traits==='object'?m.user.traits:{}}:null;
 const country=clean(req.headers.get('cf-ipcountry'),2);
 const {data:outcome,error}=await admin.rpc('insights_record_chunk',{p:{site_id:site.id,sid,seq,page:Number(m.page)||0,page_start:!!m.page_start,path:clean(m.path),business:clean(m.business,40),host:clean(host,120),vid:m.vid||null,
  referrer:clean(m.referrer),utm_source:clean(m.utm_source,120),utm_medium:clean(m.utm_medium,120),utm_campaign:clean(m.utm_campaign,200),gclid:clean(m.gclid),
  device:clean(m.device,20),browser:clean(m.browser,40),os:clean(m.os,40),screen:clean(m.screen,20),
  browser_version:clean(m.browser_version,20),os_version:clean(m.os_version,20),viewport:clean(m.viewport,20),language:clean(m.language,20),timezone:clean(m.timezone,60),connection:clean(m.connection,30),touch:typeof m.touch==='boolean'?m.touch:null,
  clicks:Math.max(0,Number(m.clicks)||0),rage:Math.max(0,Number(m.rage)||0),errors:Math.max(0,Number(m.errors)||0),warnings:Math.max(0,Number(m.warnings)||0),form:!!m.form,
  first_ts:ts.length?Math.min(...ts):null,last_ts:ts.length?Math.max(...ts):null,storage_path:replay?path:null,bytes:replay?buf.length:0,
  user,events:evs,pageviews:pvs,country:country&&country!=='XX'&&country!=='T1'?country.toUpperCase():null}});
 if(error){console.error('insights_record_chunk',error.message);return new Response('Save error',{status:500});}
 if(outcome==='limit')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','X-Insights':'monthly-limit-reached'}});
 if(!replay)return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*'}});
 const {error:up}=await admin.storage.from(BUCKET).upload(path,buf,{contentType:'application/gzip',upsert:true});
 if(up){console.error('upload',up.message);return new Response('Storage error',{status:500});}
 return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*'}});
}

async function asset(name:string){
 if(name==='t.js')return new Response(await tracker(),{status:200,headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}});
 const a=ASSETS[name];if(!a)return new Response('Not found',{status:404});
 let bytes=cache.get(name);
 if(!bytes){const r=await fetch(a[0]);if(!r.ok)return new Response('Unavailable',{status:502});bytes=new Uint8Array(await r.arrayBuffer());cache.set(name,bytes);}
 return new Response(bytes,{status:200,headers:{'Content-Type':a[1],'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}});
}

// The signed-in person's own view of the data (row level security decides which sites they can see).
function asUser(req:Request){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!token||token.startsWith('sb_'))return null;
 return createClient(SUPABASE_URL,ANON_KEY||SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}});
}

async function cleanup(){
 const empty=new Date(Date.now()-86400000).toISOString();
 let removed=0;
 const {data:sites}=await admin.from('insight_sites').select('id,retention_days,insight_plans(retention_days)');
 const keep=new Map<string,number>((sites||[]).map((s:any)=>[s.id,Number(s.retention_days||s.insight_plans?.retention_days||90)]));
 const oldest=Math.min(30,...keep.values());
 for(let round=0;round<40;round++){
  const {data:cand}=await admin.from('web_sessions').select('id,site_id,started_at,page_count').or(`started_at.lt.${new Date(Date.now()-oldest*86400000).toISOString()},and(page_count.eq.0,started_at.lt.${empty})`).order('started_at').limit(400);
  const old=(cand||[]).filter((r:any)=>r.page_count===0&&r.started_at<empty||!r.site_id||new Date(r.started_at).getTime()<Date.now()-(keep.get(r.site_id)??90)*86400000).slice(0,200);
  if(!old?.length)break;
  const ids=old.map((r:any)=>r.id);
  const {data:chunks}=await admin.from('web_session_chunks').select('storage_path').in('session_id',ids);
  const paths=(chunks||[]).map((c:any)=>c.storage_path);
  for(let i=0;i<paths.length;i+=500)await admin.storage.from(BUCKET).remove(paths.slice(i,i+500));
  await admin.from('web_sessions').delete().in('id',ids);
  removed+=ids.length;
 }
 return removed;
}

Deno.serve(async(req)=>{
 const url=new URL(req.url);
 if(req.method==='GET'&&url.searchParams.get('asset'))return asset(String(url.searchParams.get('asset')));
 if(req.method==='POST'&&url.searchParams.get('op')==='import'){
  if(!await cronOk(req))return new Response('Not allowed',{status:403});
  const path=String(url.searchParams.get('path')||'');
  if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/\d{5}\.json\.gz$/.test(path))return new Response('Bad path',{status:400});
  const {error}=await admin.storage.from(BUCKET).upload(path,new Uint8Array(await req.arrayBuffer()),{contentType:'application/gzip',upsert:true});
  return error?new Response(error.message,{status:500}):new Response('ok');
 }
 if(req.method==='POST'&&url.searchParams.get('op')==='chunk'){try{return await chunk(req)}catch(e){console.error(e);return new Response('Error',{status:500})}}
 const origin=req.headers.get('origin')||'';
 const cors={'Access-Control-Allow-Origin':CRM_ORIGINS.includes(origin)?origin:CRM_ORIGINS[0],'Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info,x-insights-secret','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Vary':'Origin'};
 const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const b=await req.json().catch(()=>({}));
 if(b.action==='cleanup'){
  if(!await cronOk(req))return json({error:'Not allowed'},403);
  return json({ok:true,removed:await cleanup()});
 }
 const db=asUser(req);if(!db)return json({error:'Sign in required'},401);
 try{
  if(b.action==='playback'){
   const id=String(b.session_id||'');if(!UUID.test(id))throw new Error('Unknown visit');
   const {data:visible}=await db.from('web_sessions').select('id').eq('id',id).maybeSingle();if(!visible)throw new Error('You do not have access to this visit.');
   const {data:chunks,error}=await admin.from('web_session_chunks').select('seq,page,storage_path').eq('session_id',id).order('seq');if(error)throw error;
   if(!chunks?.length)throw new Error('This visit has no recording.');
   const {data:signed,error:se}=await admin.storage.from(BUCKET).createSignedUrls(chunks.map((c:any)=>c.storage_path),3600);if(se)throw se;
   return json({ok:true,chunks:chunks.map((c:any,i:number)=>({seq:c.seq,page:c.page,url:signed?.[i]?.signedUrl||null}))});
  }
  return json({error:'Unknown action'},400);
 }catch(e:any){return json({error:String(e?.message||e)},400);}
});
