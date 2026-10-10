"use client";
import {useEffect,useState} from "react";
import {num,dur,day,rpc,Card,Nothing,TimeChart,VITALS,countryName,eventLabel} from "./lib";

// Metrics, like Better Stack's: ready-made dashboards (Web vitals with average and p50/p90/p95/p99, Website visits)
// and custom charts — any measure, any aggregation, split by page, device, browser, country, source, event or an
// event property — saved per site. Everything comes from the insights_metric database function.
type Unit="count"|"ms"|"cls"|"s"|"pct"|"mb"|"num";
export const METRICS:{key:string;label:string;unit:Unit;group:string;fixed?:string[]}[]=[
  {key:"pageviews",label:"Page views",unit:"count",group:"Traffic",fixed:["count"]},
  {key:"sessions",label:"Sessions",unit:"count",group:"Traffic",fixed:["count"]},
  {key:"users",label:"Users",unit:"count",group:"Traffic",fixed:["count"]},
  {key:"session_duration",label:"Session duration",unit:"s",group:"Engagement"},
  {key:"pages_per_session",label:"Pages per session",unit:"num",group:"Engagement"},
  {key:"time_on_page",label:"Time on page",unit:"s",group:"Engagement"},
  {key:"scroll",label:"Scroll depth",unit:"pct",group:"Engagement"},
  {key:"bounce_rate",label:"Bounce rate",unit:"pct",group:"Engagement",fixed:["avg"]},
  {key:"conversion_rate",label:"Form conversion rate",unit:"pct",group:"Engagement",fixed:["avg"]},
  {key:"click_count",label:"Clicks per session",unit:"num",group:"Engagement"},
  {key:"rage_clicks",label:"Rage clicks per session",unit:"num",group:"Engagement"},
  {key:"lcp",label:"Largest Contentful Paint",unit:"ms",group:"Performance"},
  {key:"fcp",label:"First Contentful Paint",unit:"ms",group:"Performance"},
  {key:"ttfb",label:"Time to First Byte",unit:"ms",group:"Performance"},
  {key:"inp",label:"Interaction to Next Paint",unit:"ms",group:"Performance"},
  {key:"cls",label:"Cumulative Layout Shift",unit:"cls",group:"Performance"},
  {key:"load_ms",label:"Page load",unit:"ms",group:"Performance"},
  {key:"dom_ms",label:"DOM ready",unit:"ms",group:"Performance"},
  {key:"heap_mb",label:"JavaScript heap used",unit:"mb",group:"Performance"},
  {key:"error_count",label:"Errors per session",unit:"num",group:"Errors"},
  {key:"events",label:"Event count",unit:"count",group:"Events",fixed:["count"]},
  {key:"event_users",label:"Users triggering an event",unit:"count",group:"Events",fixed:["count"]},
  {key:"event_value",label:"Event property value (e.g. value)",unit:"num",group:"Events"},
];
const AGGS:[string,string][]=[["avg","Average"],["p50","p50 (median)"],["p75","p75"],["p90","p90"],["p95","p95"],["p99","p99"],["min","Min"],["max","Max"],["sum","Sum"],["count","Count"]];
const GROUPS:[string,string][]=[["none","Nothing"],["page","Page"],["device","Device"],["browser","Browser"],["os","Operating system"],["country","Country"],["source","Source"],["user_type","Identified / anonymous"],["event","Event name"],["prop","Event property"]];
const COLOURS=["#7c83ff","#38bdf8","#f472b6","#34d399","#fbbf24","#a78bfa","#fb7185","#94a3b8"];
const AGG_COLOURS:Record<string,string>={avg:"var(--r-strong)",p50:"#38bdf8",p75:"#34d399",p90:"#fbbf24",p95:"#fb923c",p99:"#f87171",min:"#94a3b8",max:"#f472b6",sum:"#7c83ff",count:"#7c83ff"};
const metricOf=(k:string)=>METRICS.find(m=>m.key===k)||METRICS[0];
export function fmtUnit(u:Unit,v:any){
  if(v==null||v==="")return "–";const n=Number(v);
  switch(u){
    case "ms":return n>=1000?(n/1000).toFixed(2)+" s":Math.round(n)+" ms";
    case "cls":return n.toFixed(3);
    case "s":return dur(n);
    case "pct":return (Math.round(n*10)/10)+"%";
    case "mb":return n.toFixed(1)+" MB";
    case "count":return num(Math.round(n));
    default:return Math.abs(n)>=100?num(Math.round(n)):String(Math.round(n*100)/100);
  }
}
const groupLabel=(g:string,by:string)=>by==="country"?(g==="Unknown"?g:countryName(g)||g):by==="event"?eventLabel(g):g;
const xLabel=(iv:string)=>(b:string)=>iv==="hour"?(b.slice(11)==="00:00"?day(b.slice(0,10)):b.slice(11)):day(b.slice(0,10));

export function MetricChart({supabase,site,from,to,config,page,height=190,onData}:{supabase:any;site:any;from:string;to:string;config:any;page?:string;height?:number;onData?:(d:any)=>void}){
  const [d,setD]=useState<any>(null),[err,setErr]=useState("");
  const cfg={...config,page:config.page||page||""};
  const key=JSON.stringify([site.id,from,to,cfg]);
  useEffect(()=>{let alive=true;setD(null);setErr("");rpc(supabase,"insights_metric",{p_site:site.id,p:cfg,p_from:from,p_to:to}).then(r=>{if(alive){setD(r);onData?.(r)}}).catch(e=>alive&&setErr(e.message));return()=>{alive=false}},[key]);
  if(err)return <p className="rumNotice">{err}</p>;
  if(!d)return <div className="rumChartLoading" style={{height}}/>;
  const m=metricOf(d.metric),aggs:string[]=d.aggs||["avg"],series:any[]=d.series||[];
  if(!series.length)return <Nothing text="No data for this chart in this range."/>;
  const grouped=d.group!=="none";
  const lines=grouped?series.map((s:any,i:number)=>({key:"g"+i,label:groupLabel(s.group,d.group),color:COLOURS[i%COLOURS.length],src:s,agg:aggs[0]})):aggs.map(a=>({key:a,label:AGGS.find(x=>x[0]===a)?.[1]||a,color:aggs.length===1?COLOURS[0]:AGG_COLOURS[a],src:series[0],agg:a}));
  const rows=(d.buckets||[]).map((b:string)=>{const r:any={b};for(const l of lines){const v=l.src.points?.[b]?.[l.agg];r[l.key]=v==null?(d.zero_fill?0:null):Number(v)}return r});
  const kind=config.chart==="line"||config.chart==="bars"?config.chart:d.zero_fill?"bars":"line";
  const vit=VITALS[d.metric];
  return <>
    <TimeChart legend={false} rows={rows} series={lines.map(l=>({key:l.key,label:l.label,color:l.color}))} kind={kind} height={height} xKey="b" xFmt={xLabel(d.interval)} fmt={v=>fmtUnit(m.unit,v)}
      lines={vit&&!grouped&&config.thresholds!==false?[{value:vit.good,color:"#22c55e",label:"Good"},{value:vit.poor,color:"#ef4444",label:"Poor"}]:undefined}/>
    {lines.length>1&&<div className="rumMetricTotals">{lines.map(l=><span key={l.key}><i style={{background:l.color}}/>{l.label}<b>{fmtUnit(m.unit,l.src.total?.[l.agg])}</b></span>)}</div>}
  </>;
}
function headline(d:any){if(!d?.series?.length)return "";const m=metricOf(d.metric),a=(d.aggs||[])[0];
  if(d.group!=="none"&&d.zero_fill)return fmtUnit(m.unit,d.series.reduce((s:number,x:any)=>s+Number(x.total?.[a]||0),0));
  if(d.group!=="none")return "";return fmtUnit(m.unit,d.series[0].total?.[a])}
function ChartCard({title,note,right,...p}:any){
  const [d,setD]=useState<any>(null);const a=(d?.aggs||[])[0],h=headline(d);
  const sub=d&&d.group==="none"&&a&&a!=="count"&&a!=="sum"?(AGGS.find(x=>x[0]===a)?.[1]||a).toLowerCase()+", whole range":"total";
  return <Card title={title} note={note} right={<span className="rumCardRight">{h&&<span className="rumHeadline"><b>{h}</b><small>{sub}</small></span>}{right}</span>}>
    <MetricChart {...p} onData={setD}/>
  </Card>;
}

const PCT=["avg","p50","p90","p95","p99"];
const BUILT:{key:string;label:string;charts:{title:string;note?:string;config:any}[]}[]=[
  {key:"vitals",label:"Web vitals",charts:[
    {title:"Time to first byte",note:"DNS, connection, TLS and server time",config:{metric:"ttfb",aggs:PCT}},
    {title:"First contentful paint",note:"When the first text or image appears",config:{metric:"fcp",aggs:PCT}},
    {title:"Largest contentful paint",note:"When the main content appears",config:{metric:"lcp",aggs:PCT}},
    {title:"Interaction to next paint",note:"How quickly taps and clicks respond",config:{metric:"inp",aggs:PCT}},
    {title:"Cumulative layout shift",note:"How much the page jumps while loading",config:{metric:"cls",aggs:PCT}},
    {title:"Page load",note:"Until the whole page has loaded",config:{metric:"load_ms",aggs:PCT}},
    {title:"DOM ready",note:"Until the page's HTML is ready",config:{metric:"dom_ms",aggs:PCT}},
    {title:"JavaScript heap used",note:"Memory used by the page's scripts — a rising baseline can mean a leak (Chrome and Edge only)",config:{metric:"heap_mb",aggs:PCT}},
  ]},
  {key:"visits",label:"Website visits",charts:[
    {title:"Sessions",config:{metric:"sessions"}},
    {title:"Users",config:{metric:"users"}},
    {title:"Page views by device",config:{metric:"pageviews",group:"device"}},
    {title:"Sessions by source",config:{metric:"sessions",group:"source"}},
    {title:"Session duration",config:{metric:"session_duration",aggs:["avg","p50","p90"]}},
    {title:"Time on page",config:{metric:"time_on_page",aggs:["avg","p50","p90"]}},
    {title:"Bounce rate",note:"Sessions that saw one page",config:{metric:"bounce_rate"}},
    {title:"Form conversion rate",note:"Sessions that sent a form",config:{metric:"conversion_rate"}},
    {title:"Scroll depth",config:{metric:"scroll",aggs:["avg","p50"]}},
    {title:"Errors",note:"JavaScript and network errors",config:{metric:"error_count",aggs:["sum"]}},
  ]},
];

export function Metrics({supabase,site,from,to,manage}:any){
  const [board,setBoard]=useState("vitals"),[page,setPage]=useState(""),[pageQ,setPageQ]=useState(""),[charts,setCharts]=useState<any[]>([]),[edit,setEdit]=useState<any>(null),[notice,setNotice]=useState("");
  async function load(){const {data,error}=await supabase.from("insight_charts").select("*").eq("site_id",site.id).eq("is_active",true).order("sort_order").order("created_at");if(error)setNotice(error.message);else setCharts(data||[])}
  useEffect(()=>{void load()},[site.id]);
  async function remove(c:any){if(!window.confirm("Remove the chart \""+c.title+"\"?"))return;const {error}=await supabase.from("insight_charts").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",c.id);if(error)setNotice(error.message);else void load()}
  async function move(c:any,dir:number){const i=charts.indexOf(c),j=i+dir;if(j<0||j>=charts.length)return;const list=[...charts];[list[i],list[j]]=[list[j],list[i]];setCharts(list);
    await Promise.all(list.map((x,k)=>supabase.from("insight_charts").update({sort_order:k}).eq("id",x.id)))}
  const built=BUILT.find(b=>b.key===board);
  return <>
    <div className="rumMetricBar">
      <div className="rumSeg" role="tablist">{[...BUILT.map(b=>[b.key,b.label]),["custom","Custom charts"+(charts.length?" ("+charts.length+")":"")]].map(([k,l])=><button key={k} type="button" role="tab" aria-selected={board===k} className={board===k?"on":""} onClick={()=>setBoard(k)}>{l}</button>)}</div>
      <form onSubmit={e=>{e.preventDefault();setPage(pageQ.trim())}}><input type="search" value={pageQ} onChange={e=>{setPageQ(e.target.value);if(!e.target.value)setPage("")}} placeholder="Filter by page, e.g. /contact"/></form>
      {board==="custom"&&manage&&<button type="button" className="rumBtn go" onClick={()=>setEdit({title:"",config:{metric:"lcp",aggs:["p75"],group:"none"}})}>+ Add chart</button>}
    </div>
    {notice&&<p className="rumNotice">{notice}</p>}
    {page&&<p className="rumHelp">Showing pages containing <b>{page}</b>.</p>}
    {built&&<div className="rumMetricGrid">{built.charts.map(c=><ChartCard key={c.title} title={c.title} note={c.note} supabase={supabase} site={site} from={from} to={to} config={c.config} page={page}/>)}</div>}
    {board==="custom"&&(!charts.length?<Card><Nothing text={manage?"No custom charts yet. Add one to chart any measure — for example p95 page load by page, quote values by service, or sessions by country.":"No custom charts yet."}/></Card>
      :<div className="rumMetricGrid">{charts.map((c,i)=><ChartCard key={c.id} title={c.title} note={describe(c.config)} supabase={supabase} site={site} from={from} to={to} config={c.config} page={page}
        right={manage&&<span className="rumActions"><button type="button" className="rumIconBtn" title="Move earlier" disabled={i===0} onClick={()=>void move(c,-1)}>↑</button><button type="button" className="rumIconBtn" title="Move later" disabled={i===charts.length-1} onClick={()=>void move(c,1)}>↓</button><button type="button" className="rumBtn" onClick={()=>setEdit(c)}>Edit</button><button type="button" className="rumBtn" onClick={()=>void remove(c)}>Remove</button></span>}/>)}</div>)}
    {edit&&<ChartBuilder supabase={supabase} site={site} from={from} to={to} chart={edit} onClose={()=>setEdit(null)} onSaved={()=>{setEdit(null);setBoard("custom");void load()}} order={charts.length}/>}
  </>;
}
function describe(c:any){const m=metricOf(c.metric);const a=(m.fixed||c.aggs||[]).map((x:string)=>AGGS.find(y=>y[0]===x)?.[1]||x).join(", ");
  return [m.label+(m.fixed?"":" · "+a),c.group&&c.group!=="none"?"by "+(GROUPS.find(g=>g[0]===c.group)?.[1]||c.group).toLowerCase():"",c.event?"event “"+eventLabel(c.event)+"”":"",c.prop?"property “"+c.prop+"”":""].filter(Boolean).join(" · ")}

function ChartBuilder({supabase,site,from,to,chart,onClose,onSaved,order}:any){
  const [title,setTitle]=useState(chart.title||""),[c,setC]=useState<any>({group:"none",aggs:["avg"],...chart.config}),[busy,setBusy]=useState(false),[msg,setMsg]=useState(""),[names,setNames]=useState<string[]>([]),[preview,setPreview]=useState<any>(null);
  useEffect(()=>{void rpc(supabase,"insights_events",{p_site:site.id,p_from:from,p_to:to}).then(d=>setNames((d?.events||[]).map((e:any)=>e.name))).catch(()=>{})},[]);
  const m=metricOf(c.metric),isEvent=m.group==="Events";
  const set=(v:any)=>{setC((x:any)=>{const n={...x,...v};const mm=metricOf(n.metric);if(mm.fixed)n.aggs=mm.fixed;else if(!n.aggs?.length||n.aggs.every((a:string)=>a==="count"))n.aggs=["avg"];if(mm.group!=="Events"&&["event","prop"].includes(n.group))n.group="none";return n});setPreview(null)};
  const toggleAgg=(a:string)=>set({aggs:c.aggs.includes(a)?c.aggs.filter((x:string)=>x!==a):[...c.aggs,a].slice(-6)});
  const clean=()=>{const o:any={metric:c.metric,aggs:m.fixed||c.aggs,group:c.group||"none"};if(isEvent&&c.event)o.event=c.event;if(isEvent&&c.prop)o.prop=c.prop;if(c.page)o.page=c.page;if(c.interval)o.interval=c.interval;if(c.chart)o.chart=c.chart;return o};
  async function save(e:any){e.preventDefault();if(c.metric==="event_value"&&!c.prop){setMsg("Choose the event property to measure.");return}if(c.group==="prop"&&!c.prop){setMsg("Choose the event property to split by.");return}
    setBusy(true);setMsg("");const row={site_id:site.id,title:title.trim()||describe(clean()),config:clean(),updated_at:new Date().toISOString()};
    const {error}=chart.id?await supabase.from("insight_charts").update(row).eq("id",chart.id):await supabase.from("insight_charts").insert({...row,sort_order:order});
    setBusy(false);if(error)setMsg(error.message);else onSaved()}
  const groups=GROUPS.filter(([k])=>isEvent||!["event","prop"].includes(k));
  return <div className="rumDrawerBack" role="dialog" aria-modal="true" aria-label="Chart" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="rumDrawer rumBuilder"><form onSubmit={save}>
    <header><div><span className="rumKicker">Metrics</span><h2>{chart.id?"Edit chart":"New chart"}</h2></div><button type="button" className="rumClose" onClick={onClose} aria-label="Close">×</button></header>
    <label>Title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder={describe(clean())}/></label>
    <label>Measure<select value={c.metric} onChange={e=>set({metric:e.target.value})}>{[...new Set(METRICS.map(x=>x.group))].map(g=><optgroup key={g} label={g}>{METRICS.filter(x=>x.group===g).map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}</select></label>
    {isEvent&&<div className="rumRow2"><label>Event {c.metric==="events"||c.metric==="event_users"?<small>optional — all events if blank</small>:null}<input list="rumMetricEvents" value={c.event||""} onChange={e=>set({event:e.target.value})} placeholder="e.g. Quote requested"/></label>
      <label>Property {c.metric==="event_value"?<small>the number to measure</small>:<small>optional, for splitting</small>}<input value={c.prop||""} onChange={e=>set({prop:e.target.value})} placeholder="e.g. value"/></label>
      <datalist id="rumMetricEvents">{names.map(n=><option key={n} value={n}/>)}</datalist></div>}
    <fieldset className="rumAggs"><legend>Aggregation{m.fixed?" — fixed for this measure":" — pick up to six"}</legend>
      {AGGS.filter(([k])=>k!=="count"||m.fixed?.includes("count")).map(([k,l])=><label key={k} className={(m.fixed||c.aggs).includes(k)?"on":""}><input type="checkbox" disabled={!!m.fixed} checked={(m.fixed||c.aggs).includes(k)} onChange={()=>toggleAgg(k)}/>{l}</label>)}</fieldset>
    <div className="rumRow2"><label>Split by<select value={c.group||"none"} onChange={e=>set({group:e.target.value})}>{groups.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
      <label>Pages containing <small>optional</small><input value={c.page||""} onChange={e=>set({page:e.target.value})} placeholder="all pages"/></label></div>
    {c.group&&c.group!=="none"&&(m.fixed||c.aggs).length>1&&<p className="rumHelp">When split, the chart shows the first aggregation ({AGGS.find(x=>x[0]===(m.fixed||c.aggs)[0])?.[1]}) for the top 8 values.</p>}
    <div className="rumRow2"><label>Time buckets<select value={c.interval||""} onChange={e=>set({interval:e.target.value})}><option value="">Automatic</option><option value="hour">Hourly</option><option value="day">Daily</option><option value="week">Weekly</option></select></label>
      <label>Chart<select value={c.chart||""} onChange={e=>set({chart:e.target.value})}><option value="">Automatic</option><option value="line">Lines</option><option value="bars">Bars</option></select></label></div>
    <div className="rumPreviewBox"><div className="rumBarRow"><b>Preview</b><button type="button" className="rumBtn" onClick={()=>setPreview(clean())}>{preview?"Refresh":"Show preview"}</button></div>
      {preview&&<MetricChart supabase={supabase} site={site} from={from} to={to} config={preview} height={170}/>}</div>
    {msg&&<p className="rumNotice">{msg}</p>}
    <div className="rumDrawerActions"><button className="rumBtn go" disabled={busy}>{busy?"Saving…":chart.id?"Save chart":"Add chart"}</button><button type="button" className="rumBtn" onClick={onClose}>Cancel</button></div>
  </form></aside></div>;
}
