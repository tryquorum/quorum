import { Component, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export class LoadErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return this.props.fallback ?? <div role="alert" className="m-4 flex items-center gap-3 rounded-lg border bg-muted p-4 text-sm"><span>화면을 불러오지 못했어요</span><Button variant="outline" size="sm" onClick={() => location.reload()}>새로고침</Button></div>
  }
}

export function LoadingSkeleton() {
  return <div aria-busy="true" className="delayed-show space-y-3 p-6"><span className="sr-only">화면을 불러오는 중이에요</span><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
}
