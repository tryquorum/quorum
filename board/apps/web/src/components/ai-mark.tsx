import type { SVGProps } from "react"
import { cn } from "@/lib/utils"

/**
 * AI 표시: Paper "컴포넌트" 페이지의 ✦ (네 갈래 별 하나). lucide Sparkles(별 + 십자 + 점) 대신 쓴다.
 * 색은 쓰는 곳에서 text-ai 로 정한다. 크기는 다른 아이콘처럼 size-* 로.
 */
export function AiMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn("size-4 shrink-0", className)} {...props}>
      <path d="M12 2.5c.55 5.3 3.2 7.95 9.5 9.5-6.3 1.55-8.95 4.2-9.5 9.5-.55-5.3-3.2-7.95-9.5-9.5 6.3-1.55 8.95-4.2 9.5-9.5Z" />
    </svg>
  )
}
