"use client";
import {useEffect,useState} from "react";

// Insights' own administration (not the CRM): who can add websites and see every site, and your own account.
async function call(supabase:any,body:any){
  const {data,error}=await supabase.functions.invoke("insights-admin",{body});
  if(error){const v=await error.context?.json?.().catch(()=>null);throw new Error(v?.error||error.message);}
  if(data?.error)throw new Error(data.error);return data;
}
const when=(v:string)=>v?new Date(v).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"";

export function Admins({supabase,me}:{supabase:any;me:any}){
  const [rows,setRows]=useState<any[]|null>(null),[email,setEmail]=useState(""),[first,setFirst]=useState(""),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  async function run(body:any,done?:string){setBusy(true);setMsg("");try{const r=await call(supabase,body);setRows(r.admins||[]);if(done)setMsg(done);}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  useEffect(()=>{void run({action:"list_admins"})},[]);
  return <section className="insHome">
    <div className="quoteSectionHead"><div><h1>Insights admins</h1><p className="employeeMuted">Admins can add websites for anyone, set plans and limits, and see every website. They're separate from CRM roles. Everyone else only sees the websites they're invited to.</p></div></div>
    <div className="reportPanel">
      <h2>Add an admin</h2>
      <form className="insForm insInline" onSubmit={e=>{e.preventDefault();void run({action:"add_admin",email,first_name:first},`Added ${email}. They've been emailed a link to sign in${""}.`).then(()=>{setEmail("");setFirst("")})}}>
        <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>
        <label>First name <small>optional</small><input value={first} onChange={e=>setFirst(e.target.value)}/></label>
        <button className="crmPrimary" disabled={busy}>{busy?"…":"ADD ADMIN"}</button>
      </form>
      {msg&&<p className="crmNotice">{msg}</p>}
    </div>
    <div className="reportPanel">
      <h2>Admins</h2>
      {!rows?<p className="employeeMuted">Loading…</p>:<table className="reportTable"><tbody>{rows.map(a=><tr key={a.email}><td>{a.email}{String(a.email).toLowerCase()===String(me?.email||"").toLowerCase()?" (you)":""}</td><td className="employeeMuted">added {when(a.added_at)}{a.user_id?"":" · hasn't signed in yet"}</td>
        <td className="num">{String(a.email).toLowerCase()!==String(me?.email||"").toLowerCase()&&<button type="button" className="employeeLinkButton" disabled={busy} onClick={()=>{if(window.confirm(`Remove ${a.email} as an Insights admin? They keep access to any websites they're invited to.`))void run({action:"remove_admin",email:a.email},`Removed ${a.email}.`)}}>Remove</button>}</td></tr>)}</tbody></table>}
    </div>
  </section>;
}

export function Account({supabase,user}:{supabase:any;user:any}){
  const md=user?.user_metadata||{};
  const [first,setFirst]=useState(md.first_name||""),[last,setLast]=useState(md.last_name||""),[pw,setPw]=useState(""),[pw2,setPw2]=useState(""),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  async function saveName(e:any){e.preventDefault();setBusy(true);setMsg("");try{await call(supabase,{action:"update_account",first_name:first,last_name:last});await supabase.auth.refreshSession();setMsg("Saved.")}catch(err:any){setMsg(err.message)}finally{setBusy(false)}}
  async function savePw(e:any){e.preventDefault();setMsg("");if(pw.length<10){setMsg("Use at least 10 characters.");return}if(pw!==pw2){setMsg("The two passwords don't match.");return}
    setBusy(true);const {error}=await supabase.auth.updateUser({password:pw});setBusy(false);if(error){setMsg(error.message);return}setPw("");setPw2("");setMsg("Password changed.")}
  return <section className="insHome">
    <div className="quoteSectionHead"><div><h1>Your account</h1><p className="employeeMuted">Signed in as {user?.email}. This is your Insights login.</p></div></div>
    <div className="reportPanel"><h2>Your name</h2>
      <form className="insForm insInline" onSubmit={saveName}><label>First name<input value={first} onChange={e=>setFirst(e.target.value)}/></label><label>Last name<input value={last} onChange={e=>setLast(e.target.value)}/></label><button className="crmPrimary" disabled={busy}>SAVE</button></form></div>
    <div className="reportPanel"><h2>Change password</h2>
      <form className="insForm insInline" onSubmit={savePw}><label>New password<input type="password" autoComplete="new-password" value={pw} onChange={e=>setPw(e.target.value)}/></label><label>Repeat it<input type="password" autoComplete="new-password" value={pw2} onChange={e=>setPw2(e.target.value)}/></label><button className="crmPrimary" disabled={busy}>CHANGE PASSWORD</button></form></div>
    {msg&&<p className="crmNotice">{msg}</p>}
  </section>;
}
