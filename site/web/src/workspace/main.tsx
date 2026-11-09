import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { Workspace } from "./workspace.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workspace />
  </StrictMode>
)
