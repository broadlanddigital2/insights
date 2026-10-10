import "./insights.css";
import type {Metadata} from "next";
export const metadata:Metadata={title:"Insights",description:"Website visitors, sessions, replays, funnels, web vitals and errors",robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><div className="insApp">{children}</div></body></html>}
