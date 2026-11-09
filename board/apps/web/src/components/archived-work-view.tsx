import { useEffect, useRef, useState } from 'react'
import { DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DocLinks } from '@/components/doc-links'
import { Md } from '@/components/md'
import { ApiError } from '@/lib/api'
import { fetchFullDoc, type FetchResult } from '@/lib/docs-api'
import { archivedDrafts, RequestGeneration } from '@/lib/archived-safety'

/** 예전 보관 편집기(Markdown)가 이 브라우저에 남긴 미저장 초안·백업. 원본 HTML 편집 화면에서도 보여 주고 복사한 뒤 직접 지우게 한다 */
export function LegacyArchivedDraft({docRef}:{docRef:string}) {
  const [state,setState] = useState(() => archivedDrafts.restore(docRef))
  const [error,setError] = useState('')
  if (!state || (state.status === 'clean' && !state.backups.length)) return null
  const clear = () => {
    if (!window.confirm('초안을 모두 복사했나요? 이 브라우저에 보관된 예전 초안을 지워요.')) return
    if (archivedDrafts.discard(docRef)) {setState(undefined); setError('')}
    // 지우지 못했으면 초안을 그대로 보여 주고 다시 시도하게 한다 (저장소 항목과 탭 이탈 경고도 남아 있다)
    else setError('저장소에서 예전 초안을 지우지 못했어요. 초안은 그대로 남아 있고 탭 이탈 경고도 유지돼요. 다시 시도해 주세요.')
  }
  return <div className="my-4 rounded-md border p-3 text-sm"><p>예전 보관 편집기에서 저장하지 못한 Markdown 초안이 이 브라우저에 남아 있어요. 필요한 내용을 복사해 본문에 직접 옮긴 뒤 지워 주세요.</p>{state.status !== 'clean' && <textarea readOnly aria-label="보관된 Markdown 초안" value={state.draft} className="mt-2 h-32 w-full border p-2 font-mono text-sm"/>}{state.backups.map((value,i)=><textarea key={i} readOnly aria-label={'보관된 이전 초안 '+(i+1)} value={value} className="mt-2 h-24 w-full border p-2 font-mono text-sm"/>)}<button className="mt-2 underline" onClick={clear}>{error ? '다시 지우기' : '복사한 보관 초안 지우기'}</button>{error && <p role="alert" className="mt-2">{error}</p>}</div>
}

/** The docs API cannot retrieve the original HTML: never replace it from Markdown. */
export function ArchivedWorkView({workRef, mode, onClose, onOpen}: {workRef:string; mode:'page'|'dialog'; onClose:()=>void; onOpen:(ref:string)=>void}) {
  const [doc,setDoc] = useState<FetchResult | null>(null)
  const [error,setError] = useState('')
  const [attempt,setAttempt] = useState(0)
  const generation = useRef(new RequestGeneration())
  useEffect(() => {
    const current = generation.current.start(); setError('')
    void fetchFullDoc(workRef).then((value) => {if (current()) setDoc(value)}).catch((e:unknown) => {if (current()) setError(e instanceof ApiError && e.status === 404 ? '이 일을 찾을 수 없어요.' : e instanceof Error ? e.message : '문서를 불러오지 못했어요.')})
    return () => generation.current.cancel()
  },[workRef,attempt])
  return <div className="h-full overflow-y-auto p-5 md:p-8"><div className="mx-auto max-w-3xl">
    <Button variant="ghost" size="sm" onClick={onClose}>{mode === 'page' ? '뒤로' : '닫기'}</Button>
    {mode === 'dialog' ? <DialogTitle className="mt-3 text-2xl font-semibold">{doc?.title || '보관 문서'}</DialogTitle> : <h1 data-page-title tabIndex={-1} className="mt-3 text-3xl font-semibold">{doc?.title || '보관 문서'}</h1>}
    <p className="my-4 rounded-md border p-3 text-sm">원본 일을 찾을 수 없어 보관된 Markdown만 볼 수 있어요. 원본 HTML을 조회할 수 없어 표와 서식이 손실될 수 있으므로 편집 저장은 지원하지 않아요.</p>
    {error && <p role="alert">{error} <button className="underline" onClick={() => setAttempt(n=>n+1)}>다시 시도</button></p>}
    {!doc && !error && <p role="status">문서를 불러오는 중…</p>}
    <LegacyArchivedDraft docRef={workRef}/>
    {doc && <><p className="mb-3 text-xs text-muted-foreground">버전 {doc.version} · 전체 Markdown</p><Md text={doc.markdown}/><DocLinks key={workRef} docRef={workRef} onOpen={onOpen}/></>}
  </div></div>
}
