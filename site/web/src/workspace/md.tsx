// 아주 작은 마크다운 표시(제목·목록·코드 블록·굵게). 출처: board/apps/web/src/components/md.tsx 가 하는 일 중 실행 요약에 필요한 만큼만.
// HTML 을 만들지 않고 React 요소로만 그려서 실행기 출력이 화면에 스크립트로 들어갈 길이 없어요.
import { Fragment } from "react"

const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
  p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith("`") && p.endsWith("`") && p.length > 1 ? <code key={i} className="rounded bg-muted px-1 font-mono text-[0.85em]">{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>)

export function Md({ text, className }: { text: string; className?: string }) {
  const out: React.ReactNode[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith("```")) {
      const body: string[] = []
      while (++i < lines.length && !lines[i].startsWith("```")) body.push(lines[i])
      out.push(<pre key={i} className="my-1.5 max-h-48 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-2xs leading-4">{body.join("\n")}</pre>)
    } else if (/^#{1,6}\s/.test(l)) out.push(<p key={i} className="mt-2 mb-0.5 font-semibold">{inline(l.replace(/^#+\s/, ""))}</p>)
    else if (/^\s*[-*]\s/.test(l)) out.push(<p key={i} className="flex gap-1.5 pl-1"><span className="text-muted-foreground">•</span><span className="min-w-0">{inline(l.replace(/^\s*[-*]\s/, ""))}</span></p>)
    else if (l.trim()) out.push(<p key={i}>{inline(l)}</p>)
  }
  return <div className={className}>{out}</div>
}
