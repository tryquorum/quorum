import { useLayoutEffect, useRef } from "react"
import { supportedHtml } from "@/lib/note-html"

/** 노트가 비었을 때 편집기와 미리보기가 같이 보여 주는 안내 */
export const NOTE_PLACEHOLDER = "요약, 결정한 것, 다음 할 일을 적어요. # 제목, - 목록, [] 체크리스트"

/**
 * 편집기를 만들기 전(캐시로 그린 동안, 편집기 코드를 받는 동안) 같은 자리에 같은 모양으로 그리는 읽기 전용 노트.
 * 편집기가 그대로 다룰 수 있는 HTML(supportedHtml 허용 목록)만 그려요. inert 라 링크·체크박스를 누르거나 포커스할 수 없고,
 * 체크박스는 disabled 예요. 바뀌는 건 곧 이 자리에 들어올 편집기뿐이라 화면이 깜빡이지 않아요.
 */
export function NotePreview({ html }: { html: string }) {
  const body = useRef<HTMLDivElement>(null)
  const ok = supportedHtml(html)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    if (!ok) { el.replaceChildren(); return }
    if (!html.trim()) {
      const p = document.createElement("p")
      p.className = "is-empty"
      p.dataset.placeholder = NOTE_PLACEHOLDER
      el.replaceChildren(p)
      return
    }
    const doc = new DOMParser().parseFromString(html, "text/html")
    doc.querySelectorAll("input").forEach((input) => { input.disabled = true })
    el.replaceChildren(...Array.from(doc.body.childNodes))
  }, [html, ok])
  return (
    <div className="relative" inert aria-busy="true">
      {ok ? <div ref={body} className="note-body" />
        : <p className="min-h-80 text-sm text-muted-foreground">미리 볼 수 없는 형식이에요. 편집기를 불러오는 중이에요.</p>}
      <div aria-hidden className="mt-2 h-4" />
    </div>
  )
}
