import { lazy, Suspense } from "react"
import { LoadErrorBoundary } from "@/components/load-error-boundary"
import { cn } from "@/lib/utils"

const Md = lazy(() => import("@/components/md").then((m) => ({ default: m.Md })))
export function LazyMd({ text, className }: { text: string; className?: string }) {
  const fallback = <div className={cn("whitespace-pre-wrap", className)}>{text}</div>
  return <LoadErrorBoundary fallback={fallback}><Suspense fallback={fallback}><Md text={text} className={className} /></Suspense></LoadErrorBoundary>
}
