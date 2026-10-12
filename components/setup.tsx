"use client";
import {useEffect,useRef,useState} from "react";
import {REC,num,ago} from "./lib";

// Adding a website to Insights in three steps — details, install the tracking code (with instructions per platform
// and a live check that it's working), invite the people who should see it — plus the pieces reused on the site's
// Tracking & settings and Team pages.
async function admin(supabase:any,body:any){
  const {data,error}=await supabase.functions.invoke("insights-admin",{body});
  if(error){const v=await error.context?.json?.().catch(()=>null);throw new Error(v?.error||error.message)}
  if(data?.error)throw new Error(data.error);return data;
}
export function snippet(site:any){return `<script src="${REC}?asset=t.js" data-site="${site.site_key}"${site.consent_mode==="auto"?' data-consent="auto"':""} defer></script>`}

const PLATFORMS:[string,string,string[]][]=[
  ["html","Any website",["Open the template or layout used by every page (often header.html, layout.html or index.html).","Paste the code just before </head>.","Publish or upload the change."]],
  ["wordpress","WordPress",["Install the free plugin “WPCode – Insert Headers and Footers” (Plugins → Add New).","Go to Code Snippets → Header & Footer.","Paste the code into the Header box and click Save Changes."]],
  ["shopify","Shopify",["Go to Online Store → Themes, click ⋯ next to your live theme and choose Edit code.","Open layout/theme.liquid.","Paste the code just before </head> and click Save."]],
  ["wix","Wix",["Go to Settings → Custom code (needs a paid plan with a connected domain).","Click + Add Custom Code and paste the code.","Choose All pages, place it in Head, and click Apply."]],
  ["squarespace","Squarespace",["Go to Settings → Developer tools (or Advanced) → Code Injection.","Paste the code into the Header box.","Click Save."]],
  ["webflow","Webflow",["Open Site settings → Custom code.","Paste the code into Head code and save.","Publish the site."]],
  ["gtm","Google Tag Manager",["Add a new tag → Tag configuration → Custom HTML, and paste the code.","Set the trigger to All Pages (or Initialization – All Pages).","Save, then Submit / Publish the container. (The check below can only see the code once visits arrive.)"]],
  ["next","Next.js / React",["In your root layout, import Script from \"next/script\".","Add <Script src=\"…\" data-site=\"…\" strategy=\"afterInteractive\" /> using the address and key from the code.","Deploy."]],
];

export function CodeBox({code,label="COPY CODE"}:{code:string;label?:string}){
  const [copied,setCopied]=useState(false);
  return <div className="insCodeBox"><pre className="insCode">{code}</pre>
    <button type="button" className="crmPrimary" onClick={()=>{void navigator.clipboard?.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),2000)}}>{copied?"COPIED ✓":label}</button></div>;
}

export function InstallGuide({supabase,site,compact}:{supabase:any;site:any;compact?:boolean}){
  const [plat,setPlat]=useState("html"),[res,setRes]=useState<any>(null),[busy,setBusy]=useState(false),[err,setErr]=useState(""),[watching,setWatching]=useState(false);
  const stop=useRef<any>(null);
  const code=snippet(site);
  async function check(){setBusy(true);setErr("");try{setRes(await admin(supabase,{action:"check_install",site_id:site.id}))}catch(e:any){setErr(e.message)}finally{setBusy(false)}}
  function watch(){setWatching(true);let n=0;const t0=Date.now();
    const tick=async()=>{n++;try{const r=await admin(supabase,{action:"check_install",site_id:site.id});setRes(r);if(r.last_visit&&new Date(r.last_visit).getTime()>t0-60000){setWatching(false);return}}catch{}
      if(n<24)stop.current=setTimeout(tick,5000);else setWatching(false)};void tick()}
  useEffect(()=>()=>clearTimeout(stop.current),[]);
  const p=PLATFORMS.find(x=>x[0]===plat)!;
  const found=(res?.pages||[]).some((x:any)=>x.key),old=(res?.pages||[]).some((x:any)=>x.other_key);
  return <div className="insInstall">
    <div className="insStep"><b>1</b><div><h3>Copy your site's tracking code</h3><p>It's unique to <strong>{site.name}</strong> — the key tells Insights which website the visits belong to.</p><CodeBox code={code}/></div></div>
    <div className="insStep"><b>2</b><div><h3>Paste it into the website</h3>
      <div className="insPlatforms" role="tablist">{PLATFORMS.map(([k,l])=><button key={k} type="button" role="tab" aria-selected={plat===k} className={plat===k?"on":""} onClick={()=>setPlat(k)}>{l}</button>)}</div>
      <ol className="insHow">{p[2].map((s,i)=><li key={i}>{s}</li>)}</ol>
      {site.consent_mode!=="auto"&&<div className="insConsent"><p><b>Cookie consent:</b> this site waits for permission, so nothing is recorded until the cookie banner says the visitor accepted analytics. When they accept, run:</p><CodeBox code={"Insights.consent(true)"} label="COPY"/>
        <p className="insMuted">Most cookie tools (CookieYes, Cookiebot, Complianz, OneTrust) let you run a script when analytics is accepted. Or switch “Recording starts” to “Straight away” in the settings if the site handles consent another way.</p></div>}
      {!compact&&<p className="insMuted">Optional: tell Insights who people are when they sign in or send a form, and send your own events — see Tracking & settings.</p>}
    </div></div>
    <div className="insStep"><b>3</b><div><h3>Check it's working</h3>
      <div className="insCheckBtns"><button type="button" className="secondaryButton" disabled={busy} onClick={()=>void check()}>{busy?"CHECKING…":"CHECK INSTALLATION"}</button>
        <button type="button" className="secondaryButton" disabled={watching} onClick={watch}>{watching?"WAITING FOR A VISIT…":"WAIT FOR A TEST VISIT"}</button></div>
      {watching&&<p className="insMuted">Open the website in another tab{site.consent_mode!=="auto"?", accept the analytics cookies":""} and click around. This updates every few seconds for two minutes.</p>}
      {err&&<p className="crmNotice">{err}</p>}
      {res&&<ul className="insChecks">
        {(res.pages||[]).map((x:any)=><li key={x.url} className={x.key?"ok":x.error||x.status>=400?"bad":old&&x.other_key?"warn":"bad"}>
          <span>{x.key?"✓":"✗"}</span><div><b>{x.url}</b><small>{x.error?"Couldn't open the page: "+x.error:x.status>=400?"The page answered with error "+x.status:x.key?"Tracking code found":x.other_key?"An Insights code is there, but with a different key — replace it with the code above":x.tag_manager?"Code not in the page — fine if you added it with Google Tag Manager (look for a visit below)":"Tracking code not found on the home page"}</small></div></li>)}
        <li className={res.last_visit?"ok":"wait"}><span>{res.last_visit?"✓":"…"}</span><div><b>{res.last_visit?"Visits are arriving":"No visits received yet"}</b>
          <small>{res.last_visit?"Last visit "+ago(res.last_visit)+(res.last_host?" on "+res.last_host:"")+" · "+num(res.visits_24h)+" in the last 24 hours":found?"The code is installed. "+(res.consent_mode!=="auto"?"Visits appear once someone accepts analytics cookies.":"Visit the site to send a test visit."):"Add the code, then visit the site to send a test visit."}</small></div></li>
      </ul>}
    </div></div>
  </div>;
}

type Row={email:string;first_name:string;role:string;status?:string;error?:string};
export function InviteMany({supabase,site,onSent,intro=true}:{supabase:any;site:any;onSent?:()=>void;intro?:boolean}){
  const blank=():Row=>({email:"",first_name:"",role:"viewer"});
  const [rows,setRows]=useState<Row[]>([blank()]),[busy,setBusy]=useState(false);
  const set=(i:number,v:Partial<Row>)=>setRows(r=>r.map((x,k)=>k===i?{...x,...v,status:undefined,error:undefined}:x));
  function paste(i:number,text:string){const emails=text.split(/[\s,;]+/).map(s=>s.trim()).filter(s=>/^\S+@\S+\.\S+$/.test(s));if(emails.length<2)return false;
    setRows(r=>[...r.slice(0,i),...emails.map(e=>({...blank(),email:e,role:r[i]?.role||"viewer"})),...r.slice(i+1).filter(x=>x.email)]);return true}
  async function send(e:any){e.preventDefault();setBusy(true);
    const out=[...rows];
    for(let i=0;i<out.length;i++){const r=out[i];if(!r.email.trim()||r.status==="sent")continue;
      try{const x=await admin(supabase,{action:"invite",site_id:site.id,email:r.email.trim(),first_name:r.first_name.trim(),role:r.role});out[i]={...r,status:"sent",error:x.new_login===false?"Already had a login — the email signs them straight in.":""}}
      catch(err:any){out[i]={...r,status:"failed",error:err.message}}
      setRows([...out])}
    setBusy(false);onSent?.()}
  const pending=rows.filter(r=>r.email.trim()&&r.status!=="sent").length;
  return <form className="insInvite" onSubmit={send}>
    {intro&&<p className="insMuted"><b>Viewers</b> see the reports and recordings. <b>Managers</b> can also change settings, funnels and charts, and invite people. Each person only sees the websites they're invited to. Tip: paste a list of emails into the first box.</p>}
    {rows.map((r,i)=><div key={i} className={"insInviteRow"+(r.status?" "+r.status:"")}>
      <input type="email" value={r.email} placeholder="name@company.com" aria-label="Email" disabled={r.status==="sent"} onPaste={e=>{if(paste(i,e.clipboardData.getData("text")))e.preventDefault()}} onChange={e=>set(i,{email:e.target.value})}/>
      <input value={r.first_name} placeholder="First name (optional)" aria-label="First name" disabled={r.status==="sent"} onChange={e=>set(i,{first_name:e.target.value})}/>
      <select value={r.role} aria-label="Access" disabled={r.status==="sent"} onChange={e=>set(i,{role:e.target.value})}><option value="viewer">Viewer</option><option value="manager">Manager</option></select>
      {r.status==="sent"?<span className="insSent">✓ Sent</span>:rows.length>1?<button type="button" className="employeeLinkButton" onClick={()=>setRows(rows.filter((_,k)=>k!==i))} aria-label="Remove">✕</button>:<span/>}
      {r.error&&<small className={r.status==="failed"?"bad":""}>{r.error}</small>}
    </div>)}
    <div className="insInviteActions"><button type="button" className="employeeLinkButton" onClick={()=>setRows([...rows,blank()])}>+ Add another person</button>
      <button className="crmPrimary" disabled={busy||!pending}>{busy?"SENDING…":pending>1?"SEND "+pending+" INVITATIONS":"SEND INVITATION"}</button></div>
  </form>;
}

export function AddSite({supabase,businesses=[],onDone,onCancel}:any){
  const [step,setStep]=useState(1),[site,setSite]=useState<any>(null),[sent,setSent]=useState(false);
  const [f,setF]=useState<any>({name:"",domains:"",plan:"starter",consent_mode:"wait",business_unit_id:"",owner_name:"",session_limit:"",retention_days:""});
  const [plans,setPlans]=useState<any[]>([]),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{void supabase.from("insight_plans").select("*").order("sort_order").then(({data}:any)=>setPlans(data||[]))},[]);
  async function create(e:any){e.preventDefault();setBusy(true);setMsg("");try{
    if(site){const r=await admin(supabase,{action:"update_site",site_id:site.id,name:f.name,domains:f.domains,consent_mode:f.consent_mode,plan:f.plan,owner_name:f.owner_name,business_unit_id:f.business_unit_id});setSite(r.site)}
    else{const r=await admin(supabase,{action:"create_site",...f});setSite(r.site)}
    setStep(2)}catch(err:any){setMsg(err.message)}finally{setBusy(false)}}
  const close=()=>{if(site)onDone?.(site,true);else onCancel?.()};
  const STEPS=["Website","Install the code","Invite people"];
  return <div className="employeeModalBackdrop" role="dialog" aria-modal="true" aria-label="Add a website" onClick={e=>{if(e.target===e.currentTarget)close()}}><div className="employeeModal insWizard">
    <header className="insWizHead"><h2>{site?site.name:"Add a website"}</h2><button type="button" className="employeeLinkButton" onClick={close}>{site?"Finish later":"Cancel"}</button></header>
    <ol className="insWizSteps">{STEPS.map((s,i)=><li key={s} className={step===i+1?"on":step>i+1?"done":""}><button type="button" disabled={!site&&i>0} onClick={()=>setStep(i+1)}><b>{step>i+1?"✓":i+1}</b>{s}</button></li>)}</ol>
    {step===1&&<form className="signagePackageForm insForm" onSubmit={create}>
      <label>Site name<input required autoFocus value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="e.g. Smith's Garage website"/></label>
      <label>Website address <small>One per line, without https:// — subdomains are included automatically</small><textarea required rows={2} value={f.domains} onChange={e=>setF({...f,domains:e.target.value})} placeholder="smithsgarage.co.uk"/></label>
      <div className="employeeModalRow"><label>Plan<select value={f.plan} onChange={e=>setF({...f,plan:e.target.value})}>{plans.map(p=><option key={p.key} value={p.key}>{p.name}{p.monthly_sessions?" · "+num(p.monthly_sessions)+" visits/month":" · unlimited"} · kept {p.retention_days} days</option>)}</select></label>
        <label>Recording starts<select value={f.consent_mode} onChange={e=>setF({...f,consent_mode:e.target.value})}><option value="wait">After the visitor accepts analytics cookies</option><option value="auto">Straight away</option></select></label></div>
      <label>Client or owner <small>Who the website belongs to — any business, it doesn't need to be in the CRM</small><input value={f.owner_name} onChange={e=>setF({...f,owner_name:e.target.value})} placeholder="e.g. Smith's Garage Ltd"/></label>
      {businesses.length>0&&<label>Link to one of our CRM businesses <small>Optional. Only for our own websites: links their website enquiries to the visit they came from</small><select value={f.business_unit_id} onChange={e=>setF({...f,business_unit_id:e.target.value})}><option value="">Not linked (client website)</option>{businesses.map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      {msg&&<p className="crmNotice">{msg}</p>}
      <div className="employeeFormActions"><button type="button" className="secondaryButton" onClick={close}>CANCEL</button><button className="crmPrimary" disabled={busy}>{busy?"SAVING…":site?"SAVE & CONTINUE":"CREATE & GET THE CODE"}</button></div>
    </form>}
    {step===2&&site&&<><InstallGuide supabase={supabase} site={site}/>
      <div className="employeeFormActions"><button type="button" className="secondaryButton" onClick={()=>setStep(1)}>BACK</button><button type="button" className="crmPrimary" onClick={()=>setStep(3)}>NEXT: INVITE PEOPLE</button></div></>}
    {step===3&&site&&<><InviteMany supabase={supabase} site={site} onSent={()=>setSent(true)}/>
      <div className="employeeFormActions"><button type="button" className="secondaryButton" onClick={()=>setStep(2)}>BACK</button><button type="button" className="crmPrimary" onClick={()=>onDone?.(site,true)}>{sent?"DONE — OPEN THE SITE":"SKIP — OPEN THE SITE"}</button></div></>}
  </div></div>;
}
