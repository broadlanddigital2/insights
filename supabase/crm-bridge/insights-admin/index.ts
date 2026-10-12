// CRM project (dipjypzrfigkzuarlsov) side of Insights, which now lives in its own Supabase project with its own logins.
// The CRM's Marketing → Website page calls this as a signed-in CRM admin; it checks who they are here and asks Insights
// (bridge actions, shared secret insights_bridge_secret) for:
//  open_link – a one-time link that signs them into the Insights app (as their email there)
//  summary   – their websites with the last 7 days' totals
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const INSIGHTS='https://gbxjvsrgqcomkjxakbso.supabase.co/functions/v1/insights-admin';
const ORIGINS=['https://staff.racecargraphics.uk','https://crm.racecargraphics.uk','https://race-car-graphics-crm-v1.justin-b8f.workers.dev','http://localhost:3000'];
Deno.serve(async(req)=>{
 const origin=req.headers.get('origin')||'';
 const cors={'Access-Control-Allow-Origin':ORIGINS.includes(origin)?origin:ORIGINS[0],'Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const {data:{user}}=token&&!token.startsWith('sb_')?await admin.auth.getUser(token):{data:{user:null}} as any;
  if(!user?.email)return json({error:'Sign in required'},401);
  const {data:p}=await admin.from('profiles').select('role,is_active').eq('id',user.id).maybeSingle();
  if(!p?.is_active||!['admin','super_user','staff'].includes(String(p.role)))return json({error:'Only CRM staff can open Insights from here'},403);
  const b=await req.json().catch(()=>({}));
  const action=b.action==='summary'?'bridge_summary':b.action==='open_link'?'bridge_sso':'';
  if(!action)return json({error:'Unknown action'},400);
  const {data:s}=await admin.from('ecommerce_system_secrets').select('secret_value').eq('secret_name','insights_bridge_secret').maybeSingle();
  const r=await fetch(INSIGHTS,{method:'POST',headers:{'Content-Type':'application/json','x-insights-secret':s?.secret_value||''},body:JSON.stringify({action,email:user.email,site_id:b.site_id,next:b.next})});
  const j=await r.json().catch(()=>({error:'Insights did not answer'}));
  return json(j,r.ok?200:400);
 }catch(e:any){return json({error:String(e?.message||e)},400);}
});
