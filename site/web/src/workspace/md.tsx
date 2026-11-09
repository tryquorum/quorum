// Workspace 마크다운 표시. 사이트 공용 렌더러(components/md.tsx, 방향판 board/apps/web 의 react-markdown + GFM)를 그대로 써요:
// 번호 목록·체크박스·표·링크까지 그려요. react-markdown 은 HTML 을 문자로만 다뤄서(rehype-raw 없음) 실행기 출력이 화면에 스크립트로 들어갈 길이 없어요.
import { Md as Markdown } from "@/components/md"
import { cn } from "@/lib/utils"

export function Md({ text, className }: { text: string; className?: string }) {
  return <Markdown text={text} className={cn("md-compact", className)} />
}
