"use client";
import {useEffect,useState} from "react";
import {createClient} from "../lib/supabase";
import {SiteDashboard,AddSite} from "../components/SiteDashboard";
import {Admins,Account} from "../components/account";

// Insights: sign in, see your websites, open one for its dashboard. ?site=<id> opens a site; ?add=1 opens
// "Add a website" (Insights admins). Insights has its own admins and logins, separate from the CRM.
const num=(n:any)=>Number(n||0).toLocaleString("en-GB");
const ago=(v:string)=>{if(!v)return "No visits yet";const m=Math.round((Date.now()-new Date(v).getTime())/60000);return m<2?"Visited just now":m<60?"Last visit "+m+" min ago":m<1440?"Last visit "+Math.round(m/60)+" h ago":"Last visit "+new Date(v).toLocaleDateString("en-GB",{day:"numeric",month:"short"})};

export default function Insights(){
  const [supabase]=useState(()=>createClient());
  const [user,setUser]=useState<any>(undefined),[crmAdmin,setCrmAdmin]=useState(false),[sites,setSites]=useState<any[]|null>(null),[open,setOpen]=useState(""),[adding,setAdding]=useState(false),[businesses,setBusinesses]=useState<any[]>([]),[page,setPage]=useState<""|"admins"|"account">("");
  async function load(){
    const {data:{user:u}}=await supabase.auth.getUser();setUser(u||null);if(!u)return;
    await supabase.rpc("insights_claim_invites");
    const [{data:s},{data:me}]=await Promise.all([supabase.rpc("insights_my_sites"),supabase.rpc("insights_me")]);
    setSites(s||[]);const admin=!!me?.admin;setCrmAdmin(admin);
    // Our own CRM businesses, to link our own websites' enquiries to visits (admins only).
    if(admin){const {data:b}=await supabase.from("crm_businesses").select("id,name").order("name");setBusinesses(b||[])}
    const sp=new URLSearchParams(location.search),q=sp.get("site");if(q)setOpen(q);else if(sp.get("add")&&admin)setAdding(true);else if((s||[]).length===1)setOpen(s[0].id);
  }
  useEffect(()=>{void load();const {data:sub}=supabase.auth.onAuthStateChange((e:string)=>{if(e==="SIGNED_IN"||e==="SIGNED_OUT")void load()});return()=>sub.subscription.unsubscribe()},[]);
  function go(id:string){setPage("");setOpen(id);const u=new URL(location.href);if(id)u.searchParams.set("site",id);else u.searchParams.delete("site");u.searchParams.delete("visit");history.pushState({},"",u.pathname+u.search)}
  useEffect(()=>{const back=()=>setOpen(new URLSearchParams(location.search).get("site")||"");window.addEventListener("popstate",back);return()=>window.removeEventListener("popstate",back)},[]);
  if(user===undefined)return <main className="insShell"><p className="employeeMuted">Loading…</p></main>;
  if(!user)return <SignIn supabase={supabase}/>;
  const site=sites?.find(s=>s.id===open);
  return <main className="insShell">
    <header className="insTop"><button type="button" className="insBrand" onClick={()=>go("")}>INSIGHTS</button>
      {site&&<span className="insCrumb">/ {site.name}</span>}
      <span className="insUser">{crmAdmin&&<button type="button" className="employeeLinkButton" onClick={()=>{go("");setPage("admins")}}>Admins</button>}<button type="button" className="employeeLinkButton" onClick={()=>{go("");setPage("account")}}>{user.email}</button><button type="button" className="employeeLinkButton" onClick={()=>void supabase.auth.signOut()}>Sign out</button></span></header>
    {page==="admins"?<Admins supabase={supabase} me={user}/>:page==="account"?<Account supabase={supabase} user={user}/>:!sites?<p className="employeeMuted">Loading…</p>:site?<section className="reportsPage insSite">
      <div className="quoteSectionHead"><div><span className="crmKicker dark">{(site.domains||[]).join(" · ")}</span><h1>{site.name}</h1><p className="employeeMuted">{num(site.used)}{site.limit!=null?" of "+num(site.limit):""} visits this month · {site.plan} plan · you are {site.role==="admin"?"an administrator":"a "+site.role}</p></div>
        <div className="reportsLive">{sites.length>1&&<button type="button" className="secondaryButton" onClick={()=>go("")}>ALL SITES</button>}</div></div>
      <SiteDashboard key={site.id} supabase={supabase} site={site} crmAdmin={crmAdmin} onChanged={()=>void load()}/>
    </section>:<section className="insHome">
      <div className="quoteSectionHead"><div><h1>Your websites</h1><p className="employeeMuted">Visitors, funnels and screen recordings for the sites you've been given access to.</p></div>{crmAdmin&&<div className="reportsLive"><button type="button" className="crmPrimary" onClick={()=>setAdding(true)}>+ ADD WEBSITE</button></div>}</div>
      {!sites.length?<div className="reportPanel"><h2>No websites yet</h2><p className="employeeMuted">You'll see a website here once someone invites you to it. If you've just been invited, open the link in the invitation email.</p></div>
      :<div className="insCards">{sites.map(s=><button key={s.id} type="button" className="insCard" onClick={()=>go(s.id)}>
        <strong>{s.name}</strong><small>{s.owner_name?s.owner_name+" · ":""}{(s.domains||[]).join(" · ")}</small>
        <span className="insCardUse"><b>{num(s.used)}</b> visits this month{s.limit!=null?" of "+num(s.limit):""}</span>
        {s.limit!=null&&<span className="track"><i style={{width:Math.min(100,s.used/Math.max(1,s.limit)*100)+"%"}}/></span>}
        <small>{ago(s.last_visit)} · {s.role==="admin"?"Admin":s.role==="manager"?"Manager":"Viewer"}{!s.is_active?" · recording off":""}</small>
      </button>)}</div>}
    </section>}
    {adding&&<AddSite supabase={supabase} businesses={businesses} onCancel={()=>setAdding(false)} onDone={async(s:any)=>{setAdding(false);await load();go(s.id)}}/>}
  </main>;
}

function SignIn({supabase}:any){
  const [mode,setMode]=useState<"password"|"link">("password"),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget),email=String(f.get("email")||"").trim();setBusy(true);setMsg("");
    try{
      if(mode==="password"){const {error}=await supabase.auth.signInWithPassword({email,password:String(f.get("password")||"")});if(error)throw new Error("That email and password don't match.")}
      else{await supabase.functions.invoke("insights-admin",{body:{action:"login_link",email}});setMsg("If that email has access to a website, a sign-in link is on its way. It works once and expires after 24 hours.")}
    }catch(err:any){setMsg(err.message)}finally{setBusy(false)}
  }
  return <main className="insLogin"><form className="insLoginCard" onSubmit={submit}>
    <div className="insBrand">INSIGHTS</div>
    <h1>Sign in</h1><p className="employeeMuted">Website visits, funnels and screen recordings.</p>
    <label>Email<input name="email" type="email" required autoComplete="email"/></label>
    {mode==="password"&&<label>Password<input name="password" type="password" required autoComplete="current-password"/></label>}
    <button className="crmPrimary" disabled={busy}>{busy?"…":mode==="password"?"SIGN IN":"EMAIL ME A SIGN-IN LINK"}</button>
    <button type="button" className="employeeLinkButton" onClick={()=>{setMode(mode==="password"?"link":"password");setMsg("")}}>{mode==="password"?"Forgotten your password? Email me a sign-in link":"Sign in with a password instead"}</button>
    {msg&&<p className="crmNotice">{msg}</p>}
  </form></main>;
}
