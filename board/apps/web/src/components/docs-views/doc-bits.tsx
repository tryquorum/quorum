import { FileText, MessageSquare, SquareCheckBig, Target, Zap, type LucideIcon } from 'lucide-react'
import { AiMark } from '@/components/ai-mark'
import { cn } from '@/lib/utils'
import { statusLabel } from '@/lib/doc-labels'
import { useDocsView, type DocLite } from './context'
import { composing, matches } from '@/lib/shortcuts'

const ICONS: Record<string, LucideIcon> = { todo: SquareCheckBig, goal: Target, signal: Zap, run: MessageSquare, doc: FileText }
export function KindGlyph({ kind, className }: { kind: string; className?: string }) {
  const Icon = ICONS[kind] ?? FileText
  return <Icon aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} />
}
export function StatusChip({ status, className }: { status: string; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-2xs leading-none', status === 'open' ? 'bg-muted text-foreground' : 'bg-muted/60 text-muted-foreground', status === 'archived' && 'line-through', className)}>{statusLabel(status)}</span>
}
export const isAiDraft = (doc: DocLite) => !!doc.tags?.some((t) => t.tag === 'ai/초안')
export function DraftMark({ doc }: { doc: DocLite }) {
  return isAiDraft(doc) ? <span title="AI 초안" className="inline-flex text-ai"><AiMark className="size-3.5" /><span className="sr-only">AI 초안</span></span> : null
}

/** 문서 제목. 이 문서를 고치는 중이면 그 자리에서 입력칸이 돼요(Enter 저장, Esc 취소) */
export function DocTitle({ doc, className }: { doc: DocLite; className?: string }) {
  const v = useDocsView()
  const r = v.rename
  if (!r || r.ref !== doc.ref) return <span className={className}>{doc.title || '제목 없음'}</span>
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return <span className="block min-w-0 whitespace-normal text-foreground" onClick={stop} onDoubleClick={stop} onPointerDown={stop}>
    <input
      aria-label={`${r.original} 제목 바꾸기`}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      value={r.value}
      readOnly={r.busy}
      aria-busy={r.busy}
      aria-invalid={!!r.error}
      onChange={(e) => v.setRenameValue(e.target.value)}
      // 충돌을 겪은 편집은 포커스 이동으로 저장하지 않고 Enter 로만 저장해요
      onBlur={() => { if (!r.error && !r.busy && !r.conflict) v.commitRename() }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (matches(e, 'field.commit') && !composing(e.nativeEvent)) { e.preventDefault(); v.commitRename() }
        else if (matches(e, 'field.cancel')) { e.preventDefault(); v.cancelRename() }
      }}
      className="w-full min-w-0 rounded-sm border border-foreground/40 bg-background px-1 py-0.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
    {r.busy && <span role="status" className="block text-2xs text-muted-foreground">{r.version === null ? '버전 확인 중…' : '저장 중…'}</span>}
    {r.serverTitle !== undefined && !r.error && <span role="status" className="block text-2xs text-muted-foreground">지금 서버 제목: {r.serverTitle}. Enter 로 저장하면 바꿔요.</span>}
    {r.error && <span role="alert" className="block text-2xs leading-snug text-foreground">{r.error} {r.conflict && <button type="button" className="underline" onMouseDown={(e) => e.preventDefault()} onClick={v.refreshRename}>최신 상태 확인</button>} <button type="button" className="underline" onMouseDown={(e) => e.preventDefault()} onClick={v.cancelRename}>취소</button></span>}
  </span>
}
