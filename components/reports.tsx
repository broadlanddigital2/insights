"use client";
import {useEffect,useState} from "react";
import {num,pct,dur,when,ago,rpc,Card,Stat,Grid,Nothing,BarList,TimeChart,C,Place,eventLabel,eventLine,Who,VITALS,Vital,Dist,fmtVital,rate} from "./lib";
import {SessionDrawer} from "./people";

// Overview, Events, Web vitals and Errors for one site and date range.
export function Overview({ov,go}:any){
  const [metric,setMetric]=useState("visitors");
  if(!ov)return <Nothing text="Loading…"/>;
  const t=ov.totals||{};
  const M:Record<string,[string,string]>={visitors:["Users",C.second],sessions:["Sessions",C.primary],pageviews:["Page views",C.third],errors:["Errors",C.poor]};
  return <>
    {!t.sessions&&<p className="rumNotice">No visits in this range yet. Only visitors who accept analytics cookies are counted, unless the site is set to record straight away.</p>}
    <div className="rumStats">
      <Stat label="Users" value={num(t.users)} note={num(t.new_users)+" new · "+num(t.returning_users)+" returning"} onClick={()=>setMetric("visitors")} active={metric==="visitors"}/>
      <Stat label="Sessions" value={num(t.sessions)} note={t.users?(t.sessions/t.users).toFixed(2)+" per user":""} onClick={()=>setMetric("sessions")} active={metric==="sessions"}/>
      <Stat label="Page views" value={num(t.pageviews)} note={t.sessions?(t.pageviews/t.sessions).toFixed(1)+" per session":""} onClick={()=>setMetric("pageviews")} active={metric==="pageviews"}/>
      <Stat label="Avg. session" value={dur(t.avg_seconds)}/>
      <Stat label="Bounce rate" value={pct(t.bounced,t.sessions)} tone={t.sessions&&t.bounced/t.sessions>.6?"warn":""}/>
      <Stat label="Errors" value={num(t.error_count)} note={num(t.errors)+" sessions affected"} tone={t.error_count?"bad":""} onClick={()=>setMetric("errors")} active={metric==="errors"}/>
      <Stat label="Forms sent" value={num(t.forms)} note={pct(t.forms,t.sessions)+" of sessions"}/>
      <Stat label="From ads" value={num(t.from_ads)} note={pct(t.from_ads,t.sessions)+" of sessions"}/>
    </div>
    <Card title={M[metric][0]+" by day"}><TimeChart rows={ov.daily||[]} series={[{key:metric,label:M[metric][0],color:M[metric][1]}]} kind={metric==="errors"?"bars":"line"}/></Card>
    <div className="rumGrid3">
      <Card title="Top pages"><BarList rows={ov.pages} label="path" value="views"/></Card>
      <Card title="Entry pages"><BarList rows={ov.entries} label="path"/></Card>
      <Card title="Exit pages" note="Where sessions ended without a form"><BarList rows={ov.exits} label="path"/></Card>
      <Card title="Sources"><BarList rows={ov.sources}/></Card>
      <Card title="Campaigns"><BarList rows={ov.campaigns} empty="No ad or UTM campaigns in this range."/></Card>
      <Card title="Locations"><BarList rows={ov.countries} render={r=><Place r={r}/>}/></Card>
      <Card title="Devices"><BarList rows={ov.devices}/></Card>
      <Card title="Browsers"><BarList rows={ov.browsers}/></Card>
      <Card title="Operating systems"><BarList rows={ov.os}/></Card>
      <Card title="Top events" right={<button type="button" className="rumLink" onClick={()=>go("events")}>All events →</button>}><BarList rows={ov.top_events} label="name" value="count" render={r=>eventLabel(r.name)} empty="No custom events yet — send them with Insights.track()."/></Card>
      <Card title="Time of day" note="Sessions started, UK time"><HourBars rows={ov.hours||[]}/></Card>
    </div>
  </>;
}
function HourBars({rows}:{rows:any[]}){
  const max=Math.max(...rows.map(r=>r.sessions),1);
  return <div className="rumHours">{rows.map(r=><div key={r.hour} title={r.hour+":00 — "+r.sessions+" sessions"}><i style={{height:Math.max(3,r.sessions/max*100)+"%",opacity:.35+.65*r.sessions/max}}/><span>{r.hour%3===0?r.hour:""}</span></div>)}</div>;
}

export function Events({supabase,site,from,to}:any){
  const [data,setData]=useState<any>(null),[pick,setPick]=useState(""),[showAuto,setShowAuto]=useState(true),[notice,setNotice]=useState("");
  useEffect(()=>{setData(null);rpc(supabase,"insights_events",{p_site:site.id,p_from:from,p_to:to}).then(setData).catch(e=>setNotice(e.message))},[site.id,from,to]);
  if(pick)return <EventDetail supabase={supabase} site={site} name={pick} from={from} to={to} onBack={()=>setPick("")}/>;
  const rows=(data?.events||[]).filter((e:any)=>showAuto||!e.auto);
  const custom=(data?.events||[]).filter((e:any)=>!e.auto),total=(data?.events||[]).reduce((a:number,e:any)=>a+e.count,0);
  return <>
    {notice&&<p className="rumNotice">{notice}</p>}
    <div className="rumStats">
      <Stat label="Events" value={num(total)}/><Stat label="Custom events" value={num(custom.reduce((a:number,e:any)=>a+e.count,0))} note={custom.length+" types"}/>
      <Stat label="Event types" value={num((data?.events||[]).length)}/>
    </div>
    <Card title="Events by day"><TimeChart rows={data?.daily||[]} series={[{key:"custom",label:"Custom",color:C.primary},{key:"auto",label:"Automatic (clicks, forms, errors…)",color:C.grey}]}/></Card>
    <Card className="flush" title="All events" right={<label className="rumCheck"><input type="checkbox" checked={showAuto} onChange={e=>setShowAuto(e.target.checked)}/> Include automatic events</label>}>
      {!data?<Nothing text="Loading…"/>:<Grid onRow={r=>setPick(r.name)} rows={rows.map((r:any)=>({...r,id:r.name}))} empty="No events in this range." cols={[
        {key:"n",label:"Event",render:r=><span className="rumEventName"><i className={r.auto?"auto":"custom"}/>{eventLabel(r.name)}{r.auto&&<small>{r.name}</small>}</span>},
        {key:"c",label:"Count",num:true,render:r=>num(r.count)},
        {key:"s",label:"Sessions",num:true,render:r=>num(r.sessions)},
        {key:"u",label:"Users",num:true,render:r=>num(r.users)},
        {key:"l",label:"Last seen",num:true,render:r=>ago(r.last)},
      ]}/>}
    </Card>
    <Card title="Sending your own events">
      <p className="rumHelp">Anything you want to count — quote requests, bookings, video plays, calculator use — can be sent from the website:</p>
      <pre className="insCode">{`Insights.track("Quote requested", { service: "Full wrap", value: 2400 })\nInsights.identify("customer-123", { email: "jo@example.com", name: "Jo Bloggs" })`}</pre>
      <p className="rumHelp">Events appear here, in each session's timeline and on the person's profile, and can be used as funnel steps.</p>
    </Card>
  </>;
}
function EventDetail({supabase,site,name,from,to,onBack}:any){
  const [d,setD]=useState<any>(null),[open,setOpen]=useState<any>(null);
  useEffect(()=>{rpc(supabase,"insights_event_detail",{p_site:site.id,p_name:name,p_from:from,p_to:to}).then(setD).catch(()=>setD({}))},[name,from,to]);
  async function openSession(id:string){const {data}=await supabase.from("web_sessions").select("*").eq("id",id).maybeSingle();if(data)setOpen(data)}
  return <>
    <button type="button" className="rumLink" onClick={onBack}>← All events</button>
    <h2 className="rumH2">{eventLabel(name)}</h2>
    {!d?<Nothing text="Loading…"/>:<>
      <div className="rumStats"><Stat label="Times" value={num(d.count)}/><Stat label="Sessions" value={num(d.sessions)}/><Stat label="Users" value={num(d.users)}/></div>
      <Card title="By day"><TimeChart rows={d.daily||[]} series={[{key:"count",label:eventLabel(name),color:C.primary}]}/></Card>
      <div className="rumGrid2">
        <Card title="Pages"><BarList rows={d.pages||[]} label="path" value="count"/></Card>
        <Card title="Properties">{(d.props||[]).length?(d.props||[]).map((p:any)=><div key={p.key} className="rumProp"><h4>{p.key}</h4><BarList rows={p.values} label="value" value="count" max={5}/></div>):<Nothing text="This event has no properties."/>}</Card>
      </div>
      <Card title="Latest" className="flush"><Grid dense onRow={r=>void openSession(r.session_id)} rows={(d.recent||[]).map((r:any,i:number)=>({...r,id:i}))} cols={[
        {key:"t",label:"When",render:r=>when(r.ts)},{key:"u",label:"User",render:r=><Who u={r}/>},{key:"p",label:"Page",render:r=>r.path},{key:"d",label:"Details",render:r=><span className="rumDim">{eventLine({name,props:r.props,path:r.path})}</span>}]}/></Card>
    </>}
    {open&&<SessionDrawer supabase={supabase} session={open} onClose={()=>setOpen(null)}/>}
  </>;
}

export function Performance({supabase,site,from,to}:any){
  const [d,setD]=useState<any>(null),[m,setM]=useState("lcp"),[notice,setNotice]=useState("");
  useEffect(()=>{setD(null);rpc(supabase,"insights_performance",{p_site:site.id,p_from:from,p_to:to}).then(setD).catch(e=>setNotice(e.message))},[site.id,from,to]);
  if(notice)return <p className="rumNotice">{notice}</p>;
  if(!d)return <Nothing text="Loading…"/>;
  const mt=d.metrics||{};
  const core=["lcp","inp","cls"].map(k=>rate(k,mt[k]?.p75));
  const verdict=core.some(x=>!x)?"":core.every(x=>x==="good")?"good":core.includes("poor")?"poor":"ni";
  return <>
    {!d.pageviews&&<p className="rumNotice">No page speed data in this range yet. It's collected from visitors' browsers by the Insights tracker (t.js).</p>}
    <div className={"rumVerdict "+verdict}><b>{verdict==="good"?"Passing Core Web Vitals":verdict==="poor"?"Failing Core Web Vitals":verdict==="ni"?"Core Web Vitals need improvement":"Not enough data for Core Web Vitals yet"}</b><span>Based on the 75th percentile of {num(d.pageviews)} page views — the measure Google uses.</span></div>
    <div className="rumVitals">{Object.keys(VITALS).map(k=>{const v=mt[k]||{};return <button key={k} type="button" className={"rumVitalCard"+(m===k?" active":"")} onClick={()=>setM(k)}>
      <span>{k==="load_ms"?"LOAD":k.toUpperCase()}</span><Vital m={k} v={v.p75}/><small>{VITALS[k].label}</small>
      <Dist good={v.good} ni={v.ni} poor={v.poor}/><em>{num(v.samples)} samples · p50 {fmtVital(k,v.p50)}</em></button>})}</div>
    <Card title={VITALS[m].label+" (p75) by day"} note={VITALS[m].help}>
      <TimeChart rows={d.daily||[]} kind="line" series={[{key:m,label:m==="load_ms"?"Load":m.toUpperCase(),color:C.primary}]} fmt={v=>fmtVital(m,v)} lines={[{value:VITALS[m].good,color:C.good,label:"Good"},{value:VITALS[m].poor,color:C.poor,label:"Poor"}]}/>
    </Card>
    <Card title="Pages" note="75th percentile per page" className="flush"><Grid rows={(d.pages||[]).map((r:any)=>({...r,id:r.path}))} cols={[
      {key:"p",label:"Page",render:r=>r.path},{key:"v",label:"Views",num:true,render:r=>num(r.views)},
      {key:"lcp",label:"LCP",num:true,render:r=><Vital m="lcp" v={r.lcp}/>},{key:"inp",label:"INP",num:true,render:r=><Vital m="inp" v={r.inp}/>},{key:"cls",label:"CLS",num:true,render:r=><Vital m="cls" v={r.cls}/>},
      {key:"fcp",label:"FCP",num:true,render:r=><Vital m="fcp" v={r.fcp}/>},{key:"ttfb",label:"TTFB",num:true,render:r=><Vital m="ttfb" v={r.ttfb}/>},
      {key:"t",label:"Avg. time",num:true,render:r=>r.avg_seconds!=null?dur(r.avg_seconds):"–"},{key:"s",label:"Scroll",num:true,render:r=>r.scroll!=null?r.scroll+"%":"–"}]}/></Card>
    <div className="rumGrid2">
      {[["Devices",d.devices],["Browsers",d.browsers]].map(([title,rows]:any)=><Card key={title} title={title} className="flush"><Grid dense rows={(rows||[]).map((r:any)=>({...r,id:r.label}))} cols={[
        {key:"l",label:title==="Devices"?"Device":"Browser",render:r=>r.label},{key:"v",label:"Views",num:true,render:r=>num(r.views)},
        {key:"lcp",label:"LCP",num:true,render:r=><Vital m="lcp" v={r.lcp}/>},{key:"inp",label:"INP",num:true,render:r=><Vital m="inp" v={r.inp}/>},{key:"cls",label:"CLS",num:true,render:r=><Vital m="cls" v={r.cls}/>},{key:"ttfb",label:"TTFB",num:true,render:r=><Vital m="ttfb" v={r.ttfb}/>}]}/></Card>)}
    </div>
  </>;
}

// Errors export: everything needed to fix each error (message, where and in which browsers it happens, stack trace,
// example sessions) as a Markdown report to paste into a ticket or an AI coding assistant, or as a CSV for a spreadsheet.
const lvlName=(l:string)=>l==="network"?"Network":l==="warn"?"Warning":"Error";
const whenAt=(v:string)=>v?new Date(v).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"";
function errorsMarkdown(site:any,from:string,to:string,d:any){
  const domain=(site.domains||[])[0]||"";
  const out=["# Errors on "+(site.name||domain)+(domain&&site.name!==domain?" ("+domain+")":""),"",
    from+" to "+to+" · "+num(d.total)+" errors · "+num((d.groups||[]).length)+" distinct · "+num(d.sessions)+" sessions · "+num(d.users)+" users affected","",
    "Captured by Insights from visitors' browsers: JavaScript errors, unhandled promise rejections, console.error calls, and failed network requests (images, scripts and fetch calls that returned 4xx/5xx). Most frequent first.",""];
  (d.groups||[]).forEach((g:any,i:number)=>{
    out.push("## "+(i+1)+". ["+lvlName(g.level)+"] "+g.message.replace(/\s+/g," ").slice(0,160),"");
    out.push("- **Occurrences:** "+num(g.count)+" in "+num(g.sessions)+" sessions ("+num(g.users)+" users)");
    out.push("- **First / last seen:** "+whenAt(g.first_seen)+" / "+whenAt(g.last_seen));
    if((g.pages||[]).length)out.push("- **Pages:** "+g.pages.map((p:any)=>(domain?"https://"+domain:"")+p.path+" ("+num(p.count)+")").join(", "));
    if((g.browsers||[]).length)out.push("- **Browsers:** "+g.browsers.map((b:any)=>(b.browser||"Unknown")+" ("+num(b.count)+")").join(", "));
    if((g.recent_sessions||[]).length)out.push("- **Example sessions (replay in Insights):** "+g.recent_sessions.slice(0,3).map((x:string)=>x.slice(0,8)).join(", "));
    if(g.message.length>160)out.push("","Full message:","","```",g.message,"```");
    out.push("",g.trace?"Stack trace:\n\n```\n"+g.trace+"\n```":"_No stack trace was captured._","");
  });
  return out.join("\n");
}
function errorsCsv(site:any,d:any){
  const q=(v:any)=>{const t=String(v??"");return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t};
  const head=["Type","Message","Occurrences","Sessions","Users","First seen","Last seen","Top pages","Browsers","Stack trace","Example sessions"];
  const rows=(d.groups||[]).map((g:any)=>[lvlName(g.level),g.message,g.count,g.sessions,g.users,g.first_seen,g.last_seen,(g.pages||[]).map((p:any)=>p.path+" ("+p.count+")").join("; "),(g.browsers||[]).map((b:any)=>b.browser+" ("+b.count+")").join("; "),g.trace||"",(g.recent_sessions||[]).join("; ")]);
  return "\uFEFF"+[head,...rows].map(r=>r.map(q).join(",")).join("\r\n");
}
function saveFile(name:string,text:string,type:string){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

export function Errors({supabase,site,from,to}:any){
  const [d,setD]=useState<any>(null),[openG,setOpenG]=useState<number|null>(null),[open,setOpen]=useState<any>(null),[notice,setNotice]=useState("");
  useEffect(()=>{setD(null);rpc(supabase,"insights_errors",{p_site:site.id,p_from:from,p_to:to}).then(setD).catch(e=>setNotice(e.message))},[site.id,from,to]);
  async function openSession(id:string){const {data}=await supabase.from("web_sessions").select("*").eq("id",id).maybeSingle();if(data)setOpen(data)}
  const [copied,setCopied]=useState(false);
  const fileBase="errors-"+String((site.domains||[])[0]||site.name||"site").replace(/[^a-z0-9.-]+/gi,"-").toLowerCase()+"-"+from+"-to-"+to;
  async function copyReport(){try{await navigator.clipboard.writeText(errorsMarkdown(site,from,to,d));setCopied(true);setTimeout(()=>setCopied(false),2500)}catch{saveFile(fileBase+".md",errorsMarkdown(site,from,to,d),"text/markdown")}}
  if(notice)return <p className="rumNotice">{notice}</p>;
  if(!d)return <Nothing text="Loading…"/>;
  return <>
    <div className="rumStats"><Stat label="Errors" value={num(d.total)} tone={d.total?"bad":""}/><Stat label="Distinct errors" value={num((d.groups||[]).length)}/><Stat label="Sessions affected" value={num(d.sessions)}/><Stat label="Users affected" value={num(d.users)}/></div>
    <Card title="Errors by day"><TimeChart rows={d.daily||[]} series={[{key:"count",label:"Errors",color:C.poor}]}/></Card>
    <Card title="Errors" note="Grouped by message — JavaScript errors, failed network requests and console errors" className="flush"
      right={(d.groups||[]).length?<div className="rumExport">
        <button type="button" onClick={()=>void copyReport()} title="Copy a Markdown report to paste into a ticket or an AI coding assistant">{copied?"Copied ✓":"Copy for fixing"}</button>
        <button type="button" onClick={()=>saveFile(fileBase+".md",errorsMarkdown(site,from,to,d),"text/markdown")}>Download report</button>
        <button type="button" onClick={()=>saveFile(fileBase+".csv",errorsCsv(site,d),"text/csv")}>Download CSV</button>
      </div>:undefined}>
      {!(d.groups||[]).length?<Nothing text="No errors in this range. 🎉"/>:<ul className="rumErrors">{d.groups.map((g:any,i:number)=><li key={i} className={openG===i?"open":""}>
        <button type="button" onClick={()=>setOpenG(openG===i?null:i)}>
          <span className={"rumLevel "+g.level}>{g.level==="network"?"Network":g.level==="warn"?"Warning":"Error"}</span>
          <span className="msg"><b>{g.message}</b><small>{[g.top_path,g.top_browser,"first "+ago(g.first_seen),"last "+ago(g.last_seen)].filter(Boolean).join(" · ")}</small></span>
          <span className="n"><b>{num(g.count)}</b><small>{num(g.sessions)} sessions · {num(g.users)} users</small></span>
        </button>
        {openG===i&&<div className="rumErrorBody">
          {g.trace?<pre className="insCode">{g.trace}</pre>:<p className="rumDim">No stack trace was captured.</p>}
          <h4>Recent sessions with this error</h4>
          <div className="rumChips">{(g.recent_sessions||[]).map((id:string)=><button key={id} type="button" onClick={()=>void openSession(id)}>Session {id.slice(0,8)}</button>)}</div>
        </div>}
      </li>)}</ul>}
    </Card>
    {open&&<SessionDrawer supabase={supabase} session={open} onClose={()=>setOpen(null)}/>}
  </>;
}
