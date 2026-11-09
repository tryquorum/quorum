import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { setTransport } from "@/workspace/api"
import { Workspace } from "@/workspace/workspace"
import { createDemoServer } from "./server"

// Entry for /media/workspace-demo.html, which the landing shows in an iframe. Same Workspace as /w, recorded data.
setTransport(createDemoServer())
// Wide previews open on the Seoul request so the popup and Send to agent are in view; phones start on Now.
if (!location.hash) location.replace("#/now" + (innerWidth >= 900 ? "?open=i:seoul-ask" : ""))
// Links out of the workspace (console, home) would navigate the preview itself; keep the visitor on the landing.
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
  if (a && !a.getAttribute("href")!.startsWith("#")) e.preventDefault()
}, true)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workspace />
  </StrictMode>
)
