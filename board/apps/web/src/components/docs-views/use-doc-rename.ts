import { useRef, useState } from 'react'
import { classifyMetaSaveError, cleanTitle, META_SAVE_MESSAGE, saveTitle, startTitleEdit, titleEditBlock } from '@/lib/meta-save'
import type { DocLite, RenameState } from './context'

export const PENDING_TITLE = '고치던 제목이 남아 있어요. Enter 로 저장하거나 Esc 로 취소한 뒤 다른 문서를 골라 주세요.'
/** 끝나지 않은 제목 편집: 저장 중이거나 오류·충돌로 입력값을 보존하고 있어요 */
export const renamePending = (s: RenameState | null) => !!s && (s.busy || !!s.error || s.conflict)

/**
 * Finder 의 Return = 이름 바꾸기. 시작할 때 version 을 읽고, 확정할 때 그 version 으로 PATCH /meta 를 보내요.
 * 409 면 입력값을 그대로 두고 덮지 않아요. "최신 상태 확인" 으로 지금 서버 제목과 version 을 본 뒤 Enter 로만 다시 저장해요.
 * 입력값은 목록의 제목이 아니라 시작할 때 읽은 서버 제목에서 시작해요(낡은 목록 제목을 새 version 으로 저장하지 않게)
 */
export function useDocRename(onRenamed: (ref: string, title: string) => void, notify: (message: string) => void, onEnd: (ref: string) => void) {
  const [state, setState] = useState<RenameState | null>(null)
  const seq = useRef(0)
  const patch = (ref: string, change: Partial<RenameState>) => setState((cur) => cur && cur.ref === ref ? { ...cur, ...change } : cur)
  const loadVersion = async (ref: string, id: number) => {
    try {
      const meta = await startTitleEdit(ref)
      if (id === seq.current) return meta
    } catch {
      if (id === seq.current) patch(ref, { busy: false, error: '문서 버전을 확인하지 못해 저장할 수 없어요. Esc 로 닫고 다시 시도해 주세요.' })
    }
    return null
  }
  const start = (doc: DocLite) => {
    if (state?.ref === doc.ref) return
    // 충돌·오류·저장 중인 편집이 있으면 새 편집으로 바꾸지 않아요(보존한 입력값과 저장 결과를 잃지 않게)
    if (renamePending(state)) { notify(PENDING_TITLE); return }
    const block = titleEditBlock(doc)
    if (block) { notify(block); return }
    const id = ++seq.current
    setState({ ref: doc.ref, original: doc.title, value: doc.title, version: null, busy: true, error: '', conflict: false })
    void loadVersion(doc.ref, id).then((meta) => {
      if (!meta) return
      patch(doc.ref, { version: meta.version, original: meta.title, value: meta.title, busy: false })
      if (meta.title !== doc.title) onRenamed(doc.ref, meta.title)
    })
  }
  const end = (ref: string) => { seq.current++; setState(null); onEnd(ref) }
  const commit = () => {
    const s = state
    if (!s || s.busy || s.version === null) return
    const next = cleanTitle(s.value)
    if (!next) { patch(s.ref, { error: '제목은 한 줄, 1~200자로 적어 주세요.' }); return }
    if (next === s.original && !s.conflict) { end(s.ref); return }
    const id = ++seq.current
    patch(s.ref, { busy: true, error: '' })
    saveTitle(s.ref, next, s.version).then(() => {
      if (id !== seq.current) return
      onRenamed(s.ref, next); end(s.ref)
    }, (e: unknown) => {
      if (id !== seq.current) return
      const failure = classifyMetaSaveError(e)
      patch(s.ref, { busy: false, conflict: failure.kind === 'conflict', error: failure.kind === 'conflict' ? META_SAVE_MESSAGE.conflict : failure.kind === 'rejected' ? META_SAVE_MESSAGE.rejected(failure.message) : META_SAVE_MESSAGE.unknown })
    })
  }
  /** 충돌 뒤: 입력값은 두고 지금 서버 제목과 version 만 새로 읽어요. 다시 Enter 를 눌러야 저장돼요 */
  const refresh = () => {
    const s = state
    if (!s || s.busy) return
    const id = ++seq.current
    patch(s.ref, { busy: true })
    void loadVersion(s.ref, id).then((meta) => { if (meta) patch(s.ref, { busy: false, version: meta.version, original: meta.title, serverTitle: meta.title, error: '' }) })
  }
  return {
    state,
    start,
    setValue: (value: string) => setState((cur) => cur ? { ...cur, value: value.replace(/\r?\n/g, ' ') } : cur),
    commit,
    // 이미 보낸 저장은 되돌릴 수 없어서, 저장 중에는 Esc 로 닫지 않고 결과를 기다려요
    cancel: () => { if (state && !(state.busy && state.version !== null)) end(state.ref) },
    refresh,
  }
}
