// CRM project (dipjypzrfigkzuarlsov) stand-in for Insights' web-recorder, which now lives in Insights' own project.
// Websites installed before the move load the tracker from this address, so:
//  GET ?asset=…    – passed through from Insights' own web-recorder (the tracker sends straight to Insights)
//  POST ?op=chunk  – forwarded to Insights (trackers cached from before the move); nothing is stored here
const INSIGHTS='https://gbxjvsrgqcomkjxakbso.supabase.co/functions/v1/web-recorder';
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
  for(const k of ['origin','referer','cf-ipcountry','user-agent'])if(req.headers.get(k))h[k]=req.headers.get(k)!;
  const r=await fetch(INSIGHTS+'?op=chunk',{method:'POST',headers:h,body:await req.arrayBuffer()});
  return new Response(null,{status:r.status===200?204:r.status,headers:{'Access-Control-Allow-Origin':'*'}});
 }
 if(req.method==='OPTIONS')return new Response('ok',{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}});
 return new Response(JSON.stringify({error:'Insights has moved to its own project'}),{status:410,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
});
