// 문서 페이지 머리: 브레드크럼(문서 / 조상… / 지금)과 ⋯ 메뉴(하위 문서 만들기·이동·맨 위로). 계층은 독립 문서만이에요.
import { Fragment } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useDocCreate } from "@/components/doc-create"
import { useDocMove } from "@/components/doc-move"
import { useShortcut } from "@/components/shortcut-dispatch"
import { crumbs } from "@/lib/doc-tree"
import { moveDoc } from "@/lib/docs-api"
import { toast } from "sonner"

type Anc = { ref: string; title: string }

export function DocCrumbs({ ancestors, title, onBack, onOpen }: { ancestors: Anc[]; title: string; onBack: () => void; onOpen: (ref: string) => void }) {
  const sep = <span aria-hidden className="text-muted-foreground">/</span>
  return (
    <nav aria-label="문서 위치" className="flex min-w-0 flex-1 items-center gap-1.5">
      <button type="button" onClick={onBack} className="shrink-0 text-muted-foreground hover:text-foreground">문서</button>
      {crumbs(ancestors, 3).map((c, i) => (
        <Fragment key={"gap" in c ? "gap" + i : c.ref}>
          {sep}
          {"gap" in c ? <span className="text-muted-foreground" title={ancestors.slice(1, -2).map((a) => a.title).join(" / ")}>…</span>
            : <button type="button" onClick={() => onOpen(c.ref)} className="max-w-[10rem] truncate text-muted-foreground hover:text-foreground">{c.title || "제목 없음"}</button>}
        </Fragment>
      ))}
      {sep}
      <span className="min-w-0 flex-1 truncate" aria-current="page">{title}</span>
    </nav>
  )
}

/** 독립 문서의 ⋯ 메뉴와 m 키. 그 밖의 문서(일·사건 노트)는 메뉴를 쓰지 않아요 */
export function DocPageMenu({ docRef, title, parent, area }: { docRef: string; title: string; parent: string | null; area: string | null }) {
  const { open } = useDocCreate()
  const { openMove } = useDocMove()
  const standalone = docRef.startsWith("doc:")
  useShortcut("docs.moveTo", () => { if (!standalone) return false; openMove({ ref: docRef, title, parent }) }, standalone)
  if (!standalone) return <Button variant="ghost" size="icon-sm" aria-label="더보기 지원하지 않음" title="추가 메뉴는 독립 문서에서만 써요" disabled><MoreHorizontal /></Button>
  const toRoot = async () => {
    try { await moveDoc({ ref: docRef, parent: null }); toast("맨 위로 옮겼어요", { description: title }) }
    catch { toast("옮기지 못했어요", { description: title }) }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="문서 메뉴" title="문서 메뉴"><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => open({ parent: { ref: docRef, title }, area, links: [{ ref: docRef, title }], linksOn: false })}>하위 문서 만들기<DropdownMenuShortcut>N</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openMove({ ref: docRef, title, parent })}>이동…<DropdownMenuShortcut>M</DropdownMenuShortcut></DropdownMenuItem>
        {parent && <DropdownMenuItem onSelect={() => void toRoot()}>맨 위로</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
