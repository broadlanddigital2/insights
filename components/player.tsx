"use client";
import {useEffect,useRef,useState} from "react";
import {REC,when,dur,eventLabel,eventLine,placeOf,userLabel} from "./lib";

// Screen recording player: the rrweb replay with the visit's console, pages, events and browser details beside it.
// Clicking any line jumps the replay to that moment.
async function call(supabase:any,body:any){
  const {data,error}=await supabase.functions.invoke("web-recorder",{body});
  if(error){const v=await error.context?.json?.().catch(()=>null);throw new Error(v?.error||error.message)}
  if(data?.error)throw new Error(data.error);return data;
}
let playerAssets:Promise<any>|null=null;
function loadPlayer(){
  if(!playerAssets)playerAssets=new Promise((ok,fail)=>{
    const css=document.createElement("link");css.rel="stylesheet";css.href=REC+"?asset=player.css";document.head.appendChild(css);
    const sc=document.createElement("script");sc.src=REC+"?asset=player.js";sc.async=true;sc.onload=()=>{const P=(window as any).rrwebPlayer;ok(P?.default||P)};sc.onerror=()=>{playerAssets=null;fail(new Error("The player could not load."))};document.head.appendChild(sc);
  });
  return playerAssets;
}
async function inflate(url:string){
  const r=await fetch(url);if(!r.ok)throw new Error("A part of the recording is missing.");
  const text=await new Response(r.body!.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text).events||[];
}
export function Player({supabase,visit,name,onClose}:any){
  const [msg,setMsg]=useState("Loading the recording…"),[host,setHost]=useState<HTMLDivElement|null>(null);
  const [logs,setLogs]=useState<any[]>([]),[pages,setPages]=useState<any[]>([]),[acts,setActs]=useState<any[]>([]),[side,setSide]=useState("events"),[level,setLevel]=useState("problems"),[now,setNow]=useState(0),[clicks,setClicks]=useState(false);
  // Playback speed (1×–8×) and skipping idle time; both remembered in this browser.
  const SPEEDS=[1,2,3,4,8];
  const [speed,setSpeedState]=useState<number>(()=>{try{const v=Number(localStorage.getItem("ins-speed"));return SPEEDS.includes(v)?v:1}catch{return 1}});
  const [skip,setSkip]=useState<boolean>(()=>{try{return localStorage.getItem("ins-skip")!=="off"}catch{return true}});
  const pl=useRef<any>(null),start=useRef(0);
  useEffect(()=>{if(!host)return;let alive=true,player:any=null,timer:any=null;
    (async()=>{try{
      const [P,res,ev]=await Promise.all([loadPlayer(),call(supabase,{action:"playback",session_id:visit.id}),supabase.from("insight_events").select("id,name,props,path,ts").eq("session_id",visit.id).order("ts").limit(1000)]);
      const parts=await Promise.all(res.chunks.filter((c:any)=>c.url).map((c:any)=>inflate(c.url)));
      const events=parts.flat().sort((a:any,b:any)=>a.timestamp-b.timestamp);
      if(!alive)return;if(events.length<2){setMsg("This visit is too short to play back.");return}
      const t0=events[0].timestamp;start.current=t0;
      setLogs(events.filter((e:any)=>e.type===5&&e.data?.tag==="console").map((e:any)=>({at:e.timestamp-t0,...e.data.payload})));
      setPages(events.filter((e:any)=>e.type===4&&e.data?.href).map((e:any)=>({at:e.timestamp-t0,href:e.data.href,size:e.data.width+"×"+e.data.height})));
      setActs((ev.data||[]).filter((e:any)=>e.name!=="$pageview").map((e:any)=>({...e,at:new Date(e.ts).getTime()-t0})));
      const w=Math.min(host.clientWidth||900,1000);
      player=new P({target:host,props:{events,width:w,height:Math.round(w*0.56),autoPlay:true,skipInactive:skip,speed,speedOption:SPEEDS,showController:true,mouseTail:{strokeStyle:"#e21a22"}}});
      pl.current=player;
      try{player.addEventListener?.("ui-update-current-time",(e:any)=>setNow(Number(e?.payload)||0))}catch{}
      timer=setInterval(()=>{try{const r=player.getReplayer?.();if(r)setNow(r.getCurrentTime())}catch{}},500);
      setMsg("");
    }catch(e:any){if(alive)setMsg(e.message)}})();
    return()=>{alive=false;clearInterval(timer);try{player?.$destroy?.()}catch{}}},[host,visit.id]);
  function changeSpeed(v:number){setSpeedState(v);try{localStorage.setItem("ins-speed",String(v))}catch{};try{pl.current?.setSpeed?.(v)}catch{}}
  function changeSkip(on:boolean){setSkip(on);try{localStorage.setItem("ins-skip",on?"on":"off")}catch{};try{const P=pl.current;if(P?.toggleSkipInactive)P.toggleSkipInactive();else P?.getReplayer?.()?.setConfig?.({skipInactive:on})}catch{}}
  const jump=(ms:number)=>{try{pl.current?.goto?.(Math.max(0,ms-1500),true)}catch{}};
  const shown=logs.filter(l=>level==="all"||(level==="problems"?["error","warn","network"].includes(l.level):l.level===level));
  const counts={error:logs.filter(l=>l.level==="error").length,warn:logs.filter(l=>l.level==="warn").length,network:logs.filter(l=>l.level==="network").length};
  const mmss=(ms:number)=>{const s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
  const pth=(u:string)=>{try{const x=new URL(u);return x.pathname+x.search}catch{return u}};
  const place=placeOf(visit);
  const details:[string,any][]=[["Person",userLabel(visit)],["Email",visit.user_email],["Location",[place.label,place.city].filter(Boolean).join(" · ")],["Device",[visit.device,visit.touch?"touch screen":""].filter(Boolean).join(", ")],["Browser",[visit.browser,visit.browser_version].filter(Boolean).join(" ")],["Operating system",[visit.os,visit.os_version].filter(Boolean).join(" ")],
    ["Screen",visit.screen],["Browser window",visit.viewport],["Language",visit.language],["Time zone",visit.timezone],["Connection",visit.connection],
    ["Came from",visit.referrer||"Direct"],["Landing page",visit.landing_path],["Left from",visit.exit_path],["Ad / campaign",[visit.utm_source,visit.utm_medium,visit.utm_campaign].filter(Boolean).join(" · ")||(visit.gclid?"Google ad":"")],
    ["Google click ID",visit.gclid],["Lead",name],["Clicks",visit.click_count],["Rage clicks",visit.rage_clicks],["Errors",visit.error_count],["Warnings",visit.warning_count],["Visitor ID",visit.visitor_id],["Visit ID",visit.id]];
  const actShown=acts.filter(a=>clicks||a.name!=="$click");
  return <div className="employeeModalBackdrop" role="dialog" aria-modal="true" aria-label="Screen recording" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="employeeModal webPlayer">
    <header className="signageDetailHead"><div><h2>{userLabel(visit)} · {when(visit.started_at)}</h2><p>{[dur(Math.round((visit.duration_ms||0)/1000)),visit.page_count+" page"+(visit.page_count===1?"":"s"),[visit.device,visit.browser,visit.os].filter(Boolean).join(" · "),place.label,name?"Lead: "+name:"",visit.gclid?"Came from a Google ad":visit.utm_source?"Source: "+visit.utm_source:""].filter(Boolean).join(" · ")}</p>
      <p className="webJourney">{(visit.paths||[]).join(" → ")}</p></div>
      <button type="button" className="secondaryButton" onClick={onClose}>CLOSE</button></header>
    {msg&&<p className={msg.startsWith("Loading")?"employeeMuted":"crmNotice"}>{msg}</p>}
    <div className="webPlayerLayout">
      <div className="webPlayerMain">
        <div ref={setHost} className="webPlayerStage"/>
        {!msg&&<div className="webSpeed" role="group" aria-label="Playback speed">
          <span>Speed</span>{SPEEDS.map(v=><button key={v} type="button" className={speed===v?"active":""} aria-pressed={speed===v} onClick={()=>changeSpeed(v)}>{v}×</button>)}
          <label className="jobCheck"><input type="checkbox" checked={skip} onChange={e=>changeSkip(e.target.checked)}/>Skip idle time</label>
        </div>}
      </div>
      <aside className="webPlayerSide">
        <div className="employeesTabs" role="tablist">{[["events","Events"],["console","Console"+(counts.error+counts.network?" ("+(counts.error+counts.network)+")":"")],["pages","Pages"],["details","Details"]].map(([k,l])=><button key={k} role="tab" aria-selected={side===k} className={side===k?"active":""} onClick={()=>setSide(k)}>{l}</button>)}</div>
        {side==="events"&&<>
          <label className="jobCheck webClicksToggle"><input type="checkbox" checked={clicks} onChange={e=>setClicks(e.target.checked)}/>Show every click</label>
          {actShown.length?<ol className="webLogs">{actShown.map((a,i)=><li key={a.id||i} className={(a.name==="$error"?"lv-error":a.name==="$rage_click"?"lv-warn":a.name.startsWith("$")?"":"lv-custom")+(a.at<=now&&now-a.at<4000?" now":"")}><button type="button" onClick={()=>jump(a.at)} title="Jump to this moment"><time>{mmss(a.at)}</time><b>{eventLabel(a.name)}</b><span>{eventLine(a)}</span><small>{a.path}</small></button></li>)}</ol>
          :<p className="employeeMuted">{acts.length?"Only clicks in this visit — tick “Show every click”.":"No events were recorded in this visit."}</p>}
        </>}
        {side==="console"&&<>
          <div className="webLogFilter">{[["problems","Problems"],["error","Errors "+counts.error],["warn","Warnings "+counts.warn],["network","Network "+counts.network],["all","Everything"]].map(([k,l])=><button key={k} type="button" className={level===k?"active":""} onClick={()=>setLevel(k)}>{l}</button>)}</div>
          {shown.length?<ol className="webLogs">{shown.map((l,i)=><li key={i} className={"lv-"+l.level+(l.at<=now&&now-l.at<4000?" now":"")}><button type="button" onClick={()=>jump(l.at)} title="Jump to this moment"><time>{mmss(l.at)}</time><b>{l.level==="warn"?"Warning":l.level==="network"?"Network":l.level==="error"?"Error":l.level}</b><span>{l.message}</span>{l.trace&&<details onClick={e=>e.stopPropagation()}><summary>Details</summary><pre>{l.trace}</pre></details>}<small>{l.url}</small></button></li>)}</ol>
          :<p className="employeeMuted">{logs.length?"Nothing at this level.":"Nothing was logged in the browser during this visit."}</p>}
        </>}
        {side==="pages"&&<ol className="webLogs">{pages.map((p,i)=><li key={i} className={p.at<=now&&(i===pages.length-1||pages[i+1].at>now)?"now":""}><button type="button" onClick={()=>jump(p.at+1500)}><time>{mmss(p.at)}</time><span>{pth(p.href)}</span><small>{p.size}</small></button></li>)}</ol>}
        {side==="details"&&<dl className="webDetails">{details.filter(([,v])=>v!==null&&v!==undefined&&v!=="").map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>}
      </aside>
    </div>
  </div></div>;
}
