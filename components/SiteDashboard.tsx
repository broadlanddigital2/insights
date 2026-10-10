"use client";
import {useEffect,useState} from "react";
import {Panel,Empty,Table} from "./ui";
import {REC,num,pct,dur,when,rpc,Card,Stat,Nothing} from "./lib";
import {Overview,Events,Performance,Errors} from "./reports";
import {Sessions,Users} from "./people";
import {Metrics} from "./metrics";
export {Player} from "./player";
import {InstallGuide,InviteMany,snippet} from "./setup";
export {AddSite,snippet} from "./setup";

// Insights: real-user monitoring for one website — overview, sessions (with replays), users (every visit joined up
// to the person), events, funnels, web vitals and errors — plus its tracking code, settings and team.
// Used in the CRM (Marketing → Website) and in the standalone Insights app; row level security limits everything
// to the sites the signed-in person is on (CRM admins see all).
const iso=(d:Date)=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function ranges():[string,string,string,string][]{
  const now=new Date(),back=(n:number)=>iso(new Date(now.getFullYear(),now.getMonth(),now.getDate()-n)),today=iso(now);
  return [["today","Today",today,today],["yesterday","Yesterday",back(1),back(1)],["7d","Last 7 days",back(6),today],["14d","Last 14 days",back(13),today],["30d","Last 30 days",back(29),today],["90d","Last 90 days",back(89),today],
    ["month","This month",iso(new Date(now.getFullYear(),now.getMonth(),1)),today],["last_month","Last month",iso(new Date(now.getFullYear(),now.getMonth()-1,1)),iso(new Date(now.getFullYear(),now.getMonth(),0))]];
}
const NAV:[string,string,string][]=[["overview","Overview","◎"],["sessions","Sessions","▶"],["users","Users","◉"],["events","Events","⚡"],["funnels","Funnels","⏷"],["metrics","Metrics","▤"],["vitals","Web vitals","◔"],["errors","Errors","⚠"]];

export function SiteDashboard({supabase,site,crmAdmin=false,onChanged}:{supabase:any;site:any;crmAdmin?:boolean;onChanged?:()=>void}){
  const all=ranges();
  const [preset,setPreset]=useState("14d"),[from,setFrom]=useState(all[3][2]),[to,setTo]=useState(all[3][3]);
  const [view,setView]=useState("overview"),[ov,setOv]=useState<any>(null),[notice,setNotice]=useState(""),[userKey,setUserKey]=useState(""),[visit,setVisit]=useState(""),[stamp,setStamp]=useState(0);
  const manage=crmAdmin||site.role==="manager"||site.role==="admin";
  // Light or dark, remembered on this device (dark unless chosen otherwise, like Better Stack).
  const [theme,setTheme]=useState<"dark"|"light">("dark");
  useEffect(()=>{try{const t=localStorage.getItem("ins-theme");if(t==="light"||t==="dark")setTheme(t)}catch{}},[]);
  const flip=()=>{const t=theme==="dark"?"light":"dark";setTheme(t);try{localStorage.setItem("ins-theme",t)}catch{}};
  async function load(){try{setOv(await rpc(supabase,"insights_overview",{p_site:site.id,p_from:from,p_to:to}));setNotice("")}catch(e:any){setNotice(e.message)}}
  useEffect(()=>{const q=new URLSearchParams(location.search),h=location.hash.replace("#","");
    if(q.get("visit")){setVisit(q.get("visit")!);setView("sessions")}else if(NAV.some(n=>n[0]===h)||["setup","team"].includes(h))setView(h)},[]);
  useEffect(()=>{setOv(null);void load();const t=setInterval(()=>void load(),120_000);return()=>clearInterval(t)},[site.id,from,to,stamp]);
  function pick(k:string){const p=all.find(x=>x[0]===k);setPreset(k);if(p){setFrom(p[2]);setTo(p[3])}}
  function go(v:string){setView(v);if(v!=="users")setUserKey("");try{history.replaceState({},"",location.pathname+location.search+"#"+v)}catch{}}
  const openUser=(k:string)=>{if(!k)return;setUserKey(k);go("users")};
  const t=ov?.totals||{};
  const counts:Record<string,any>={sessions:t.sessions,users:t.users,events:t.events,errors:t.error_count};
  const ranged=!["setup","team"].includes(view);
  const label=all.find(x=>x[0]===preset)?.[1]||"Custom range";
  return <div className={"rum"+(theme==="light"?" light":"")}>
    <nav className="rumNav" aria-label="Insights">
      <div className="rumSite"><span className={"rumLive"+(site.is_active===false?" off":"")}/><div><b>{site.name}</b><small>{(site.domains||[])[0]}</small></div></div>
      {NAV.map(([k,l,i])=><button key={k} type="button" className={view===k?"active":""} onClick={()=>go(k)}><span className="ic" aria-hidden="true">{i}</span>{l}{counts[k]!=null&&<em>{Number(counts[k])>999?Math.round(counts[k]/100)/10+"k":counts[k]}</em>}</button>)}
      {manage&&<><span className="rumNavHead">Settings</span>
        <button type="button" className={view==="setup"?"active":""} onClick={()=>go("setup")}><span className="ic" aria-hidden="true">⌘</span>Tracking & settings</button>
        <button type="button" className={view==="team"?"active":""} onClick={()=>go("team")}><span className="ic" aria-hidden="true">☺</span>Team</button></>}
      <div className="rumUsage"><small>{num(site.used)}{site.limit!=null?" / "+num(site.limit):""} sessions this month</small>{site.limit!=null&&<span><i style={{width:Math.min(100,site.used/Math.max(1,site.limit)*100)+"%"}}/></span>}</div>
    </nav>
    <main className="rumMain">
      <div className="rumTop">
        <h1>{view==="setup"?"Tracking & settings":view==="team"?"Team":NAV.find(n=>n[0]===view)?.[1]}</h1>
        <div className="rumTopRight">
        {ranged&&<div className="rumRange">
          <select value={preset} onChange={e=>pick(e.target.value)} aria-label="Date range">{all.map(([k,l])=><option key={k} value={k}>{l}</option>)}{preset==="custom"&&<option value="custom">Custom range</option>}</select>
          <input type="date" value={from} max={to} onChange={e=>{setPreset("custom");setFrom(e.target.value)}} aria-label="From"/>
          <span>→</span>
          <input type="date" value={to} min={from} onChange={e=>{setPreset("custom");setTo(e.target.value)}} aria-label="To"/>
          <button type="button" className="rumBtn" onClick={()=>setStamp(Date.now())} title={"Refresh — "+label}>↻</button>
        </div>}
        <button type="button" className="rumBtn rumTheme" onClick={flip} aria-label={theme==="dark"?"Switch to light view":"Switch to dark view"} title={theme==="dark"?"Light view":"Dark view"}>{theme==="dark"?"☀":"☾"}</button>
        </div>
      </div>
      {notice&&<p className="rumNotice" role="status">{notice}</p>}
      {site.limit!=null&&site.used>=site.limit&&<p className="rumNotice">This site has used all {num(site.limit)} sessions on its {site.plan} plan this month, so new visits aren't being recorded until next month.</p>}
      {view==="overview"&&<Overview ov={ov} go={go}/>}
      {view==="sessions"&&<Sessions supabase={supabase} site={site} from={from} to={to} ov={ov} openUser={openUser} initialVisit={visit}/>}
      {view==="users"&&<Users supabase={supabase} site={site} from={from} to={to} ov={ov} userKey={userKey} setUserKey={setUserKey}/>}
      {view==="events"&&<Events supabase={supabase} site={site} from={from} to={to}/>}
      {view==="funnels"&&<Funnels supabase={supabase} site={site} manage={manage} from={from} to={to}/>}
      {view==="metrics"&&<Metrics supabase={supabase} site={site} from={from} to={to} manage={manage}/>}
      {view==="vitals"&&<Performance supabase={supabase} site={site} from={from} to={to}/>}
      {view==="errors"&&<Errors supabase={supabase} site={site} from={from} to={to}/>}
      {view==="setup"&&<SiteSetup supabase={supabase} site={site} crmAdmin={crmAdmin} onChanged={onChanged}/>}
      {view==="team"&&<Team supabase={supabase} site={site}/>}
    </main>
  </div>;
}

// Funnels: ordered steps — a page, an event (optionally with a property value), a click on a button or link, or a
// form — counted per session ("in one visit") or per user ("across visits"), with drop-off and time between steps.
const STEP_TYPES:[string,string][]=[["page","Visits a page"],["event","Triggers an event"],["click","Clicks a button or link"],["form","Sends a form"]];
const blank=()=>({label:"",type:"page",value:"",prop:"",prop_value:""});
function stepName(s:any){return s.label||(s.type==="page"?"Page "+(s.value||"/"):s.type==="event"?s.value+(s.prop?" ("+s.prop+" "+s.prop_value+")":""):s.type==="click"?"Clicked “"+s.value+"”":"Sent a form"+(s.value?" on "+s.value:""))}
function FunnelResult({r,by}:{r:any;by:string}){
  if(!r)return <Nothing text="Calculating…"/>;if(r.error)return <p className="rumNotice">{r.error}</p>;if(!r.length)return <Nothing text="No steps."/>;
  const first=r[0].count||0,last=r[r.length-1].count||0,unit=by==="users"?"users":"sessions";
  return <>
    <div className="rumFunnelSum"><span><b>{pct(last,first)}</b> converted</span><span><b>{num(first)}</b> {unit} started</span><span><b>{num(last)}</b> completed</span></div>
    <ol className="rumFunnel">{r.map((s:any,i:number)=>{const prev=i?r[i-1].count:0,lost=i?prev-s.count:0;return <li key={i}>
      <div className="h"><b>{i+1}. {s.label||"Sent a form"}</b><span>{num(s.count)} {unit} · {pct(s.count,first)}</span></div>
      <span className="track"><i style={{width:Math.max(.5,first?s.count/first*100:0)+"%"}}/></span>
      {i>0&&<small className={lost>0?"lost":""}>{lost>0?"↘ "+num(lost)+" dropped off ("+pct(lost,prev)+")":"No drop-off"}{s.avg_seconds!=null?" · avg. "+dur(s.avg_seconds)+" from the previous step":""}</small>}
    </li>})}</ol>
  </>;
}
function Funnels({supabase,site,manage,from,to}:any){
  const [list,setList]=useState<any[]>([]),[results,setResults]=useState<Record<string,any>>({}),[edit,setEdit]=useState<any>(null),[preview,setPreview]=useState<any>(null),[notice,setNotice]=useState(""),[eventNames,setEventNames]=useState<string[]>([]);
  async function load(){const {data,error}=await supabase.from("marketing_funnels").select("*").eq("is_active",true).eq("site_id",site.id).order("sort_order");if(error){setNotice(error.message);return}setList(data||[]);
    for(const f of data||[])void rpc(supabase,"insights_funnel",{p_funnel:f.id,p_from:from,p_to:to}).then(r=>setResults(x=>({...x,[f.id]:r||[]}))).catch(e=>setResults(x=>({...x,[f.id]:{error:e.message}})))}
  useEffect(()=>{void load()},[site.id,from,to]);
  useEffect(()=>{void rpc(supabase,"insights_events",{p_site:site.id,p_from:from,p_to:to}).then(d=>setEventNames((d?.events||[]).map((e:any)=>e.name))).catch(()=>{})},[site.id]);
  const clean=(st:any[])=>st.filter((s:any)=>s.type==="form"||String(s.value||"").trim()||s.type==="page").map((s:any)=>({label:s.label.trim()||stepName(s),type:s.type,value:String(s.value||"").trim(),...(s.type==="event"&&s.prop?{prop:s.prop.trim(),prop_value:String(s.prop_value||"").trim()}:{})}));
  async function save(e:any){e.preventDefault();const steps=clean(edit.steps);if(steps.length<2){setNotice("Add at least two steps.");return}
    const row={site_id:site.id,business_unit_id:site.business_unit_id||null,name:edit.name.trim(),steps,count_by:edit.count_by||"sessions",sort_order:Number(edit.sort_order||0),updated_at:new Date().toISOString()};
    const {error}=edit.id?await supabase.from("marketing_funnels").update(row).eq("id",edit.id):await supabase.from("marketing_funnels").insert(row);if(error){setNotice(error.message);return}
    setEdit(null);setPreview(null);setNotice("Funnel saved.");void load()}
  async function tryIt(){setPreview("…");try{setPreview(await rpc(supabase,"insights_funnel_steps",{p_site:site.id,p_steps:clean(edit.steps),p_from:from,p_to:to,p_by:edit.count_by||"sessions"}))}catch(e:any){setPreview({error:e.message})}}
  const hide=async(f:any)=>{if(!window.confirm("Remove the funnel \""+f.name+"\"?"))return;await supabase.from("marketing_funnels").update({is_active:false}).eq("id",f.id);void load()};
  const setStep=(i:number,v:any)=>{const st=[...edit.steps];st[i]={...st[i],...v};setEdit({...edit,steps:st});setPreview(null)};
  return <>
    <div className="rumBarRow"><p className="rumHelp">See how many sessions or people get through each step, and where they give up. Steps can be pages, events, clicks or forms, and must happen in order.</p>
      {manage&&<button type="button" className="rumBtn go" onClick={()=>setEdit({name:"",count_by:"sessions",steps:[blank(),blank()]})}>+ New funnel</button>}</div>
    {notice&&<p className="rumNotice">{notice}</p>}
    {!list.length&&<Nothing text="No funnels for this site yet."/>}
    {list.map(f=><Card key={f.id} title={f.name} note={(f.steps||[]).length+" steps · counted by "+(f.count_by==="users"?"user, across visits":"session, in one visit")}
      right={manage&&<span className="rumActions"><button type="button" className="rumBtn" onClick={()=>{setEdit({...f,steps:f.steps.map((s:any)=>({...blank(),...s}))});setPreview(null)}}>Edit</button><button type="button" className="rumBtn" onClick={()=>void hide(f)}>Remove</button></span>}>
      <FunnelResult r={results[f.id]} by={f.count_by}/>
    </Card>)}
    {edit&&<div className="employeeModalBackdrop" role="dialog" aria-modal="true" aria-label="Funnel" onClick={e=>{if(e.target===e.currentTarget)setEdit(null)}}><form className="employeeModal signagePackageForm rumFunnelForm" onSubmit={save}>
      <h2>{edit.id?"Edit funnel":"New funnel"}</h2>
      <div className="employeeModalRow"><label>Name<input required value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})} placeholder="e.g. Quote requests"/></label>
        <label>Count<select value={edit.count_by||"sessions"} onChange={e=>{setEdit({...edit,count_by:e.target.value});setPreview(null)}}><option value="sessions">Sessions — steps in one visit</option><option value="users">Users — steps across any of their visits</option></select></label></div>
      <datalist id="rumEventNames">{eventNames.map(n=><option key={n} value={n}/>)}</datalist>
      {edit.steps.map((s:any,i:number)=><fieldset key={i} className="webStep rumStep"><legend>Step {i+1}</legend>
        <label>What happens<select value={s.type} onChange={e=>setStep(i,{type:e.target.value})}>{STEP_TYPES.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        {s.type==="page"&&<label>Page address contains<input value={s.value} onChange={e=>setStep(i,{value:e.target.value})} placeholder="/van-wraps (/ for the home page)"/></label>}
        {s.type==="event"&&<label>Event name<input list="rumEventNames" required value={s.value} onChange={e=>setStep(i,{value:e.target.value})} placeholder="e.g. Quote requested"/></label>}
        {s.type==="click"&&<label>Button or link text contains<input required value={s.value} onChange={e=>setStep(i,{value:e.target.value})} placeholder="e.g. Get a quote"/></label>}
        {s.type==="form"&&<label>On a page containing <small>optional</small><input value={s.value} onChange={e=>setStep(i,{value:e.target.value})} placeholder="any page"/></label>}
        {s.type==="event"&&<label>Where property <small>optional</small><span className="rumPair"><input value={s.prop||""} onChange={e=>setStep(i,{prop:e.target.value})} placeholder="property"/><input value={s.prop_value||""} onChange={e=>setStep(i,{prop_value:e.target.value})} placeholder="contains"/></span></label>}
        <label>Step name <small>optional</small><input value={s.label} onChange={e=>setStep(i,{label:e.target.value})} placeholder={stepName(s)}/></label>
        {edit.steps.length>2&&<button type="button" className="employeeLinkButton" onClick={()=>{setEdit({...edit,steps:edit.steps.filter((_:any,k:number)=>k!==i)});setPreview(null)}}>Remove step</button>}
      </fieldset>)}
      <button type="button" className="employeeLinkButton" onClick={()=>setEdit({...edit,steps:[...edit.steps,blank()]})}>+ Add a step</button>
      {preview&&<div className="rumPreview">{preview==="…"?<p className="employeeMuted">Calculating…</p>:<FunnelResult r={preview} by={edit.count_by}/>}</div>}
      <div className="employeeFormActions"><button type="button" className="secondaryButton" onClick={()=>setEdit(null)}>CANCEL</button><button type="button" className="secondaryButton" onClick={()=>void tryIt()}>PREVIEW</button><button className="crmPrimary">SAVE FUNNEL</button></div>
    </form></div>}
  </>;
}

async function admin(supabase:any,body:any){
  const {data,error}=await supabase.functions.invoke("insights-admin",{body});
  if(error){const v=await error.context?.json?.().catch(()=>null);throw new Error(v?.error||error.message)}
  if(data?.error)throw new Error(data.error);return data;
}

function SiteSetup({supabase,site,crmAdmin,onChanged}:any){
  const [f,setF]=useState<any>({name:site.name,domains:(site.domains||[]).join("\n"),consent_mode:site.consent_mode,plan:site.plan_key,session_limit:"",retention_days:"",is_active:site.is_active});
  const [plans,setPlans]=useState<any[]>([]),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false);
  useEffect(()=>{if(crmAdmin)void supabase.from("insight_plans").select("*").order("sort_order").then(({data}:any)=>setPlans(data||[]))},[]);
  useEffect(()=>{if(crmAdmin)void supabase.from("insight_sites").select("session_limit,retention_days").eq("id",site.id).maybeSingle().then(({data}:any)=>data&&setF((x:any)=>({...x,session_limit:data.session_limit??"",retention_days:data.retention_days??""})))},[site.id]);
  async function save(e:any){e.preventDefault();setBusy(true);setMsg("");try{
    const body:any={action:"update_site",site_id:site.id,name:f.name,domains:f.domains,consent_mode:f.consent_mode};
    if(crmAdmin)Object.assign(body,{plan:f.plan,session_limit:f.session_limit,retention_days:f.retention_days,is_active:f.is_active});
    await admin(supabase,body);setMsg("Saved.");onChanged?.()}catch(err:any){setMsg(err.message)}finally{setBusy(false)}}
  async function newKey(){if(!window.confirm("Make a new site key? The tracking code on the website must be replaced, or recording stops."))return;setBusy(true);try{await admin(supabase,{action:"new_key",site_id:site.id});setMsg("New key made. Copy the new tracking code onto the website.");onChanged?.()}catch(err:any){setMsg(err.message)}finally{setBusy(false)}}
  return <>
    <Panel title="Install on the website" note="The tracking code is unique to this site">
      <InstallGuide supabase={supabase} site={site} compact/>
      <div className="adsConnect"><button type="button" className="secondaryButton" disabled={busy} onClick={()=>void newKey()}>MAKE A NEW SITE KEY</button></div>
    </Panel>
    <Panel title="People, events and privacy">
      <div className="insHelp"><p><b>People and events:</b> when someone signs in or sends a form, tell Insights who they are so all their visits join up on one profile, and send your own events to count and use in funnels:</p>
        <pre className="insCode">{`Insights.identify("customer-123", { email: "jo@example.com", name: "Jo Bloggs" })
Insights.track("Quote requested", { service: "Full wrap" })
Insights.reset()   // when they sign out`}</pre>
        <p>Clicks, rage clicks, forms, downloads, outbound/phone/email links, JavaScript errors and page speed (Core Web Vitals) are collected automatically. Add <code>data-replay="off"</code> to the script tag to collect analytics without screen recordings.</p></div>
      <p className="insHelp">Typing in forms is always hidden. Add <code>data-private</code> to any element to hide its text, or <code>data-no-record</code> to leave it out completely. Console errors, warnings and failed requests are recorded with each visit.</p>
        </Panel>
    <Panel title="Usage" note="Visits recorded this calendar month">
      <div className="insUsage"><div><b>{num(site.used)}</b><span>{site.limit!=null?"of "+num(site.limit)+" visits":"visits (no limit)"}</span></div>{site.limit!=null&&<span className="track"><i style={{width:Math.min(100,site.used/Math.max(1,site.limit)*100)+"%"}}/></span>}<small>{site.plan} plan · recordings kept {site.retention_days} days</small></div>
    </Panel>
    <Panel title="Settings">
      <form className="signagePackageForm insForm" onSubmit={save}>
        <label>Site name<input required value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></label>
        <label>Website domains <small>One per line. Subdomains are included (example.com also covers shop.example.com).</small><textarea rows={3} value={f.domains} onChange={e=>setF({...f,domains:e.target.value})}/></label>
        <label>Recording starts<select value={f.consent_mode} onChange={e=>setF({...f,consent_mode:e.target.value})}><option value="wait">When the visitor accepts analytics cookies (recommended)</option><option value="auto">Straight away</option></select></label>
        {crmAdmin&&<fieldset className="signageScreenPick"><legend>Plan (CRM admins only)</legend>
          <div className="employeeModalRow"><label>Plan<select value={f.plan} onChange={e=>setF({...f,plan:e.target.value})}>{plans.map(p=><option key={p.key} value={p.key}>{p.name}{p.monthly_sessions?" · "+num(p.monthly_sessions)+" visits/month":" · unlimited"} · {p.retention_days} days</option>)}</select></label>
            <label>Own monthly limit<input type="number" min={0} value={f.session_limit} onChange={e=>setF({...f,session_limit:e.target.value})} placeholder="Use the plan's"/></label>
            <label>Keep recordings (days)<input type="number" min={7} max={730} value={f.retention_days} onChange={e=>setF({...f,retention_days:e.target.value})} placeholder="Use the plan's"/></label></div>
          <label className="jobCheck"><input type="checkbox" checked={f.is_active} onChange={e=>setF({...f,is_active:e.target.checked})}/>Recording switched on</label></fieldset>}
        <div className="employeeFormActions"><button className="crmPrimary" disabled={busy}>SAVE</button></div>
        {msg&&<p className="crmNotice">{msg}</p>}
      </form>
    </Panel>
  </>;
}

function Team({supabase,site}:any){
  const [rows,setRows]=useState<any[]>([]),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  async function load(){const {data,error}=await supabase.from("insight_site_members").select("*").eq("site_id",site.id).order("invited_at");if(error)setMsg(error.message);else setRows(data||[])}
  useEffect(()=>{void load()},[site.id]);
  async function act(body:any,done:string){setBusy(true);setMsg("");try{const r=await admin(supabase,{site_id:site.id,...body});setMsg(done+(r.new_login===false?" They already have a login, so the email signs them straight in.":""));await load()}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  return <>
    <Panel title="Invite people to this website" note="Each person only sees the websites they're invited to">
      <InviteMany supabase={supabase} site={site} onSent={()=>void load()}/>
      {msg&&<p className="crmNotice">{msg}</p>}
    </Panel>
    <Panel title="People with access" note="CRM admins and super users can also see every site">
      {rows.length?<Table cols={["Person","Access","Status",""]} rows={rows.map(m=>[m.email,
        <select key="r" value={m.role} disabled={busy} onChange={e=>void act({action:"set_role",member_id:m.id,role:e.target.value},"Access changed.")}><option value="viewer">Viewer</option><option value="manager">Manager</option></select>,
        m.accepted_at?"Joined "+when(m.accepted_at):"Invited "+when(m.invited_at),
        <span key="a" className="insActions">{!m.accepted_at&&<button type="button" className="secondaryButton" disabled={busy} onClick={()=>void act({action:"resend",email:m.email},"Invitation sent again.")}>RESEND</button>}
          <button type="button" className="secondaryButton" disabled={busy} onClick={()=>{if(window.confirm("Remove "+m.email+" from "+site.name+"?"))void act({action:"remove_member",member_id:m.id},"Removed.")}}>REMOVE</button></span>])}/>:<Empty text="Nobody has been invited yet."/>}
    </Panel>
  </>;
}
