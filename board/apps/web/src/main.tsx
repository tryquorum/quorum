import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { ShortcutProvider } from "@/components/shortcut-dispatch"
import { trackInputModality } from "@/lib/input-modality"
import { trackScrollActivity } from "@/lib/scroll-activity"

// 문서 화면보다 먼저: 첫 문서를 여는 입력도 놓치지 않게(모르면 키보드로 보고 링을 보여요)
const stopInputModality = trackInputModality()
import.meta.hot?.dispose(stopInputModality)
// 스크롤하는 동안만 그 영역의 스크롤 막대를 진하게(index.css 의 [data-scrolling])
const stopScrollActivity = trackScrollActivity()
import.meta.hot?.dispose(stopScrollActivity)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShortcutProvider>
      <ThemeProvider defaultTheme="system">
        <App />
      </ThemeProvider>
    </ShortcutProvider>
  </StrictMode>
)
