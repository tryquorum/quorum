import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { renderToStaticMarkup } from "react-dom/server"
import { cn } from "@/lib/utils"
import { fileSrc } from "@/lib/api"

// 이미지 주소: AI가 적은 로컬 경로도 보이게
const urlTransform = (url: string, key: string) => defaultUrlTransform(key === "src" ? fileSrc(url) : url)

/** AI 답 렌더링 (일반 AI 채팅처럼: 제목, 목록, 표, 코드, 링크, 이미지) */
export function Md({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          a: ({ node, ...p }) => { void node; return <a {...p} target="_blank" rel="noopener" /> },
          img: ({ node, ...p }) => { void node; return <a href={p.src as string} target="_blank" rel="noopener" className="block"><img {...p} loading="lazy" /></a> },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** 노트에 넣을 HTML 로 바꾸기 */
export function mdToHtml(text: string) {
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform}>{text}</ReactMarkdown>)
    // GFM 체크리스트 → 노트(Tiptap) 체크리스트
    .replace(/<ul class="contains-task-list">/g, '<ul data-type="taskList">')
    .replace(/<li class="task-list-item"><input\b([^>]*?)\/>\s*((?:(?!<li\b|<\/li>)[\s\S])*?)<\/li>/g, (_m, attrs: string, body: string) => `<li data-type="taskItem" data-checked="${/\bchecked(?:=|\s|$)/.test(attrs) ? "true" : "false"}"><p>${body.trim()}</p></li>`)
}
