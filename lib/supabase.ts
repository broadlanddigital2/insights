import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gbxjvsrgqcomkjxakbso.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_H-Lkd8bqRlsdm5jljKJwBA_VF8Vmz3q";

export function createClient(){
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {fetch: async (input, init) => {
      const url=new URL(input instanceof Request?input.url:String(input));
      if(!/^\/(auth|rest)\/v1\//.test(url.pathname))return fetch(input,init);
      const controller=new AbortController();
      const sourceSignal=init?.signal||(input instanceof Request?input.signal:undefined);
      const abort=()=>controller.abort();
      if(sourceSignal?.aborted)abort();
      else sourceSignal?.addEventListener("abort",abort,{once:true});
      const timer=setTimeout(abort,30000);
      try{return await fetch(input,{...init,signal:controller.signal});}
      finally{clearTimeout(timer);sourceSignal?.removeEventListener("abort",abort);}
    }}
  });
}


export async function withRequestTimeout<T>(operation:PromiseLike<T>,milliseconds=35000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve(operation),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error("The request took too long. Please reload the page and try again.")),milliseconds);
  })]);}finally{if(timer)clearTimeout(timer);}
}
