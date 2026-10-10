"use client";
// Small building blocks for the settings and team pages (panels, empty states, simple tables).
export function Panel({title,note,children}:{title:string;note?:string;children:any}){
  return <section className="reportPanel"><header><h2>{title}</h2>{note&&<small>{note}</small>}</header>{children}</section>;
}
export function Empty({text}:{text:string}){return <p className="employeeMuted reportEmpty">{text}</p>}
export function Table({cols,rows}:{cols:string[];rows:any[][]}){
  if(!rows.length)return <Empty text="Nothing here yet."/>;
  return <div className="reportTableWrap"><table className="reportTable"><thead><tr>{cols.map((c,i)=><th key={c+i} className={i?"num":""}>{c}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,k)=><td key={k} className={k?"num":""}>{v}</td>)}</tr>)}</tbody></table></div>;
}
