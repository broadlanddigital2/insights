"use client";
import {useEffect,useRef,useState} from "react";

// Shared bits for the Insights screens: formatting, people/location labels, and small SVG charts.
export const REC=(process.env.NEXT_PUBLIC_SUPABASE_URL||"https://dipjypzrfigkzuarlsov.supabase.co")+"/functions/v1/web-recorder";
export const num=(n:any)=>Number(n||0).toLocaleString("en-GB");
export const pct=(a:any,b:any)=>Number(b)>0?Math.round(Number(a||0)/Number(b)*100)+"%":"–";
export const dur=(s:number)=>{s=Math.round(Number(s)||0);return s>=3600?Math.floor(s/3600)+"h "+Math.floor(s%3600/60)+"m":s>=60?Math.floor(s/60)+"m "+(s%60)+"s":s+"s"};
export const when=(v:string)=>v?new Date(v).toLocaleString("en-GB",{timeZone:"Europe/London",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"–";
export const clock=(v:string)=>new Date(v).toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",second:"2-digit"});
export const ago=(v:string)=>{if(!v)return "–";const m=Math.round((Date.now()-new Date(v).getTime())/60000);return m<1?"just now":m<60?m+" min ago":m<1440?Math.round(m/60)+" h ago":m<43200?Math.round(m/1440)+" days ago":new Date(v).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})};
export const day=(d:string)=>new Date(d+"T12:00:00Z").toLocaleDateString("en-GB",{day:"numeric",month:"short",timeZone:"UTC"});
export async function rpc(supabase:any,name:string,args:any){const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message);return data}
export function range(from:string,to:string){return {f:new Date(from+"T00:00:00").toISOString(),t:new Date(new Date(to+"T00:00:00").getTime()+86400000).toISOString()}}

// ---- places ----
let regionNames:any=null;
export function countryName(code?:string|null){if(!code)return "";try{regionNames=regionNames||new (Intl as any).DisplayNames(["en-GB"],{type:"region"});return regionNames.of(code)||code}catch{return code}}
export function flag(code?:string|null){if(!code||!/^[A-Z]{2}$/i.test(code))return "🌐";return String.fromCodePoint(...code.toUpperCase().split("").map(c=>127397+c.charCodeAt(0)))}
// Without a country (some networks don't give one) the visitor's time zone still says roughly where they are.
const TZ:Record<string,string>={"Europe/London":"GB","Europe/Dublin":"IE","Europe/Paris":"FR","Europe/Berlin":"DE","Europe/Madrid":"ES","Europe/Rome":"IT","Europe/Amsterdam":"NL","Europe/Brussels":"BE","Europe/Lisbon":"PT","Europe/Zurich":"CH","Europe/Vienna":"AT","Europe/Stockholm":"SE","Europe/Oslo":"NO","Europe/Copenhagen":"DK","Europe/Helsinki":"FI","Europe/Warsaw":"PL","Europe/Prague":"CZ","Europe/Budapest":"HU","Europe/Athens":"GR","Europe/Bucharest":"RO","Europe/Sofia":"BG","Europe/Kiev":"UA","Europe/Kyiv":"UA","Europe/Istanbul":"TR","Europe/Moscow":"RU","Europe/Jersey":"JE","Europe/Guernsey":"GG","Europe/Isle_of_Man":"IM","Europe/Gibraltar":"GI","Europe/Monaco":"MC","Europe/Luxembourg":"LU","Europe/Malta":"MT",
  "America/New_York":"US","America/Chicago":"US","America/Denver":"US","America/Los_Angeles":"US","America/Phoenix":"US","America/Toronto":"CA","America/Vancouver":"CA","America/Mexico_City":"MX","America/Sao_Paulo":"BR","America/Argentina/Buenos_Aires":"AR",
  "Asia/Dubai":"AE","Asia/Kolkata":"IN","Asia/Calcutta":"IN","Asia/Singapore":"SG","Asia/Hong_Kong":"HK","Asia/Shanghai":"CN","Asia/Tokyo":"JP","Asia/Seoul":"KR","Asia/Bangkok":"TH","Asia/Manila":"PH","Asia/Karachi":"PK","Asia/Riyadh":"SA","Asia/Qatar":"QA","Asia/Jerusalem":"IL",
  "Australia/Sydney":"AU","Australia/Melbourne":"AU","Australia/Brisbane":"AU","Australia/Perth":"AU","Pacific/Auckland":"NZ","Africa/Johannesburg":"ZA","Africa/Lagos":"NG","Africa/Cairo":"EG","Africa/Nairobi":"KE"};
export function placeOf(r:{country?:string|null;timezone?:string|null}){
  const code=r.country||(r.timezone?TZ[r.timezone]:null);
  const city=r.timezone&&r.timezone.includes("/")?r.timezone.split("/").pop()!.replace(/_/g," "):"";
  return {code:code||null,label:code?countryName(code):city||"Unknown",city};
}
export function Place({r,short}:{r:any;short?:boolean}){const p=placeOf(r);return <span className="rumPlace" title={[p.label,p.city].filter(Boolean).join(" · ")}><span className="rumFlag">{flag(p.code)}</span>{short?p.code||p.label:p.label}</span>}

// ---- people ----
function hash(s:string){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return Math.abs(h)}
const ANIMALS=["Fox","Otter","Hawk","Badger","Hare","Lynx","Owl","Wolf","Heron","Stag","Raven","Seal","Bison","Panda","Koala","Falcon","Marten","Puffin","Robin","Wren"];
const COLOURS=["Amber","Teal","Coral","Indigo","Olive","Ruby","Slate","Jade","Saffron","Cobalt","Plum","Sienna"];
export function userLabel(u:any){
  if(!u)return "Anonymous";
  if(u.name||u.user_name)return u.name||u.user_name;
  if(u.email||u.user_email)return u.email||u.user_email;
  const key=String(u.user_key||u.id||"");
  if(key.startsWith("u:"))return key.slice(2);
  const h=hash(key);return "Anonymous "+COLOURS[h%COLOURS.length]+" "+ANIMALS[(h>>4)%ANIMALS.length];
}
export function identified(u:any){return String(u?.user_key||"").startsWith("u:")}
export function Avatar({u,size=28}:{u:any;size?:number}){
  const label=userLabel(u),h=hash(String(u?.user_key||label));
  const init=identified(u)?label.replace(/@.*/,"").split(/[\s._-]+/).filter(Boolean).slice(0,2).map((w:string)=>w[0]).join("").toUpperCase():"";
  return <span className={"rumAvatar"+(identified(u)?" known":"")} style={{width:size,height:size,background:`hsl(${h%360} 55% ${identified(u)?42:30}%)`,fontSize:size*0.4}} aria-hidden="true">{init||"?"}</span>;
}
export function Who({u,sub}:{u:any;sub?:string}){return <span className="rumWho"><Avatar u={u}/><span><b>{userLabel(u)}</b>{sub&&<small>{sub}</small>}</span></span>}

// ---- system badges ----
export function Sys({r}:{r:any}){
  return <span className="rumSys">
    {r.device&&<span className="rumChip" title={r.device}>{r.device==="mobile"?"📱":r.device==="tablet"?"📟":"🖥"} {r.device}</span>}
    {r.browser&&<span className="rumChip">{r.browser}{r.browser_version?" "+String(r.browser_version).split(".")[0]:""}</span>}
    {r.os&&<span className="rumChip">{r.os}</span>}
  </span>;
}

// ---- events ----
export const EVENT_NAMES:Record<string,string>={$pageview:"Page view",$click:"Click",$rage_click:"Rage click",$form_submit:"Form sent",$error:"Error",$outbound:"Outbound link",$download:"Download",$email_click:"Email link",$phone_click:"Phone link",$identify:"Identified",$reset:"Signed out"};
export const eventLabel=(n:string)=>EVENT_NAMES[n]||n;
export function eventLine(e:any){
  const p=e.props||{};
  switch(e.name){
    case "$click":return "Clicked "+(p.text?"“"+p.text+"”":p.tag||"something")+(p.href?" → "+shortUrl(p.href):"");
    case "$rage_click":return "Rage-clicked "+(p.text?"“"+p.text+"”":p.tag||"");
    case "$form_submit":return "Sent a form"+(p.id||p.name?" ("+(p.id||p.name)+")":"");
    case "$error":return (p.level==="network"?"Network error: ":"Error: ")+(p.message||"");
    case "$outbound":return "Left to "+shortUrl(p.href);
    case "$download":return "Downloaded "+shortUrl(p.href);
    case "$email_click":return "Clicked email "+String(p.href||"").replace(/^mailto:/,"");
    case "$phone_click":return "Clicked phone "+String(p.href||"").replace(/^tel:/,"");
    case "$identify":return "Identified as "+(p.email||p.id||"");
    case "$pageview":return "Viewed "+(p.title||e.path||"");
    default:{const kv=Object.entries(p).filter(([,v])=>v!==null&&typeof v!=="object").slice(0,4).map(([k,v])=>k+": "+v).join(" · ");return e.name+(kv?" — "+kv:"")}
  }
}
export function shortUrl(u:any){try{const x=new URL(String(u));return x.host+(x.pathname==="/"?"":x.pathname)}catch{return String(u||"")}}

// ---- web vitals ----
export const VITALS:Record<string,{label:string;good:number;poor:number;unit:string;help:string}>={
  lcp:{label:"Largest Contentful Paint",good:2500,poor:4000,unit:"ms",help:"How long the main content takes to appear"},
  inp:{label:"Interaction to Next Paint",good:200,poor:500,unit:"ms",help:"How quickly the page responds to taps and clicks"},
  cls:{label:"Cumulative Layout Shift",good:0.1,poor:0.25,unit:"",help:"How much the page jumps around while loading"},
  fcp:{label:"First Contentful Paint",good:1800,poor:3000,unit:"ms",help:"When the first text or image shows"},
  ttfb:{label:"Time to First Byte",good:800,poor:1800,unit:"ms",help:"How quickly the server starts answering"},
  load_ms:{label:"Page load",good:3000,poor:6000,unit:"ms",help:"When the whole page has finished loading"},
};
export function rate(m:string,v:any){const t=VITALS[m];if(v==null||v===""||!t)return "";const n=Number(v);return n<=t.good?"good":n<=t.poor?"ni":"poor"}
export function fmtVital(m:string,v:any){if(v==null||v==="")return "–";const n=Number(v);if(m==="cls")return n.toFixed(2);return n>=1000?(n/1000).toFixed(2)+" s":Math.round(n)+" ms"}
export function Vital({m,v}:{m:string;v:any}){return <span className={"rumVital "+rate(m,v)}>{fmtVital(m,v)}</span>}
export function Dist({good=0,ni=0,poor=0}:{good?:number;ni?:number;poor?:number}){
  const t=good+ni+poor;if(!t)return <span className="rumDist empty"/>;
  return <span className="rumDist" title={`Good ${pct(good,t)} · Needs improvement ${pct(ni,t)} · Poor ${pct(poor,t)}`}><i className="good" style={{width:good/t*100+"%"}}/><i className="ni" style={{width:ni/t*100+"%"}}/><i className="poor" style={{width:poor/t*100+"%"}}/></span>;
}

// ---- layout bits ----
export function Card({title,note,right,children,className}:{title?:string;note?:string;right?:any;children:any;className?:string}){
  return <section className={"rumCard"+(className?" "+className:"")}>{(title||right)&&<header><div>{title&&<h3>{title}</h3>}{note&&<small>{note}</small>}</div>{right}</header>}{children}</section>;
}
export function Stat({label,value,note,tone,onClick,active}:{label:string;value:any;note?:any;tone?:string;onClick?:()=>void;active?:boolean}){
  const C:any=onClick?"button":"div";
  return <C type={onClick?"button":undefined} className={"rumStat"+(tone?" "+tone:"")+(active?" active":"")} onClick={onClick}><span>{label}</span><strong>{value}</strong>{note!=null&&note!==""&&<small>{note}</small>}</C>;
}
export function Nothing({text}:{text:string}){return <p className="rumEmpty">{text}</p>}
export type Col={key:string;label:string;num?:boolean;w?:string;render?:(r:any)=>any};
export function Grid({cols,rows,onRow,empty="Nothing in this period.",dense}:{cols:Col[];rows:any[];onRow?:(r:any)=>void;empty?:string;dense?:boolean}){
  if(!rows.length)return <Nothing text={empty}/>;
  return <div className="rumTableWrap"><table className={"rumTable"+(dense?" dense":"")+(onRow?" clickable":"")}>
    <thead><tr>{cols.map(c=><th key={c.key} className={c.num?"num":""} style={c.w?{width:c.w}:undefined}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={r.id||r.key||i} onClick={onRow?()=>onRow(r):undefined} tabIndex={onRow?0:undefined} onKeyDown={onRow?e=>{if(e.key==="Enter")onRow(r)}:undefined}>
      {cols.map(c=><td key={c.key} className={c.num?"num":""}>{c.render?c.render(r):r[c.key]}</td>)}</tr>)}</tbody>
  </table></div>;
}
// A list with a bar behind each row, like the breakdown panels in RUM tools.
export function BarList({rows,label="label",value="sessions",render,onRow,max:limit=10,empty="Nothing yet."}:{rows:any[];label?:string;value?:string;render?:(r:any)=>any;onRow?:(r:any)=>void;max?:number;empty?:string}){
  const [all,setAll]=useState(false);
  if(!rows?.length)return <Nothing text={empty}/>;
  const shown=all?rows:rows.slice(0,limit),top=Math.max(...rows.map(r=>Number(r[value])||0),1),total=rows.reduce((a,r)=>a+(Number(r[value])||0),0);
  return <><ul className="rumBars">{shown.map((r,i)=>{const C:any=onRow?"button":"div";return <li key={i}><C type={onRow?"button":undefined} onClick={onRow?()=>onRow(r):undefined}>
    <i style={{width:Math.max(1,(Number(r[value])||0)/top*100)+"%"}}/><span className="l">{render?render(r):String(r[label]??"–")}</span><b>{num(r[value])}</b><small>{pct(r[value],total)}</small></C></li>})}</ul>
    {rows.length>limit&&<button type="button" className="rumMore" onClick={()=>setAll(!all)}>{all?"Show fewer":"Show all "+rows.length}</button>}</>;
}

// Time series: stacked bars or lines, with gridlines, hover values and a shared x axis of days.
export function TimeChart({rows,series,kind="bars",height=200,fmt=num,xKey="date",xFmt=day,lines,legend=true}:{legend?:boolean;rows:any[];series:{key:string;label:string;color:string}[];kind?:"bars"|"line";height?:number;fmt?:(v:any)=>string;xKey?:string;xFmt?:(v:any)=>string;lines?:{value:number;color:string;label:string}[]}){
  const [hover,setHover]=useState<number|null>(null),[W,setW]=useState(1000),box=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{const el=box.current;if(!el||typeof ResizeObserver==="undefined")return;const ro=new ResizeObserver(()=>setW(Math.max(280,Math.round(el.clientWidth)||1000)));ro.observe(el);return()=>ro.disconnect()},[rows?.length]);
  if(!rows?.length)return <Nothing text="No data in this range."/>;
  const H=height,pl=46,pr=10,pt=10,pb=24,iw=W-pl-pr,ih=H-pt-pb,n=rows.length;
  const tot=(r:any)=>kind==="bars"?series.reduce((a,s)=>a+(Number(r[s.key])||0),0):Math.max(...series.map(s=>Number(r[s.key])||0));
  let max=Math.max(...rows.map(tot),...(lines||[]).map(l=>l.value*1.1),0);
  if(max<=0)max=1;
  // A "nice" scale: four equal steps of 1, 2, 2.5 or 5 × a power of ten.
  {const raw=max/4,mag=Math.pow(10,Math.floor(Math.log10(raw))),step=[1,2,2.5,5,10].map(m=>m*mag).find(x=>x>=raw)||raw;max=step*4;}
  const y=(v:number)=>pt+ih-(v/max)*ih,bw=iw/n,x=(i:number)=>pl+bw*i+bw/2;
  const ticks=[0,.25,.5,.75,1].map(f=>f*max);const every=Math.max(1,Math.ceil(n/Math.max(3,Math.floor(W/110))));
  return <div className="rumChart" ref={box} onMouseLeave={()=>setHover(null)}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={series.map(s=>s.label).join(", ")+" over time"}>
      {ticks.map((t,i)=><g key={i}><line x1={pl} x2={W-pr} y1={y(t)} y2={y(t)} className="grid"/><text x={pl-6} y={y(t)+4} textAnchor="end" className="ax">{fmt(Math.round(t*100)/100)}</text></g>)}
      {(lines||[]).map((l,i)=><g key={"l"+i}><line x1={pl} x2={W-pr} y1={y(l.value)} y2={y(l.value)} stroke={l.color} strokeDasharray="5 5" strokeWidth={1.5}/><text x={W-pr-4} y={y(l.value)-4} textAnchor="end" className="ax" fill={l.color}>{l.label}</text></g>)}
      {kind==="bars"?rows.map((r,i)=>{let acc=0;return <g key={i}>{series.map(s=>{const v=Number(r[s.key])||0;const y0=y(acc);acc+=v;const y1=y(acc);return v>0?<rect key={s.key} x={x(i)-bw*0.38} width={bw*0.76} y={y1} height={Math.max(0,y0-y1)} fill={s.color} rx={2} opacity={hover===null||hover===i?1:.55}/>:null})}</g>})
      :series.map(s=>{const pts=rows.map((r,i)=>r[s.key]==null?null:[x(i),y(Number(r[s.key]))]);const d=pts.reduce((a:string,p,i)=>p?a+(a&&pts[i-1]?"L":"M")+p[0].toFixed(1)+","+p[1].toFixed(1):a,"");
        return <g key={s.key}><path d={d} fill="none" stroke={s.color} strokeWidth={2.2} vectorEffect="non-scaling-stroke"/>{n<=45&&pts.map((p,i)=>p&&<circle key={i} cx={p[0]} cy={p[1]} r={hover===i?4:2.2} fill={s.color}/>)}</g>})}
      {rows.map((r,i)=>i%every===0&&<text key={"x"+i} x={x(i)} y={H-6} textAnchor="middle" className="ax">{xFmt(r[xKey])}</text>)}
      {rows.map((_,i)=><rect key={"h"+i} x={pl+bw*i} width={bw} y={pt} height={ih} fill="transparent" onMouseEnter={()=>setHover(i)}/>)}
      {hover!==null&&<line x1={x(hover)} x2={x(hover)} y1={pt} y2={pt+ih} className="cursor"/>}
    </svg>
    {hover!==null&&<div className="rumTip" style={{left:Math.min(80,Math.max(4,(x(hover)/W)*100))+"%"}}><b>{xFmt(rows[hover][xKey])}</b>{series.map(s=><span key={s.key}><i style={{background:s.color}}/>{s.label}<em>{rows[hover][s.key]==null?"–":fmt(rows[hover][s.key])}</em></span>)}</div>}
    {legend&&series.length>1&&<div className="rumLegend">{series.map(s=><span key={s.key}><i style={{background:s.color}}/>{s.label}</span>)}</div>}
  </div>;
}
export const C={primary:"#7c83ff",second:"#38bdf8",third:"#a78bfa",good:"#22c55e",ni:"#f59e0b",poor:"#ef4444",grey:"#475569"};
