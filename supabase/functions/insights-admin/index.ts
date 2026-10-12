// Insights: sites and their teams.
// Runs in Insights' own Supabase project (CRM Insights, gbxjvsrgqcomkjxakbso), with its own logins and its own
// administrators (table insight_admins, by email). The CRM talks to it only through the bridge actions below.
//  bridge_sso / bridge_summary / bridge_lead – the CRM project (x-insights-secret): sign-in link for a CRM admin,
//      their websites with last-7-day totals for Marketing → Website, and a website enquiry linked to its visit
//  create_site      – Insights admins: add a website (ours or anyone's), with its plan and limits
//  list_admins / add_admin / remove_admin – Insights admins: who runs Insights
//  update_site      – site managers: name, domains, consent mode. Insights admins also: plan, limits, retention, on/off
//  new_key          – site managers: replace the site key (the old snippet stops recording)
//  invite           – site managers: invite someone by email as viewer or manager (sends a sign-in email)
//  set_role         – site managers: change a member between viewer and manager
//  remove_member    – site managers: take someone off the site
//  resend           – site managers: send the invitation email again
//  check_install    – site managers: is the tracking code on the website, and are visits arriving?
//  open_link        – anyone signed in (e.g. from the CRM): a one-time link that signs them into the Insights app
import {createClient} from './supa.ts';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const admin=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const ORIGINS=['https://insights.racecargraphics.uk','https://insights.justin-b8f.workers.dev','http://localhost:3000'];
const clean=(v:any,n=300)=>String(v??'').replace(/\0/g,'').trim().slice(0,n);
const esc=(v:string)=>String(v).replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'} as any)[c]);
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function domains(v:any){
 const list=(Array.isArray(v)?v:String(v||'').split(/[\s,]+/)).map((d:any)=>String(d).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/:\d+$/,'')).filter(Boolean);
 for(const d of list)if(!/^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d))throw new Error('"'+d+'" is not a website domain. Use the address without https://, e.g. example.co.uk');
 return [...new Set(list)].slice(0,20);
}
async function setting(name:string){const {data}=await admin.from('insight_settings').select('value').eq('name',name).maybeSingle();return data?.value||'';}
async function appUrl(){return String(await setting('app_url')||'https://insights.racecargraphics.uk').replace(/\/$/,'');}

async function who(req:Request){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!token||token.startsWith('sb_'))return null;
 const {data:{user}}=await admin.auth.getUser(token);if(!user)return null;
 const {data:a}=await admin.from('insight_admins').select('email').or(`user_id.eq.${user.id},email.ilike.${String(user.email||'-').replace(/[,()]/g,'')}`).limit(1).maybeSingle();
 const md:any=user.user_metadata||{};
 return {id:user.id,email:user.email||'',crmAdmin:!!a,name:[md.first_name,md.last_name].filter(Boolean).join(' ')||user.email||''};
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
 if(inv.error){if(!/already|registered|exists/i.test(inv.error.message))throw new Error(inv.error.message);isNew=false;const ml=await admin.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo:base}});if(ml.error)throw new Error(ml.error.message);link=ml.data;}
 else{link=inv.data;
  // A new login made by Insights is for Insights only: the CRM won't let it in.
  }
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
  if(EMAIL.test(email)){const {data:ad}=await admin.from('insight_admins').select('user_id').ilike('email',email).limit(1).maybeSingle();
   if(ad){try{await sendInvite({name:'Insights',domains:['all websites']},email,'manager','',{name:'Insights',email:''},true)}catch(e){console.error('login link',e)}return json({ok:true});}
   const {data:m}=await admin.from('insight_site_members').select('site_id,role,insight_sites(name,domains)').eq('email',email).limit(1).maybeSingle();
   if(m)try{await sendInvite({name:(m as any).insight_sites?.name||'Insights',domains:(m as any).insight_sites?.domains||[]},email,m.role,'',{name:'Insights',email:''},true)}catch(e){console.error('login link',e)}}
  return json({ok:true});
 }
 // ---- Bridge from the CRM project (shared secret; the CRM has already checked who the person is) ----
 if(action.startsWith('bridge_')){
  const secret=await setting('bridge_secret');
  if(!secret||req.headers.get('x-insights-secret')!==secret)return json({error:'Not allowed'},403);
  try{
   // The one-off move from the CRM project: rows posted from there (pg_net), upserted as they are.
   if(action==='bridge_import'){
    const T:Record<string,string>={insight_sites:'id',insight_site_members:'id',web_sessions:'id',web_session_chunks:'session_id,seq',insight_users:'site_id,user_key',
      insight_pageviews:'id',marketing_funnels:'id',insight_charts:'id',crm_businesses:'id'};
    const table=String(b.table||'');if(!T[table]||!Array.isArray(b.rows))throw new Error('Bad import');
    for(let i=0;i<b.rows.length;i+=500){const {error}=await admin.from(table).upsert(b.rows.slice(i,i+500),{onConflict:T[table]});if(error)throw new Error(error.message);}
    return json({ok:true,table,rows:b.rows.length});
   }
   if(action==='bridge_import_events'){
    if(!Array.isArray(b.rows))throw new Error('Bad import');
    for(let i=0;i<b.rows.length;i+=500){const {error}=await admin.from('insight_events').insert(b.rows.slice(i,i+500).map((r:any)=>{const {id,...x}=r;return x;}));if(error)throw new Error(error.message);}
    return json({ok:true,rows:b.rows.length});
   }
   if(action==='bridge_lead'){
    const sid=clean(b.session_id,40);if(!UUID.test(sid))return json({ok:true});
    const {data:sess}=await admin.from('web_sessions').update({lead_id:UUID.test(String(b.lead_id||''))?b.lead_id:null}).eq('id',sid).is('lead_id',null).select('id,site_id,user_key').maybeSingle();
    if(sess?.user_key&&sess.site_id){
     const email=clean(b.email,200)?.toLowerCase()||null,name=clean(b.name,200)||null,phone=clean(b.phone,60)||null;
     const {data:u}=await admin.from('insight_users').select('email,name,traits').eq('site_id',sess.site_id).eq('user_key',sess.user_key).maybeSingle();
     if(u)await admin.from('insight_users').update({email:u.email||email,name:u.name||name,traits:{...(u.traits||{}),lead:true,...(phone?{phone}:{})}}).eq('site_id',sess.site_id).eq('user_key',sess.user_key);
     const {data:ss}=await admin.from('web_sessions').select('id,user_email,user_name').eq('site_id',sess.site_id).eq('user_key',sess.user_key);
     for(const x of ss||[])if(!x.user_email||!x.user_name)await admin.from('web_sessions').update({user_email:x.user_email||email,user_name:x.user_name||name}).eq('id',x.id);
    }
    return json({ok:true,linked:!!sess});
   }
   const email=clean(b.email,200).toLowerCase();if(!EMAIL.test(email))throw new Error('No email for this person');
   const {data:isAdmin}=await admin.from('insight_admins').select('email').ilike('email',email).maybeSingle();
   const {data:mem}=await admin.from('insight_site_members').select('site_id').ilike('email',email);
   if(!isAdmin&&!(mem||[]).length)throw new Error('You do not have access to Insights. Ask an Insights admin to invite you.');
   if(action==='bridge_summary'){
    const {data,error}=await admin.rpc('insights_bridge_summary',{p_email:email,p_admin:!!isAdmin});if(error)throw new Error(error.message);
    return json({ok:true,sites:data||[]});
   }
   if(action==='bridge_sso'){
    let ml=await admin.auth.admin.generateLink({type:'magiclink',email});
    if(ml.error){const c=await admin.auth.admin.createUser({email,email_confirm:true});if(c.error)throw new Error(c.error.message);ml=await admin.auth.admin.generateLink({type:'magiclink',email});if(ml.error)throw new Error(ml.error.message);}
    const site=UUID.test(String(b.site_id||''))?String(b.site_id):'';
    const next=/^\/(?!\/)[\w\-/?=&.%]*$/.test(String(b.next||''))?String(b.next):site?'/?site='+site:'';
    return json({ok:true,url:(await appUrl())+'/accept?token_hash='+encodeURIComponent(ml.data.properties.hashed_token)+'&type=magiclink'+(next?'&next='+encodeURIComponent(next):'')});
   }
   throw new Error('Unknown action');
  }catch(e:any){return json({error:String(e?.message||e)},400);}
 }
 const user=await who(req);if(!user)return json({error:'Sign in required'},401);
 try{
  if(action==='create_site'){
   if(!user.crmAdmin)throw new Error('Only Insights admins can add websites');
   const name=clean(b.name,120);if(!name)throw new Error('Give the site a name');
   const d=domains(b.domains);if(!d.length)throw new Error('Add the website address (domain)');
   const plan=clean(b.plan,20)||'starter';
   const row:any={name,domains:d,plan,owner_name:clean(b.owner_name,120)||null,consent_mode:b.consent_mode==='auto'?'auto':'wait',business_unit_id:UUID.test(String(b.business_unit_id||''))?b.business_unit_id:null,created_by:user.id,
    session_limit:b.session_limit===''||b.session_limit==null?null:Math.max(0,Math.round(Number(b.session_limit))),retention_days:b.retention_days===''||b.retention_days==null?null:Math.min(730,Math.max(7,Math.round(Number(b.retention_days))))};
   const {data:site,error}=await admin.from('insight_sites').insert(row).select('*').single();if(error)throw new Error(error.message);
   let invited:any=null;
   const owner=clean(b.owner_email,200).toLowerCase();
   if(owner){if(!EMAIL.test(owner))throw new Error('The owner email is not valid');
    await admin.from('insight_site_members').upsert({site_id:site.id,email:owner,role:'manager',invited_by:user.id},{onConflict:'site_id,email'});
    try{invited=await sendInvite(site,owner,'manager',clean(b.owner_first_name,80),user);if(invited.user_id)await admin.from('insight_site_members').update({user_id:invited.user_id}).eq('site_id',site.id).eq('email',owner);}catch(e:any){invited={error:e.message}}}
   return json({ok:true,site,invited});
  }
  if(action==='list_admins'||action==='add_admin'||action==='remove_admin'){
   if(!user.crmAdmin)throw new Error('Only Insights admins can do this');
   if(action==='add_admin'){
    const email=clean(b.email,200).toLowerCase();if(!EMAIL.test(email))throw new Error('Enter a valid email address');
    const sent=await sendInvite({name:'Insights administration',domains:['all websites']},email,'manager',clean(b.first_name,80),user);
    let id=sent.user_id;
    if(!id){const {data:list}=await admin.auth.admin.listUsers({page:1,perPage:1000});id=(list?.users||[]).find((u:any)=>String(u.email||'').toLowerCase()===email)?.id||null;}
    const {error}=await admin.from('insight_admins').upsert({email,user_id:id,added_by:user.id},{onConflict:'email'});if(error)throw new Error(error.message);
   }
   if(action==='remove_admin'){
    const em=clean(b.email,200).toLowerCase();if(em===String(user.email||'').toLowerCase())throw new Error('You cannot remove yourself');
    const {count}=await admin.from('insight_admins').select('email',{count:'exact',head:true});if((count||0)<=1)throw new Error('Insights needs at least one admin');
    const {error}=await admin.from('insight_admins').delete().eq('email',em);if(error)throw new Error(error.message);
   }
   const {data,error}=await admin.from('insight_admins').select('user_id,email,added_at').order('added_at');if(error)throw new Error(error.message);
   // (user_id is only set once they've signed in; the app keys rows by email)
   return json({ok:true,admins:data});
  }
  if(action==='update_account'){
   const first=clean(b.first_name,80),last=clean(b.last_name,80);
   const {error}=await admin.auth.admin.updateUserById(user.id,{user_metadata:{first_name:first||null,last_name:last||null}});if(error)throw new Error(error.message);
   return json({ok:true});
  }
  // "Open in Insights" from the CRM: the Insights app is on its own domain with its own sign-in, so hand over with a
  // one-time sign-in link for the same person (no email is sent; the link is used straight away).
  if(action==='open_link'){
   if(!user.email)throw new Error('Your login has no email address');
   if(!user.crmAdmin){const {count}=await admin.from('insight_site_members').select('id',{count:'exact',head:true}).eq('user_id',user.id);if(!count)throw new Error('You do not have access to Insights');}
   const ml=await admin.auth.admin.generateLink({type:'magiclink',email:user.email});if(ml.error)throw new Error(ml.error.message);
   const site=UUID.test(String(b.site_id||''))?String(b.site_id):'';
   const base=await appUrl();
   const next=/^\/(?!\/)[\w\-/?=&.%]*$/.test(String(b.next||''))?String(b.next):site?'/?site='+site:'';
   return json({ok:true,url:base+'/accept?token_hash='+encodeURIComponent(ml.data.properties.hashed_token)+'&type=magiclink'+(next?'&next='+encodeURIComponent(next):'')});
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
   if(b.owner_name!==undefined)patch.owner_name=clean(b.owner_name,120)||null;
   if(role==='admin'){
    if(b.plan!==undefined)patch.plan=clean(b.plan,20);
    if(b.session_limit!==undefined)patch.session_limit=b.session_limit===''||b.session_limit==null?null:Math.max(0,Math.round(Number(b.session_limit)));
    if(b.retention_days!==undefined)patch.retention_days=b.retention_days===''||b.retention_days==null?null:Math.min(730,Math.max(7,Math.round(Number(b.retention_days))));
    if(b.is_active!==undefined)patch.is_active=!!b.is_active;
    if(b.business_unit_id!==undefined)patch.business_unit_id=UUID.test(String(b.business_unit_id||''))?b.business_unit_id:null;
   }
   const {data,error}=await admin.from('insight_sites').update(patch).eq('id',siteId).select('*').single();if(error)throw new Error(error.message);return json({ok:true,site:data});
  }
  if(action==='new_key'){const {data,error}=await admin.from('insight_sites').update({site_key:crypto.randomUUID(),updated_at:new Date().toISOString()}).eq('id',siteId).select('site_key').single();if(error)throw new Error(error.message);return json({ok:true,site_key:data.site_key});}
  if(action==='invite'||action==='resend'){
   const email=clean(b.email,200).toLowerCase();if(!EMAIL.test(email))throw new Error('Enter a valid email address');
   const r=action==='invite'?(b.role==='manager'?'manager':'viewer'):undefined;
   if(action==='invite'){const {error}=await admin.from('insight_site_members').upsert({site_id:siteId,email,role:r,invited_by:user.id,invited_at:new Date().toISOString()},{onConflict:'site_id,email'});if(error)throw new Error(error.message);}
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
  if(action==='set_role'){const {error}=await admin.from('insight_site_members').update({role:b.role==='manager'?'manager':'viewer'}).eq('site_id',siteId).eq('id',clean(b.member_id,80));if(error)throw new Error(error.message);return json({ok:true});}
  if(action==='remove_member'){
   const {data:m}=await admin.from('insight_site_members').select('id,user_id').eq('site_id',siteId).eq('id',clean(b.member_id,80)).maybeSingle();if(!m)throw new Error('Member not found');
   if(m.user_id===user.id&&role!=='admin')throw new Error('You cannot remove yourself');
   const {error}=await admin.from('insight_site_members').delete().eq('id',m.id);if(error)throw new Error(error.message);return json({ok:true});
  }
  return json({error:'Unknown action'},400);
 }catch(e:any){return json({error:String(e?.message||e)},400);}
});
