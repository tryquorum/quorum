import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { focusDoc, type DocLite } from './context'
import { DocPreview } from './doc-preview'
import { matches } from '@/lib/shortcuts'

/** Finder 의 Quick Look: Space 로 열고 Space·Esc 로 닫아요. 화살표로 앞뒤 문서 */
export function QuickLook({ doc, onClose, onMove }: { doc: DocLite | null; onClose: () => void; onMove: (step: 1 | -1) => void }) {
  return <Dialog open={!!doc} onOpenChange={(open) => { if (!open) onClose() }}>
    {doc && <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"
      // 열자마자 '열기' 버튼에 포커스가 가면 Space 가 문서를 열어 버려요. 창 자체에 두고, 닫으면 고른 문서로 돌려요
      onOpenAutoFocus={(e) => { e.preventDefault(); if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus() }}
      onCloseAutoFocus={(e) => { e.preventDefault(); focusDoc(doc.ref) }}
      onKeyDown={(e) => {
      const typing = e.target instanceof HTMLElement && !!e.target.closest('input,textarea,select,button,a,[contenteditable="true"],[contenteditable=""]')
      if (typing || e.nativeEvent.isComposing) return
      if (matches(e, 'quickLook.close')) { e.preventDefault(); onClose() }
      else if (matches(e, 'quickLook.next')) { e.preventDefault(); onMove(1) }
      else if (matches(e, 'quickLook.prev')) { e.preventDefault(); onMove(-1) }
    }}>
      <DialogTitle className="sr-only">빠른 미리보기: {doc.title}</DialogTitle>
      <DialogDescription className="sr-only">Space 나 Esc 로 닫고, 화살표로 앞뒤 문서를 봐요.</DialogDescription>
      <DocPreview doc={doc} variant="quicklook" />
      <p className="text-2xs text-muted-foreground"><kbd className="num">Space</kbd>·<kbd className="num">Esc</kbd> 닫기 · <kbd className="num">←</kbd><kbd className="num">→</kbd> 앞뒤 문서</p>
    </DialogContent>}
  </Dialog>
}
