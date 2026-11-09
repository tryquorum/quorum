import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { setTransport } from "@/workspace/api"
import { Workspace } from "@/workspace/workspace"
import { createDemoServer } from "./server"

// Entry for /media/workspace-demo.html, which the landing shows in an iframe. Same Workspace as /w, recorded data.
setTransport(createDemoServer())
// Opens closed on Now so the board is visible (audit GAP-1); a hint marks the one thing to try.
if (!location.hash) location.replace("#/now")
// Links out of the workspace (console, home) would navigate the preview itself; keep the visitor on the landing.
document.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
  if (a && !a.getAttribute("href")!.startsWith("#")) e.preventDefault()
}, true)

// The hint: a ring and a short label on the Seoul request row; once its popup is open, the same ring moves to
// Send to agent; after that click it goes away. Only demo-page DOM is touched, never workspace source.
const style = document.createElement("style")
style.textContent = [
  "@keyframes demo-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in oklab,var(--foreground) 45%,transparent)}50%{box-shadow:0 0 0 6px transparent}}",
  ".demo-hint{position:relative;border-radius:12px;outline:1.5px solid var(--foreground);outline-offset:2px;animation:demo-pulse 1.8s ease-in-out infinite}",
  "button.demo-hint{border-radius:9999px}",
  ".demo-hint-label{position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:5;pointer-events:none;border-radius:9999px;padding:2px 8px;font:500 11px/1.6 var(--font-sans);background:var(--foreground);color:var(--background);white-space:nowrap}",
  "@media (prefers-reduced-motion: reduce){.demo-hint{animation:none}}",
].join("")
document.head.appendChild(style)
let sent = false
const mark = (el: HTMLElement | null, label?: string) => {
  document.querySelectorAll(".demo-hint").forEach((x) => { if (x !== el) { x.classList.remove("demo-hint"); x.querySelector(".demo-hint-label")?.remove() } })
  if (!el || el.classList.contains("demo-hint")) return
  el.classList.add("demo-hint")
  if (label) { const s = document.createElement("span"); s.className = "demo-hint-label"; s.textContent = label; el.appendChild(s) }
}
const sendButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((b) => b.textContent?.trim() === "Send to agent") ?? null
const update = () => {
  if (sent) return mark(null)
  const btn = sendButton()
  if (btn) return mark(btn)
  if (document.querySelector("[role=dialog]")) return mark(null)
  const row = document.querySelector<HTMLElement>('[data-row="i:seoul-ask"] > li')
  mark(row, "Start here")
}
document.addEventListener("click", (e) => { if ((e.target as Element | null)?.closest?.(".demo-hint") && sendButton()) sent = true }, true)
new MutationObserver(() => requestAnimationFrame(update)).observe(document.body, { childList: true, subtree: true })

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workspace />
  </StrictMode>
)
