"use client";
import {useEffect,useState} from "react";
import {num,pct,dur,when,clock,ago,range,Card,Stat,Grid,Nothing,Who,Place,Sys,Avatar,userLabel,identified,eventLabel,eventLine,Vital,TimeChart,C,placeOf,day} from "./lib";
import {Player} from "./player";

// Sessions (every visit, with who it was, where from, device, pages, events, errors and the replay) and Users (everyone
// who has visited, with all their visits and events on one profile). A person's visits are joined up by the
// browser's visitor ID, and across devices once the site identifies them (Insights.identify).
const PAGE=50;
const safe=(q:string)=>q.replace(/[,()"*\\]/g," ").trim();

export function Sessions({supabase,site,from,to,ov,openUser,initialVisit}:any){
  const [rows,setRows]=useState<any[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[notice,setNotice]=useState("");
  const [q,setQ]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(""),[place,setPlace]=useState(""),[device,setDevice]=useState(""),[browser,setBrowser]=useState(""),[flags,setFlags]=useState<string[]>([]);
  const [open,setOpen]=useState<any>(null);
  async function load(offset=0){setLoading(true);try{
    const {f,t}=range(from,to);
    let x=supabase.from("web_sessions").select("*").eq("site_id",site.id).gt("page_count",0).gte("started_at",f).lt("started_at",t).order("started_at",{ascending:false}).range(offset,offset+PAGE-1);
    if(search){const s=safe(search);if(s)x=x.or(`user_email.ilike.*${s}*,user_name.ilike.*${s}*,user_key.ilike.*${s}*`)}
    if(page)x=x.contains("paths",[page]);
    if(place.startsWith("c:"))x=x.eq("country",place.slice(2));else if(place.startsWith("tz:"))x=x.is("country",null).eq("timezone",place.slice(3));
    if(device)x=device==="Unknown"?x.is("device",null):x.eq("device",device);
    if(browser)x=browser==="Unknown"?x.is("browser",null):x.eq("browser",browser);
    for(const fl of flags){
      if(fl==="replay")x=x.gt("chunk_count",0);if(fl==="errors")x=x.gt("error_count",0);if(fl==="rage")x=x.gt("rage_clicks",0);if(fl==="forms")x=x.eq("form_submitted",true);
      if(fl==="ads")x=x.not("gclid","is",null);if(fl==="known")x=x.like("user_key","u:%");if(fl==="leads")x=x.not("lead_id","is",null);if(fl==="bounce")x=x.eq("page_count",1);
    }
    const {data,error}=await x;if(error)throw error;setRows(offset?[...rows,...(data||[])]:data||[]);setMore((data||[]).length===PAGE);setNotice("")}catch(e:any){setNotice(e.message)}finally{setLoading(false)}}
  useEffect(()=>{void load()},[site.id,from,to,search,page,place,device,browser,flags.join()]);
  useEffect(()=>{if(initialVisit)void supabase.from("web_sessions").select("*").eq("id",initialVisit).maybeSingle().then(({data}:any)=>{if(data)setOpen(data)})},[initialVisit]);
  const toggle=(k:string)=>setFlags(f=>f.includes(k)?f.filter(x=>x!==k):[...f,k]);
  const FLAGS:[string,string][]=[["replay","Has replay"],["known","Identified"],["errors","Errors"],["rage","Rage clicks"],["forms","Sent a form"],["ads","From ads"],["bounce","One page"],...(site.business_unit_id?[["leads","Became a lead"]] as [string,string][]:[])];
  const any=search||page||place||device||browser||flags.length;
  const t=ov?.totals||{};
  return <>
    <div className="rumStats">
      <Stat label="Sessions" value={num(t.sessions)} note={num(t.pageviews)+" page views"}/>
      <Stat label="Avg. duration" value={dur(t.avg_seconds)}/>
      <Stat label="Pages / session" value={t.sessions?(t.pageviews/t.sessions).toFixed(1):"–"}/>
      <Stat label="Bounce rate" value={pct(t.bounced,t.sessions)} tone={t.sessions&&t.bounced/t.sessions>.6?"warn":""}/>
      <Stat label="With errors" value={num(t.errors)} note={pct(t.errors,t.sessions)} tone={t.errors?"bad":""} onClick={()=>toggle("errors")} active={flags.includes("errors")}/>
      <Stat label="Replays" value={num(t.replays)} onClick={()=>toggle("replay")} active={flags.includes("replay")}/>
    </div>
    <Card><TimeChart rows={ov?.daily||[]} series={[{key:"sessions",label:"Sessions",color:C.primary}]} height={150}/></Card>
    <div className="rumFilters">
      <form onSubmit={e=>{e.preventDefault();setSearch(q.trim())}}><input type="search" value={q} onChange={e=>{setQ(e.target.value);if(!e.target.value)setSearch("")}} placeholder="Search people by name, email or ID"/></form>
      <select value={place} onChange={e=>setPlace(e.target.value)} aria-label="Location"><option value="">All locations</option>{(ov?.countries||[]).map((c:any)=>{const v=c.country?"c:"+c.country:"tz:"+c.timezone;return <option key={v} value={v}>{placeOf(c).label}{c.country?"":" (time zone)"} · {num(c.sessions)}</option>})}</select>
      <select value={device} onChange={e=>setDevice(e.target.value)} aria-label="Device"><option value="">All devices</option>{(ov?.devices||[]).map((d:any)=><option key={d.label} value={d.label}>{d.label} · {num(d.sessions)}</option>)}</select>
      <select value={browser} onChange={e=>setBrowser(e.target.value)} aria-label="Browser"><option value="">All browsers</option>{(ov?.browsers||[]).map((d:any)=><option key={d.label} value={d.label}>{d.label} · {num(d.sessions)}</option>)}</select>
      <form onSubmit={e=>{e.preventDefault();setPage((e.currentTarget.elements.namedItem("p") as HTMLInputElement).value.trim())}}><input name="p" defaultValue={page} placeholder="Visited page, e.g. /contact"/></form>
      <div className="rumChips">{FLAGS.map(([k,l])=><button key={k} type="button" className={flags.includes(k)?"on":""} onClick={()=>toggle(k)}>{l}</button>)}</div>
      {any?<button type="button" className="rumLink" onClick={()=>{setQ("");setSearch("");setPage("");setPlace("");setDevice("");setBrowser("");setFlags([])}}>Clear filters</button>:null}
    </div>
    {notice&&<p className="rumNotice">{notice}</p>}
    <Card className="flush">
      {loading&&!rows.length?<Nothing text="Loading…"/>:<Grid onRow={setOpen} empty="No sessions match." rows={rows} cols={[
        {key:"u",label:"User",render:r=><span onClick={e=>{e.stopPropagation();openUser?.(r.user_key)}} className="rumWhoLink"><Who u={r} sub={r.user_email&&r.user_name?r.user_email:identified(r)?"Identified":""}/></span>},
        {key:"pl",label:"Location",render:r=><Place r={r}/>},
        {key:"sys",label:"System",render:r=><Sys r={r}/>},
        {key:"start",label:"Started",render:r=><span className="rumNowrap" title={new Date(r.started_at).toLocaleString("en-GB")}>{when(r.started_at)}</span>},
        {key:"d",label:"Duration",num:true,render:r=>dur((r.duration_ms||0)/1000)},
        {key:"p",label:"Pages",num:true,render:r=>num(r.page_count)},
        {key:"e",label:"Errors",num:true,render:r=>r.error_count?<span className="rumBad">{num(r.error_count)}</span>:<span className="rumDim">0</span>},
        {key:"f",label:"",render:r=><span className="rumTags">{r.lead_id&&<em className="lead">Lead</em>}{r.form_submitted&&<em>Form</em>}{r.gclid&&<em className="ad">Ad</em>}{r.rage_clicks>0&&<em className="warn">Rage</em>}{r.chunk_count>0&&<em className="replay">▶ Replay</em>}</span>},
      ]}/>}
      {more&&<button type="button" className="rumMore" disabled={loading} onClick={()=>void load(rows.length)}>{loading?"Loading…":"Load more sessions"}</button>}
    </Card>
    {open&&<SessionDrawer supabase={supabase} session={open} onClose={()=>{setOpen(null);clearVisit()}} openUser={openUser}/>}
  </>;
}
function clearVisit(){const u=new URL(location.href);if(u.searchParams.has("visit")){u.searchParams.delete("visit");history.replaceState({},"",u.pathname+u.search)}}

// One session: who, where, what system, then everything that happened in order (pages with their speed, clicks,
// custom events, errors, forms), with the replay a click away.
export function SessionDrawer({supabase,session:s,onClose,openUser}:any){
  const [items,setItems]=useState<any[]|null>(null),[clicks,setClicks]=useState(false),[watch,setWatch]=useState(false),[visits,setVisits]=useState<number|null>(null);
  useEffect(()=>{let alive=true;(async()=>{
    const [pv,ev,uv]=await Promise.all([supabase.from("insight_pageviews").select("*").eq("session_id",s.id).order("ts"),supabase.from("insight_events").select("*").eq("session_id",s.id).order("ts").limit(1000),
      s.user_key?supabase.from("web_sessions").select("id",{count:"exact",head:true}).eq("site_id",s.site_id).eq("user_key",s.user_key):Promise.resolve({count:null})]);
    if(!alive)return;
    const pages=(pv.data||[]).map((p:any)=>({kind:"page",ts:p.ts,...p}));
    const legacy=!pages.length?(s.paths||[]).map((p:string,i:number)=>({kind:"page",path:p,ts:null,id:"l"+i})):[];
    setItems([...pages,...(ev.data||[]).filter((e:any)=>e.name!=="$pageview").map((e:any)=>({kind:"event",...e})),...legacy].sort((a:any,b:any)=>a.ts&&b.ts?new Date(a.ts).getTime()-new Date(b.ts).getTime():0));
    setVisits((uv as any).count??null);
  })();return()=>{alive=false}},[s.id]);
  const shown=(items||[]).filter(i=>clicks||i.name!=="$click");
  const t0=s.started_at?new Date(s.started_at).getTime():0;
  const rel=(ts:string)=>{if(!ts)return "";const ms=Math.max(0,new Date(ts).getTime()-t0);const x=Math.floor(ms/1000);return "+"+Math.floor(x/60)+":"+String(x%60).padStart(2,"0")};
  const place=placeOf(s);
  return <div className="rumDrawerBack" role="dialog" aria-modal="true" aria-label="Session" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="rumDrawer">
    <header><div><span className="rumKicker">Session · {when(s.started_at)}</span><h2><Avatar u={s} size={32}/>{userLabel(s)}</h2>
      <p>{[s.user_email&&s.user_name?s.user_email:"",visits!=null&&visits>1?visits+" visits in total":"First visit",place.label].filter(Boolean).join(" · ")}</p></div>
      <button type="button" className="rumClose" onClick={onClose} aria-label="Close">×</button></header>
    <div className="rumDrawerActions">
      {s.chunk_count>0?<button type="button" className="rumBtn go" onClick={()=>setWatch(true)}>▶ Watch replay</button>:<span className="rumDim">No screen recording for this session</span>}
      {openUser&&s.user_key&&<button type="button" className="rumBtn" onClick={()=>{onClose();openUser(s.user_key)}}>View user profile</button>}
    </div>
    <div className="rumMini">
      <Stat label="Duration" value={dur((s.duration_ms||0)/1000)}/><Stat label="Pages" value={num(s.page_count)}/><Stat label="Clicks" value={num(s.click_count)}/>
      <Stat label="Errors" value={num(s.error_count)} tone={s.error_count?"bad":""}/>
    </div>
    <dl className="rumKv">
      {([["Location",[place.label,place.city].filter(Boolean).join(" · ")],["Device",[s.device,s.screen,s.touch?"touch":""].filter(Boolean).join(" · ")],["Browser",[s.browser,s.browser_version].filter(Boolean).join(" ")],["OS",[s.os,s.os_version].filter(Boolean).join(" ")],
        ["Window",s.viewport],["Language",s.language],["Connection",s.connection],["Source",s.utm_source||(s.gclid?"Google Ads":s.referrer||"Direct")],["Campaign",s.utm_campaign],["Landing",s.landing_path],["Exit",s.exit_path]] as [string,any][])
        .filter(([,v])=>v).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}
    </dl>
    <div className="rumTimelineHead"><h3>Timeline</h3><label><input type="checkbox" checked={clicks} onChange={e=>setClicks(e.target.checked)}/> Show clicks</label></div>
    {!items?<Nothing text="Loading…"/>:!shown.length?<Nothing text="Nothing recorded in this session."/>:<ol className="rumTimeline">{shown.map((i,k)=>i.kind==="page"?
      <li key={"p"+(i.id||k)} className="page"><time>{rel(i.ts)}</time><div><b>{i.path}</b>{i.title&&<small>{i.title}</small>}
        {(i.lcp!=null||i.ttfb!=null||i.duration_ms!=null)&&<span className="rumPv">{i.duration_ms!=null&&<span>On page {dur(i.duration_ms/1000)}</span>}{i.scroll!=null&&<span>Scrolled {i.scroll}%</span>}{i.lcp!=null&&<span>LCP <Vital m="lcp" v={i.lcp}/></span>}{i.inp!=null&&<span>INP <Vital m="inp" v={i.inp}/></span>}{i.cls!=null&&<span>CLS <Vital m="cls" v={i.cls}/></span>}{i.ttfb!=null&&<span>TTFB <Vital m="ttfb" v={i.ttfb}/></span>}</span>}</div></li>
      :<li key={"e"+i.id} className={i.name==="$error"?"err":i.name==="$rage_click"?"warn":i.name.startsWith("$")?"auto":"custom"}><time>{rel(i.ts)}</time><div><b>{eventLabel(i.name)}</b><span>{eventLine(i)}</span>
        {i.name==="$error"&&i.props?.trace&&<details><summary>Stack trace</summary><pre>{i.props.trace}</pre></details>}
        {!i.name.startsWith("$")&&Object.keys(i.props||{}).length>0&&<details><summary>Properties</summary><pre>{JSON.stringify(i.props,null,2)}</pre></details>}</div></li>)}</ol>}
    {watch&&<Player supabase={supabase} visit={s} name={s.lead_id?"Became a lead":""} onClose={()=>setWatch(false)}/>}
  </aside></div>;
}

export function Users({supabase,site,from,to,ov,userKey,setUserKey}:any){
  const [rows,setRows]=useState<any[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[notice,setNotice]=useState("");
  const [q,setQ]=useState(""),[search,setSearch]=useState(""),[sort,setSort]=useState("last_seen"),[who,setWho]=useState("active"),[count,setCount]=useState<number|null>(null);
  async function load(offset=0){setLoading(true);try{
    const {f,t}=range(from,to);
    let x=supabase.from("insight_users").select("*",{count:offset?undefined:"exact"}).eq("site_id",site.id).is("merged_into",null).gt("sessions",0).order(sort,{ascending:false}).order("last_seen",{ascending:false}).range(offset,offset+PAGE-1);
    if(who==="active")x=x.gte("last_seen",f).lt("first_seen",t);if(who==="new")x=x.gte("first_seen",f).lt("first_seen",t);if(who==="known")x=x.like("user_key","u:%");if(who==="returning")x=x.gt("sessions",1).gte("last_seen",f);
    if(search){const s=safe(search);if(s)x=x.or(`email.ilike.*${s}*,name.ilike.*${s}*,external_id.ilike.*${s}*,user_key.ilike.*${s}*`)}
    const {data,error,count:c}=await x;if(error)throw error;setRows(offset?[...rows,...(data||[])]:data||[]);setMore((data||[]).length===PAGE);if(!offset)setCount(c??null);setNotice("")}catch(e:any){setNotice(e.message)}finally{setLoading(false)}}
  useEffect(()=>{if(!userKey)void load()},[site.id,from,to,search,sort,who,userKey]);
  if(userKey)return <UserProfile supabase={supabase} site={site} userKey={userKey} onBack={()=>setUserKey("")}/>;
  const t=ov?.totals||{};
  return <>
    <div className="rumStats">
      <Stat label="Users" value={num(t.users)} onClick={()=>setWho("active")} active={who==="active"}/>
      <Stat label="New" value={num(t.new_users)} note={pct(t.new_users,t.users)} onClick={()=>setWho("new")} active={who==="new"}/>
      <Stat label="Returning" value={num(t.returning_users)} note={pct(t.returning_users,t.users)} onClick={()=>setWho("returning")} active={who==="returning"}/>
      <Stat label="Identified" value={num(t.identified)} note="named with Insights.identify" onClick={()=>setWho("known")} active={who==="known"}/>
      <Stat label="Sessions per user" value={t.users?(t.sessions/t.users).toFixed(2):"–"}/>
    </div>
    <Card><TimeChart rows={ov?.daily||[]} series={[{key:"visitors",label:"Users",color:C.second}]} height={150}/></Card>
    <div className="rumFilters">
      <form onSubmit={e=>{e.preventDefault();setSearch(q.trim())}}><input type="search" value={q} onChange={e=>{setQ(e.target.value);if(!e.target.value)setSearch("")}} placeholder="Search by name, email or ID"/></form>
      <select value={who} onChange={e=>setWho(e.target.value)} aria-label="Which users"><option value="active">Active in this range</option><option value="new">New in this range</option><option value="returning">Returning</option><option value="known">Identified (all time)</option><option value="all">Everyone (all time)</option></select>
      <select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort"><option value="last_seen">Last seen</option><option value="first_seen">First seen</option><option value="sessions">Most sessions</option><option value="pageviews">Most page views</option><option value="events">Most events</option><option value="errors">Most errors</option></select>
      {count!=null&&<span className="rumDim">{num(count)} {count===1?"person":"people"}</span>}
    </div>
    {notice&&<p className="rumNotice">{notice}</p>}
    <Card className="flush">
      {loading&&!rows.length?<Nothing text="Loading…"/>:<Grid onRow={r=>setUserKey(r.user_key)} empty="No users match." rows={rows.map(r=>({...r,id:r.user_key}))} cols={[
        {key:"u",label:"User",render:r=><Who u={r} sub={r.email&&r.name?r.email:identified(r)?"Identified":r.first_source?"First came from "+r.first_source:""}/>},
        {key:"pl",label:"Location",render:r=><Place r={r}/>},
        {key:"sys",label:"Last system",render:r=><Sys r={{device:r.last_device,browser:r.last_browser,os:r.last_os}}/>},
        {key:"fs",label:"First seen",render:r=><span title={when(r.first_seen)}>{ago(r.first_seen)}</span>},
        {key:"ls",label:"Last seen",render:r=><span title={when(r.last_seen)}>{ago(r.last_seen)}</span>},
        {key:"s",label:"Sessions",num:true,render:r=>num(r.sessions)},
        {key:"pv",label:"Pages",num:true,render:r=>num(r.pageviews)},
        {key:"ev",label:"Events",num:true,render:r=>num(r.events)},
        {key:"er",label:"Errors",num:true,render:r=>r.errors?<span className="rumBad">{num(r.errors)}</span>:<span className="rumDim">0</span>},
      ]}/>}
      {more&&<button type="button" className="rumMore" disabled={loading} onClick={()=>void load(rows.length)}>{loading?"Loading…":"Load more users"}</button>}
    </Card>
  </>;
}

function UserProfile({supabase,site,userKey,onBack}:any){
  const [u,setU]=useState<any>(null),[sessions,setSessions]=useState<any[]>([]),[events,setEvents]=useState<any[]>([]),[clicks,setClicks]=useState(false),[open,setOpen]=useState<any>(null),[notice,setNotice]=useState("");
  useEffect(()=>{let alive=true;(async()=>{try{
    const [a,b,c]=await Promise.all([supabase.from("insight_users").select("*").eq("site_id",site.id).eq("user_key",userKey).maybeSingle(),
      supabase.from("web_sessions").select("*").eq("site_id",site.id).eq("user_key",userKey).order("started_at",{ascending:false}).limit(200),
      supabase.from("insight_events").select("*").eq("site_id",site.id).eq("user_key",userKey).neq("name","$pageview").order("ts",{ascending:false}).limit(500)]);
    if(!alive)return;if(a.error)throw a.error;
    let user=a.data;if(user?.merged_into){const m=await supabase.from("insight_users").select("*").eq("site_id",site.id).eq("user_key",user.merged_into).maybeSingle();if(m.data)user=m.data}
    setU(user||{user_key:userKey});setSessions(b.data||[]);setEvents(c.data||[])}catch(e:any){setNotice(e.message)}})();return()=>{alive=false}},[userKey]);
  if(!u)return <><button type="button" className="rumLink" onClick={onBack}>← All users</button>{notice?<p className="rumNotice">{notice}</p>:<Nothing text="Loading…"/>}</>;
  const days=new Map<string,number>();sessions.forEach(s=>{const d=new Date(s.started_at).toISOString().slice(0,10);days.set(d,(days.get(d)||0)+1)});
  const shown=events.filter(e=>clicks||e.name!=="$click");
  const traits=Object.entries(u.traits||{}).filter(([,v])=>v!==null&&typeof v!=="object");
  const totalTime=sessions.reduce((a,s)=>a+(s.duration_ms||0),0)/1000;
  const sources=[...new Set(sessions.map(s=>s.utm_source||(s.gclid?"google (ads)":s.referrer?(()=>{try{return new URL(s.referrer).host.replace(/^www\./,"")}catch{return ""}})():"Direct")).filter(Boolean))];
  return <>
    <button type="button" className="rumLink" onClick={onBack}>← All users</button>
    <div className="rumProfile">
      <Avatar u={u} size={56}/>
      <div><h2>{userLabel(u)}</h2><p>{[u.email&&u.name?u.email:"",identified(u)?"ID "+(u.external_id||u.user_key.slice(2)):"Anonymous visitor",placeOf(u).label].filter(Boolean).join(" · ")}</p>
        {traits.length>0&&<div className="rumTraits">{traits.map(([k,v])=><span key={k}><b>{k}</b>{String(v)}</span>)}</div>}</div>
    </div>
    <div className="rumStats">
      <Stat label="Sessions" value={num(u.sessions||sessions.length)}/><Stat label="Page views" value={num(u.pageviews)}/><Stat label="Events" value={num(u.events)}/>
      <Stat label="Errors" value={num(u.errors)} tone={u.errors?"bad":""}/><Stat label="Time on site" value={dur(totalTime)}/>
      <Stat label="First seen" value={ago(u.first_seen)} note={when(u.first_seen)} tone="sm"/><Stat label="Last seen" value={ago(u.last_seen)} note={when(u.last_seen)} tone="sm"/>
    </div>
    <div className="rumGrid2">
      <Card title="About" note="From their visits">
        <dl className="rumKv">{([["First came from",u.first_source],["First page",u.first_path],["Sources",sources.join(", ")],["Last device",[u.last_device,u.last_browser,u.last_os].filter(Boolean).join(" · ")],["Time zone",u.timezone],["Active days",days.size]] as [string,any][]).filter(([,v])=>v).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
      </Card>
      <Card title="Activity" note="Latest first">
        <label className="rumCheck"><input type="checkbox" checked={clicks} onChange={e=>setClicks(e.target.checked)}/> Show clicks</label>
        {shown.length?<ol className="rumFeed">{shown.slice(0,150).map(e=><li key={e.id} className={e.name==="$error"?"err":e.name.startsWith("$")?"auto":"custom"}><time title={when(e.ts)}>{day(new Date(e.ts).toISOString().slice(0,10))} {clock(e.ts).slice(0,5)}</time><b>{eventLabel(e.name)}</b><span>{eventLine(e)}</span></li>)}</ol>:<Nothing text="No events yet."/>}
      </Card>
    </div>
    <Card title={"Sessions ("+sessions.length+")"} className="flush">
      <Grid onRow={setOpen} rows={sessions} empty="No sessions." cols={[
        {key:"start",label:"Started",render:r=>when(r.started_at)},
        {key:"pl",label:"Location",render:r=><Place r={r}/>},
        {key:"sys",label:"System",render:r=><Sys r={r}/>},
        {key:"j",label:"Journey",render:r=><span className="rumJourney">{(r.paths||[]).slice(0,5).join(" → ")}{(r.paths||[]).length>5?" → …":""}</span>},
        {key:"d",label:"Duration",num:true,render:r=>dur((r.duration_ms||0)/1000)},
        {key:"e",label:"Errors",num:true,render:r=>r.error_count?<span className="rumBad">{r.error_count}</span>:<span className="rumDim">0</span>},
        {key:"f",label:"",render:r=><span className="rumTags">{r.form_submitted&&<em>Form</em>}{r.chunk_count>0&&<em className="replay">▶ Replay</em>}</span>},
      ]}/>
    </Card>
    {open&&<SessionDrawer supabase={supabase} session={open} onClose={()=>setOpen(null)}/>}
  </>;
}
