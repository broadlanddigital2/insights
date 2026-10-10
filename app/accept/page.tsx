"use client";
import {useEffect,useState} from "react";
import {createClient} from "../../lib/supabase";

// Invitation, sign-in and "Open in Insights" links land here (?token_hash=…&type=invite|magiclink|recovery). New people choose a password.
export default function Accept(){
  const [msg,setMsg]=useState("Checking your link…"),[setPw,setSetPw]=useState(false),[busy,setBusy]=useState(false);
  // After signing in, go where the link says (e.g. "/?site=…" from the CRM's "Open in Insights"), else the home page.
  const home=()=>{const n=new URLSearchParams(location.search).get("next")||"";location.assign(n.startsWith("/")&&!n.startsWith("//")?n:"/")};
  useEffect(()=>{void(async()=>{
    const p=new URLSearchParams(location.search),token_hash=p.get("token_hash"),type=(p.get("type")||"magiclink") as any;
    const supabase=createClient();
    if(token_hash){const {error}=await supabase.auth.verifyOtp({token_hash,type});if(error){setMsg("This link has expired or has already been used. Ask for a new sign-in link on the sign-in page.");return}}
    const {data:{user}}=await supabase.auth.getUser();if(!user){setMsg("Open this page from the link in your email.");return}
    await supabase.rpc("insights_claim_invites");
    if(type==="invite"||type==="recovery"){setSetPw(true);setMsg("");return}
    home();
  })()},[]);
  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget),a=String(f.get("password")),b=String(f.get("confirm"));
    if(a!==b){setMsg("The passwords don't match.");return}
    setBusy(true);const {error}=await createClient().auth.updateUser({password:a});setBusy(false);
    if(error){setMsg(error.message);return}
    home();
  }
  return <main className="insLogin"><div className="insLoginCard"><div className="insBrand">INSIGHTS</div>
    {setPw?<form onSubmit={save}><h1>Choose a password</h1><p className="employeeMuted">You'll use this with your email to sign in.</p>
      <label>Password<input name="password" type="password" minLength={8} required autoComplete="new-password"/></label>
      <label>Confirm password<input name="confirm" type="password" minLength={8} required autoComplete="new-password"/></label>
      <button className="crmPrimary" disabled={busy}>{busy?"SAVING…":"SAVE AND OPEN"}</button></form>:null}
    {msg&&<p className={setPw?"crmNotice":"employeeMuted"}>{msg}</p>}
  </div></main>;
}
