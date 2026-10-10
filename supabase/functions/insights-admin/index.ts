// Insights: sites and their teams.
//  create_site      – CRM admins/super users: add a website (ours or a third party's), with its plan and limits
//  update_site      – site managers: name, domains, consent mode. CRM admins also: plan, limits, retention, on/off
//  new_key          – site managers: replace the site key (the old snippet stops recording)
//  invite           – site managers: invite someone by email as viewer or manager (sends a sign-in email)
//  set_role         – site managers: change a member between viewer and manager
//  remove_member    – site managers: take someone off the site
//  resend           – site managers: send the invitation email again
//  check_install    – site managers: is the tracking code on the website, and are visits arriving?
//  open_link        – anyone signed in (e.g. from the CRM): a one-time link that signs them into the Insights app
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const ORIGINS=['https://staff.racecargraphics.uk','https://crm.racecargraphics.uk','https://insights.racecargraphics.uk','https://insights.justin-b8f.workers.dev','https://race-car-graphics-crm-v1.justin-b8f.workers.dev'];
const clean=(v:any,n=300)=>String(v??'').replace(/\0/g,'').trim().slice(0,n);
const esc=(v:string)=>String(v).replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'} as any)[c]);
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function domains(v:any){
 const list=(Array.isArray(v)?v:String(v||'').split(/[\s,]+/)).map((d:any)=>String(d).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/:\d+$/,'')).filter(Boolean);
 for(const d of list)if(!/^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d))throw new Error('"'+d+'" is not a website domain. Use the address without https://, e.g. example.co.uk');
 return [...new Set(list)].slice(0,20);
}
async function appUrl(){const {data}=await admin.from('ecommerce_system_secrets').select('secret_value').eq('secret_name','insights_app_url').maybeSingle();return String(data?.secret_value||'https://staff.racecargraphics.uk/insights').replace(/\/$/,'');}

async function who(req:Request){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!token||token.startsWith('sb_'))return null;
 const {data:{user}}=await admin.auth.getUser(token);if(!user)return null;
 const {data:p}=await admin.from('profiles').select('role,is_active,first_name,last_name').eq('id',user.id).maybeSingle();
 return {id:user.id,email:user.email||'',crmAdmin:!!p?.is_active&&['admin','super_user'].includes(String(p?.role)),name:[p?.first_name,p?.last_name].filter(Boolean).join(' ')||user.email||''};
}
async function roleOn(user:any,siteId:string){
 if(user.crmAdmin)return 'admin';
 const {data}=await admin.from('insight_site_members').select('role').eq('site_id',siteId).eq('user_id',user.id).maybeSingle();
 return data?.role||null;
}

async function sendInvite(site:any,email:string,role:string,first:string,inviter:any,signInOnly=false){
 const key=Deno.env.get('SENDGRID_API_KEY');if(!key)throw new Error('Email is not configured');
 const base=await appUrl();
 // New people get an invitation (choose a password); people who already have a login get a one-click sign-in link.
 let link:any=null,isNew=true;
 const inv=await admin.auth.admin.generateLink({type:'invite',email,options:{data:{first_name:first||null},redirectTo:base+'/accept'}});
 if(inv.error){if(!/already|registered|exists/i.test(inv.error.message))throw inv.error;isNew=false;const ml=await admin.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo:base}});if(ml.error)throw ml.error;link=ml.data;}
 else link=inv.data;
 const url=base+'/accept?token_hash='+encodeURIComponent(link.properties.hashed_token)+'&type='+(isNew?'invite':'magiclink');
 const what=role==='manager'?'manage':'view';
 if(signInOnly){
  const html='<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1d2329"><div style="background:#101820;padding:18px 24px;color:#fff;font-weight:bold;font-size:18px;letter-spacing:.04em">INSIGHTS</div><div style="padding:24px"><h1 style="font-size:22px;margin:0 0 12px">Your sign-in link</h1><p>Press the button to sign in to Insights'+(isNew?' and choose a password':'')+'. The link works once and expires after 24 hours.</p><p style="margin:24px 0"><a href="'+url+'" style="background:#e21a22;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">SIGN IN</a></p><p style="color:#68737b;font-size:13px">If you didn\'t ask for this, you can ignore it.</p></div></div>';
  const r=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({personalizations:[{to:[{email}]}],from:{email:'noreply@racecargraphics.uk',name:'Insights'},subject:'Your Insights sign-in link',content:[{type:'text/plain',value:'Sign in to Insights: '+url+'\n(The link works once and expires after 24 hours.)'},{type:'text/html',value:html}]})});
  if(!r.ok)throw new Error('Email failed');return {user_id:link.user?.id||null,new_login:isNew};
 }
 const html='<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1d2329"><div style="background:#101820;padding:18px 24px;color:#fff;font-weight:bold;font-size:18px;letter-spacing:.04em">INSIGHTS</div><div style="padding:24px">'
  +'<h1 style="font-size:22px;margin:0 0 12px">You\'ve been invited to '+esc(site.name)+'</h1>'
  +'<p>'+esc(inviter.name||'Someone')+' has invited you to '+what+' the visitor recordings and reports for <b>'+esc(site.name)+'</b> ('+esc((site.domains||[]).join(', '))+').</p>'
  +'<p>'+(isNew?'Press the button to choose your password and open the site. The link works once and expires after 24 hours.':'Press the button to sign in and open the site. The link works once and expires after 24 hours.')+'</p>'
  +'<p style="margin:24px 0"><a href="'+url+'" style="background:#e21a22;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">'+(isNew?'ACCEPT AND SET PASSWORD':'OPEN INSIGHTS')+'</a></p>'
  +'<p>After that, sign in any time at <a href="'+base+'">'+esc(base.replace(/^https?:\/\//,''))+'</a> with '+esc(email)+'.</p><p style="color:#68737b;font-size:13px">If you weren\'t expecting this, you can ignore it.</p></div></div>';
 const text='You\'ve been invited to '+what+' '+site.name+' on Insights.\n\n'+(isNew?'Choose your password: ':'Sign in: ')+url+'\n(The link works once and expires after 24 hours.)\n\nAfter that, sign in at '+base+' with '+email+'.';
 const r=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({personalizations:[{to:[{email}]}],from:{email:'noreply@racecargraphics.uk',name:'Insights'},reply_to:inviter.email?{email:inviter.email}:undefined,
   subject:'You\'re invited to '+site.name+' on Insights',content:[{type:'text/plain',value:text},{type:'text/html',value:html}]})});
 if(!r.ok)throw new Error('The invitation is saved, but the email failed: '+(await r.text()).slice(0,200));
 return {user_id:link.user?.id||null,new_login:isNew};
}

Deno.serve(async(req)=>{
 const origin=req.headers.get('origin')||'';
 const cors={'Access-Control-Allow-Origin':ORIGINS.includes(origin)?origin:ORIGINS[0],'Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
 const json=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 const b=await req.json().catch(()=>({}));const action=clean(b.action,40);
 // Public: email a one-click sign-in link to someone on a site's team (always answers the same, so it can't be used
 // to find out who has access).
 if(action==='login_link'){
  const email=clean(b.email,200).toLowerCase();
  if(EMAIL.test(email)){const {data:m}=await admin.from('insight_site_members').select('site_id,role,insight_sites(name,domains)').eq('email',email).limit(1).maybeSingle();
   if(m)try{await sendInvite({name:(m as any).insight_sites?.name||'Insights',domains:(m as any).insight_sites?.domains||[]},email,m.role,'',{name:'Insights',email:''},true)}catch(e){console.error('login link',e)}}
  return json({ok:true});
 }
 const user=await who(req);if(!user)return json({error:'Sign in required'},401);
 try{
  if(action==='create_site'){
   if(!user.crmAdmin)throw new Error('Only CRM admins can add sites');
   const name=clean(b.name,120);if(!name)throw new Error('Give the site a name');
   const d=domains(b.domains);if(!d.length)throw new Error('Add the website address (domain)');
   const plan=clean(b.plan,20)||'starter';
   const row:any={name,domains:d,plan,consent_mode:b.consent_mode==='auto'?'auto':'wait',business_unit_id:UUID.test(String(b.business_unit_id||''))?b.business_unit_id:null,created_by:user.id,
    session_limit:b.session_limit===''||b.session_limit==null?null:Math.max(0,Math.round(Number(b.session_limit))),retention_days:b.retention_days===''||b.retention_days==null?null:Math.min(730,Math.max(7,Math.round(Number(b.retention_days))))};
   const {data:site,error}=await admin.from('insight_sites').insert(row).select('*').single();if(error)throw error;
   let invited:any=null;
   const owner=clean(b.owner_email,200).toLowerCase();
   if(owner){if(!EMAIL.test(owner))throw new Error('The owner email is not valid');
    await admin.from('insight_site_members').upsert({site_id:site.id,email:owner,role:'manager',invited_by:user.id},{onConflict:'site_id,email'});
    try{invited=await sendInvite(site,owner,'manager',clean(b.owner_first_name,80),user);if(invited.user_id)await admin.from('insight_site_members').update({user_id:invited.user_id}).eq('site_id',site.id).eq('email',owner);}catch(e:any){invited={error:e.message}}}
   return json({ok:true,site,invited});
  }
  // "Open in Insights" from the CRM: the Insights app is on its own domain with its own sign-in, so hand over with a
  // one-time sign-in link for the same person (no email is sent; the link is used straight away).
  if(action==='open_link'){
   if(!user.email)throw new Error('Your login has no email address');
   if(!user.crmAdmin){const {count}=await admin.from('insight_site_members').select('id',{count:'exact',head:true}).eq('user_id',user.id);if(!count)throw new Error('You do not have access to Insights');}
   const ml=await admin.auth.admin.generateLink({type:'magiclink',email:user.email});if(ml.error)throw ml.error;
   const site=UUID.test(String(b.site_id||''))?String(b.site_id):'';
   const base=await appUrl();
   return json({ok:true,url:base+'/accept?token_hash='+encodeURIComponent(ml.data.properties.hashed_token)+'&type=magiclink'+(site?'&next='+encodeURIComponent('/?site='+site):'')});
  }
  const siteId=clean(b.site_id,80);if(!UUID.test(siteId))throw new Error('Choose a site');
  const role=await roleOn(user,siteId);if(!role)throw new Error('You do not have access to this site');
  const manage=role==='admin'||role==='manager';
  const {data:site}=await admin.from('insight_sites').select('*').eq('id',siteId).single();
  if(!manage)throw new Error('Only managers can change this site');
  if(action==='update_site'){
   const patch:any={updated_at:new Date().toISOString()};
   if(b.name!==undefined){const n=clean(b.name,120);if(!n)throw new Error('Give the site a name');patch.name=n;}
   if(b.domains!==undefined){const d=domains(b.domains);if(!d.length)throw new Error('Keep at least one domain');patch.domains=d;}
   if(b.consent_mode!==undefined)patch.consent_mode=b.consent_mode==='auto'?'auto':'wait';
   if(role==='admin'){
    if(b.plan!==undefined)patch.plan=clean(b.plan,20);
    if(b.session_limit!==undefined)patch.session_limit=b.session_limit===''||b.session_limit==null?null:Math.max(0,Math.round(Number(b.session_limit)));
    if(b.retention_days!==undefined)patch.retention_days=b.retention_days===''||b.retention_days==null?null:Math.min(730,Math.max(7,Math.round(Number(b.retention_days))));
    if(b.is_active!==undefined)patch.is_active=!!b.is_active;
    if(b.business_unit_id!==undefined)patch.business_unit_id=UUID.test(String(b.business_unit_id||''))?b.business_unit_id:null;
   }
   const {data,error}=await admin.from('insight_sites').update(patch).eq('id',siteId).select('*').single();if(error)throw error;return json({ok:true,site:data});
  }
  if(action==='new_key'){const {data,error}=await admin.from('insight_sites').update({site_key:crypto.randomUUID(),updated_at:new Date().toISOString()}).eq('id',siteId).select('site_key').single();if(error)throw error;return json({ok:true,site_key:data.site_key});}
  if(action==='invite'||action==='resend'){
   const email=clean(b.email,200).toLowerCase();if(!EMAIL.test(email))throw new Error('Enter a valid email address');
   const r=action==='invite'?(b.role==='manager'?'manager':'viewer'):undefined;
   if(action==='invite'){const {error}=await admin.from('insight_site_members').upsert({site_id:siteId,email,role:r,invited_by:user.id,invited_at:new Date().toISOString()},{onConflict:'site_id,email'});if(error)throw error;}
   const {data:m}=await admin.from('insight_site_members').select('role,user_id').eq('site_id',siteId).eq('email',email).maybeSingle();if(!m)throw new Error('That person is not on this site');
   const sent=await sendInvite(site,email,m.role,clean(b.first_name,80),user);
   if(sent.user_id&&!m.user_id)await admin.from('insight_site_members').update({user_id:sent.user_id}).eq('site_id',siteId).eq('email',email);
   return json({ok:true,...sent});
  }
  // Is the tracking code on the website? Loads each domain's home page and looks for this site's key, and reports
  // the last visit received (code added through a tag manager only shows up as visits).
  if(action==='check_install'){
   const pages=await Promise.all((site.domains||[]).slice(0,4).map(async(d:string)=>{
    const url='https://'+String(d).replace(/^https?:\/\//,'').replace(/\/.*$/,'')+'/';
    try{const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),8000);
     const r=await fetch(url,{redirect:'follow',signal:ctl.signal,headers:{'User-Agent':'Mozilla/5.0 (compatible; InsightsInstallCheck/1.0)'}});clearTimeout(t);
     const html=(await r.text()).slice(0,800_000);
     return {url,status:r.status,tracker:/web-recorder\?asset=t\.js/.test(html),key:html.includes(site.site_key),other_key:/data-site=["'][0-9a-f-]{36}["']/i.test(html)&&!html.includes(site.site_key),tag_manager:/googletagmanager\.com\/gtm\.js/.test(html)};
    }catch(e:any){return {url,status:0,error:String(e?.name==='AbortError'?'The site took too long to answer':e?.message||e).slice(0,200)};}
   }));
   const {data:last}=await admin.from('web_sessions').select('started_at,host').eq('site_id',siteId).order('started_at',{ascending:false}).limit(1).maybeSingle();
   const since=new Date(Date.now()-86400000).toISOString();
   const {count}=await admin.from('web_sessions').select('id',{count:'exact',head:true}).eq('site_id',siteId).gte('started_at',since);
   return json({ok:true,pages,last_visit:last?.started_at||null,last_host:last?.host||null,visits_24h:count||0,consent_mode:site.consent_mode});
  }
  if(action==='set_role'){const {error}=await admin.from('insight_site_members').update({role:b.role==='manager'?'manager':'viewer'}).eq('site_id',siteId).eq('id',clean(b.member_id,80));if(error)throw error;return json({ok:true});}
  if(action==='remove_member'){
   const {data:m}=await admin.from('insight_site_members').select('id,user_id').eq('site_id',siteId).eq('id',clean(b.member_id,80)).maybeSingle();if(!m)throw new Error('Member not found');
   if(m.user_id===user.id&&role!=='admin')throw new Error('You cannot remove yourself');
   const {error}=await admin.from('insight_site_members').delete().eq('id',m.id);if(error)throw error;return json({ok:true});
  }
  return json({error:'Unknown action'},400);
 }catch(e:any){return json({error:String(e?.message||e)},400);}
});
