import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  heading?: "h1" | "h2"
  /** 머리글 맨 윗줄이 이미 같은 이름을 보여 주면 참: 좁은 화면에선 제목을 눈에서 숨기고(읽기 프로그램·화면 이동 포커스용으로는 남겨요) 첫 화면을 내용에 줘요 */
  echoesHeader?: boolean
  className?: string
}
export function PageHeader({ title, description, actions, meta, heading: Heading = "h1", echoesHeader = false, className }: PageHeaderProps) {
  const bare = echoesHeader && !description && !meta && !actions
  return <div className={cn("mb-5 flex flex-wrap items-end gap-3", className, bare && "max-md:mb-0")}>
    <div className={cn("min-w-0 flex-1", echoesHeader && !description && !meta && "max-md:sr-only")}>
      <Heading tabIndex={-1} data-page-title className="text-xl font-semibold tracking-tight outline-none">{title}</Heading>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {meta && <div className="mt-1 text-xs text-muted-foreground">{meta}</div>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2 max-md:flex-1">{actions}</div>}
  </div>
}
