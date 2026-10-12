// CRM project (dipjypzrfigkzuarlsov) stand-in for Insights' web-recorder, which now lives in Insights' own project.
// Websites installed before the move load the tracker from this address, so:
//  GET ?asset=…    – passed through from Insights' own web-recorder (the tracker sends straight to Insights)
//  POST ?op=chunk  – forwarded to Insights (trackers cached from before the move); nothing is stored here
const INSIGHTS='https://gbxjvsrgqcomkjxakbso.supabase.co/functions/v1/web-recorder';
const CRM=Deno.env.get('SUPABASE_URL')||'',KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const H={apikey:KEY,Authorization:'Bearer '+KEY};
async function secret(){const r=await fetch(CRM+'/rest/v1/ecommerce_system_secrets?select=secret_value&secret_name=eq.insights_bridge_secret',{headers:H});const j=await r.json().catch(()=>[]);return j?.[0]?.secret_value||'';}
// One-off move of the recording files into Insights' own bucket: {action:"copy", paths:[...]} with the bridge secret.
async function copy(paths:string[],s:string){
 const out={ok:0,failed:[] as string[]};let i=0;
 const work=async()=>{while(i<paths.length){const p=paths[i++];try{
  const d=await fetch(CRM+'/storage/v1/object/web-recordings/'+p,{headers:H});if(!d.ok)throw new Error('get '+d.status);
  const u=await fetch(INSIGHTS+'?op=import&path='+encodeURIComponent(p),{method:'POST',headers:{'x-insights-secret':s,'Content-Type':'application/gzip'},body:await d.arrayBuffer()});
  if(!u.ok)throw new Error('put '+u.status+' '+(await u.text()).slice(0,80));out.ok++;
 }catch(e){out.failed.push(p+': '+String((e as any)?.message||e))}}};
 await Promise.all(Array.from({length:8},work));return out;
}
const cache=new Map<string,{at:number,body:Uint8Array,type:string}>();
Deno.serve(async(req)=>{
 const url=new URL(req.url);
 const asset=url.searchParams.get('asset');
 if(req.method==='GET'&&asset){
  const hit=cache.get(asset);
  if(!hit||Date.now()-hit.at>300_000){
   const r=await fetch(INSIGHTS+'?asset='+encodeURIComponent(asset));
   if(!r.ok)return new Response('Unavailable',{status:502});
   cache.set(asset,{at:Date.now(),body:new Uint8Array(await r.arrayBuffer()),type:r.headers.get('content-type')||'application/javascript; charset=utf-8'});
  }
  const c=cache.get(asset)!;
  return new Response(c.body,{headers:{'Content-Type':c.type,'Cache-Control':'public, max-age=3600','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}});
 }
 if(req.method==='POST'&&url.searchParams.get('op')==='chunk'){
  const h:Record<string,string>={'Content-Type':req.headers.get('content-type')||'application/octet-stream'};
  for(const k of ['origin','referer','user-agent'])if(req.headers.get(k))h[k]=req.headers.get(k)!;
  if(req.headers.get('cf-ipcountry'))h['x-insights-country']=req.headers.get('cf-ipcountry')!;
  const r=await fetch(INSIGHTS+'?op=chunk',{method:'POST',headers:h,body:await req.arrayBuffer()});
  return new Response(null,{status:r.status===200?204:r.status,headers:{'Access-Control-Allow-Origin':'*'}});
 }
 if(req.method==='POST'&&req.headers.get('x-insights-secret')){
  const s=await secret();if(!s||req.headers.get('x-insights-secret')!==s)return new Response('Not allowed',{status:403});
  const b=await req.json().catch(()=>({}));
  if(b.action==='copy'&&Array.isArray(b.paths))return new Response(JSON.stringify(await copy(b.paths.slice(0,300).map(String),s)),{headers:{'Content-Type':'application/json'}});
 }
 if(req.method==='OPTIONS')return new Response('ok',{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
 return new Response(JSON.stringify({error:'Insights has moved to its own project'}),{status:410,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
});
