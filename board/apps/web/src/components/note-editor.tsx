import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { EditorContent, Extension, useEditor, useEditorState } from "@tiptap/react"
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import Image from "@tiptap/extension-image"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { Node as ProseNode } from "@tiptap/pm/model"
import { toast } from "sonner"
import { ArrowUp, Bold, Code, Heading1, Heading2, ImagePlus, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, MessageSquare, Quote, SquarePlus, Strikethrough } from "lucide-react"
import { AiMark } from "@/components/ai-mark"
import { cn } from "@/lib/utils"
import { ago, api, uploadImage } from "@/lib/api"
import { mdToHtml } from "@/components/md"
import { NoteSaver, noteVersion, type NoteSaveState, type NoteDraft } from "@/lib/note-save"
import { supportedHtml } from "@/lib/note-html"
import { composing, matches } from "@/lib/shortcuts"
import { lastInputWasPointer } from "@/lib/input-modality"
import { NOTE_PLACEHOLDER } from "@/components/note-preview"

export type NoteHandle = { appendMarkdown: (md: string, heading?: string) => boolean; fillMarkdown: (md: string, runId?: string) => boolean; hasDraftRun: (runId: string) => boolean; acceptExternalVersion: (from:number, to:number) => void }
const drafts = new Map<string, NoteSaveState>()
const owners = new Map<string, symbol>()
let volatileDraft = false
if (typeof window !== 'undefined') window.addEventListener('beforeunload', (event) => {
  if (volatileDraft && drafts.size) { event.preventDefault(); event.returnValue = '' }
})
const draftKey = (ref: string) => `db:note-draft:${ref}`
function restore(ref: string): NoteSaveState | undefined {
  if (drafts.has(ref)) return drafts.get(ref)
  try { const raw = sessionStorage.getItem(draftKey(ref)); return raw ? JSON.parse(raw) as NoteSaveState : undefined } catch { return undefined }
}
function persist(ref: string, state: NoteSaveState) {
  const empty = state.status === 'clean' && !state.draftRuns?.length && !state.recoveryDraftRuns?.length && !state.backup && !state.additionalBackups?.length
  if (empty) drafts.delete(ref); else drafts.set(ref, state)
  try { if (empty) sessionStorage.removeItem(draftKey(ref)); else sessionStorage.setItem(draftKey(ref), JSON.stringify(state)); return true } catch { volatileDraft = true; return false }
}
function sourceText(html: string) {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  body.querySelectorAll('script,style').forEach((node) => node.remove())
  body.querySelectorAll('img[alt]').forEach((node) => node.replaceWith(node.getAttribute('alt') || ''))
  body.querySelectorAll('br').forEach((node) => node.replaceWith('\n'))
  body.querySelectorAll('td,th').forEach((node) => node.append(' '))
  body.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,blockquote,pre').forEach((node) => node.append('\n'))
  return (body.textContent || '').trim()
}
/** "AI에게 묻기" 입력칸에 커서가 가도 고른 부분이 칠해져 보이게 하는 표시 (meta: {from,to} 로 켜고 null 로 끈다) */
const askMarkKey = new PluginKey<DecorationSet>("askMark")
const AskMark = Extension.create({
  name: "askMark",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: askMarkKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const meta = tr.getMeta(askMarkKey) as { from: number; to: number } | null | undefined
          if (meta === null) return DecorationSet.empty
          if (meta) return DecorationSet.create(tr.doc, [Decoration.inline(meta.from, meta.to, { class: "ask-mark" })])
          return set.map(tr.mapping, tr.doc)
        },
      },
      props: { decorations: (state) => askMarkKey.getState(state) },
    })]
  },
})

/** 본문의 [[링크]]를 옵시디언처럼 눌러서 이동할 수 있게 표시한다 */
const wikiKey = new PluginKey<DecorationSet>("wikiLink")
const wikiDecorations = (doc: ProseNode) => {
  const marks: Decoration[] = []
  doc.descendants((node, pos) => {
    // 서버 관계 해석처럼 코드 블록과 인라인 코드 안의 [[ ]] 는 링크가 아니다
    if (node.type.name === "codeBlock") return false
    if (!node.isText || !node.text || node.marks.some((mark) => mark.type.name === "code")) return
    for (const m of node.text.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
      const term = m[1].trim()
      const from = pos + (m.index ?? 0)
      if (term) marks.push(Decoration.inline(from, from + m[0].length, { class: "wiki-link", "data-wiki": term, title: `${term} 문서로 이동` }))
    }
  })
  return DecorationSet.create(doc, marks)
}
const WikiLink = Extension.create({
  name: "wikiLink",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: wikiKey,
      state: { init: (_, state) => wikiDecorations(state.doc), apply: (tr, set) => (tr.docChanged ? wikiDecorations(tr.doc) : set) },
      props: { decorations: (state) => wikiKey.getState(state) },
    })]
  },
})

/** 편집기가 다루지 못하는 원본(표 등)을 읽기 전용으로 보여 준다. 스크립트는 막고(sandbox 에 allow-scripts 없음) 높이만 맞춘다 */
const previewCss = "body{margin:0;font:15px/1.7 system-ui,-apple-system,sans-serif;color:#0a0a0a;overflow-wrap:anywhere}table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #e5e5e5;padding:6px 10px;text-align:left}th{background:#fafafa;font-weight:600}img{max-width:100%}a{color:inherit}"
function OriginalPreview({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const fit = () => { const doc = frame.current?.contentDocument; if (frame.current && doc?.body) frame.current.style.height = `${doc.documentElement.scrollHeight + 4}px` }
  return <iframe ref={frame} title="노트 원본 미리보기" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>${previewCss}</style>${html}`} onLoad={fit} className="block min-h-24 w-full border-0" />
}


const imagesOf = (list?: FileList | null) => Array.from(list || []).filter((f) => f.type.startsWith("image/"))
/** 이미지 파일을 올리고 노트에 넣는다 (붙여넣기, 끌어다 놓기, 이미지 버튼) */
async function insertImages(view: EditorView, files: File[], pos?: number) {
  for (const f of files) {
    try {
      const src = await uploadImage(f)
      const node = view.state.schema.nodes.image.create({ src, alt: f.name })
      const tr = pos != null ? view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node) : view.state.tr.replaceSelectionWith(node)
      view.dispatch(tr.scrollIntoView())
    } catch (e) {
      toast("이미지를 올리지 못했어요", { description: String((e as Error).message) })
    }
  }
}

/** 일의 요약 노트. 노션처럼 바로 고치고, 0.6초 뒤 자동 저장 */
export const NoteEditor = forwardRef<NoteHandle, {
  workRef: string; initialHtml: string; initialVersion?: number | null; updatedAt: number | null; noteSource?: 'work'|'docs'; coordinateWrite?: (body:NoteDraft & {expectedVersion?:number})=>Promise<{version?:number;updated_at:number}>; onAdopt?:()=>void; onSaved?: () => void; onReady?: () => void; onDraftSaved?: (runId: string) => Promise<void>; drafting?: { steps: { tool: string; arg: string }[] } | null
  /** 고른 부분으로 새 일 만들기 (고른 글, 노트 전체 글) */
  onMakeWork?: (selected: string, noteText: string) => void
  /** 고른 부분을 인용해서 AI에게 묻기 (고른 글, 질문. 질문이 비면 설명해 달라고 한다) */
  onAsk?: (selected: string, question: string) => void
  /** 본문의 [[링크]]를 눌렀을 때 (문서 페이지에서만 넘긴다. Shift+클릭은 그냥 커서를 둔다) */
  onWikiLink?: (term: string) => void
}>(
  function NoteEditor({ workRef, initialHtml, initialVersion, updatedAt, noteSource='work', coordinateWrite, onAdopt, onSaved, onReady, onDraftSaved, drafting, onMakeWork, onAsk, onWikiLink }, ref) {
    const [flash, setFlash] = useState(false)
    const restored = useRef(restore(workRef))
    const [saved, setSaved] = useState<NoteSaveState>(() => new NoteSaver(initialVersion, async () => ({updated_at:0}), () => {}, restored.current).state)
    const [storageError, setStorageError] = useState(false)
    const alive = useRef(true)
    const pendingRun = useRef<string | undefined>(undefined)
    const acknowledging = useRef(new Set<string>())
    const saver = useRef<NoteSaver | null>(null)
    const owner = useRef(Symbol(workRef))
    const acknowledgeSaved = (state: NoteSaveState) => {
      if (state.status !== 'clean' || !onDraftSaved) return
      for (const runId of state.draftRuns || []) {
        if (acknowledging.current.has(runId)) continue
        acknowledging.current.add(runId)
        void onDraftSaved(runId).then(() => saver.current?.clearDraftRun(runId)).catch(() => toast('초안 적용 확인을 보내지 못했어요. 다시 넣지 말고 나중에 확인해 주세요.')).finally(() => acknowledging.current.delete(runId))
      }
    }
    if (!saver.current) { owners.set(workRef, owner.current); saver.current = new NoteSaver(initialVersion, (body) => coordinateWrite ? coordinateWrite(body) : api(`/api/${noteSource}/${encodeURIComponent(workRef)}/note`, {method:'PUT', body:JSON.stringify(body)}), (state) => {
      if (owners.get(workRef) !== owner.current) return
      const stored = persist(workRef, state)
      if (alive.current) {setSaved(state); setStorageError(!stored)}
      if (state.status === 'clean') {
        onSaved?.()
        if (stored) acknowledgeSaved(state)
      }
    }, restored.current) }
    const unsafeOriginal = useRef(!supportedHtml(restored.current?.draft?.html ?? initialHtml))
    const [sourceMode, setSourceMode] = useState(false)
    const [sourceHtml, setSourceHtml] = useState(restored.current?.draft?.html ?? initialHtml)
    const [currentNote, setCurrentNote] = useState<{html:string; text:string; version:number | null} | null>(null)
    const [loadingCurrent, setLoadingCurrent] = useState(false)
    const [currentError, setCurrentError] = useState('')
    const [copiedDraft, setCopiedDraft] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const fileInput = useRef<HTMLInputElement>(null)
    // "AI에게 묻기"를 누르면 화면을 옮기지 않고 떠 있는 메뉴가 질문 입력칸으로 바뀐다. 고른 글은 누른 순간 잡아 둔다
    const [ask, setAsk] = useState<string | null>(null)
    const [question, setQuestion] = useState("")
    const markRef = useRef<((range: { from: number; to: number } | null) => void) | null>(null)
    const bubbleOptions = useMemo(() => ({ onHide: () => { setAsk(null); setQuestion(""); markRef.current?.(null) } }), [])

    const flush = () => saver.current?.flush()
    const reloadCurrent = async () => {
      setLoadingCurrent(true); setCurrentError(''); setCurrentNote(null); setCopiedDraft(false)
      try {
        if (noteSource === 'docs') {
          const result = await api<{html:string;version:number}>(`/api/docs/${encodeURIComponent(workRef)}/note`)
          if (!Number.isSafeInteger(result.version) || result.version < 1) throw new Error('missing version')
          setCurrentNote({html:result.html,text:sourceText(result.html),version:result.version})
          return
        }
        const result = await api<{noteVersioning?:boolean; note:{html:string; text:string; version?:number} | null}>(`/api/work/${encodeURIComponent(workRef)}`)
        const version = noteVersion(result.noteVersioning, result.note)
        setCurrentNote({html:result.note?.html || '', text:result.note?.text || '', version:typeof version === 'number' ? version : null})
      } catch { setCurrentError('현재 노트를 불러오지 못했어요. 다시 시도해 주세요.') }
      finally { setLoadingCurrent(false) }
    }

    const editor = useEditor({
      extensions: [
        StarterKit.configure({ link: { openOnClick: false, autolink: true }, heading: { levels: [1, 2, 3, 4, 5, 6] } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Image.configure({ allowBase64: false }),
        AskMark,
        ...(onWikiLink ? [WikiLink] : []),
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === "heading" ? "제목" : NOTE_PLACEHOLDER),
        }),
      ],
      content: restored.current?.draft?.html || initialHtml || "",
      editable: !unsafeOriginal.current,
      editorProps: {
        attributes: { class: "note-body", "aria-label": "요약 노트", spellcheck: "false" },
        // 키보드로 들어왔을 때만 본문 둘레 외곽선(index.css). 포인터·터치로 누르면 깜박이는 커서만 보여요
        handleDOMEvents: {
          focus: (view) => { view.dom.setAttribute("data-focus-via", lastInputWasPointer() ? "pointer" : "keyboard"); return false },
          blur: (view) => { view.dom.removeAttribute("data-focus-via"); return false },
        },
        handleClick: (_view, _pos, event) => {
          const link = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-wiki]")
          if (!link || !onWikiLink || event.shiftKey) return false
          event.preventDefault()
          onWikiLink(link.dataset.wiki || "")
          return true
        },
        handlePaste: (view, event) => {
          const html = event.clipboardData?.getData('text/html')
          if (html && !supportedHtml(html)) { event.preventDefault(); toast('지원하지 않는 붙여넣기 형식이에요. 원본을 다른 곳에 보관해 주세요.'); return true }
          const files = imagesOf(event.clipboardData?.files)
          if (!files.length) return false
          event.preventDefault()
          insertImages(view, files)
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          const html = event.dataTransfer?.getData('text/html')
          if (!moved && html && !supportedHtml(html)) { event.preventDefault(); toast('지원하지 않는 끌어놓기 형식이에요.'); return true }
          const files = moved ? [] : imagesOf(event.dataTransfer?.files)
          if (!files.length) return false
          event.preventDefault()
          insertImages(view, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
          return true
        },
      },
      onUpdate: ({ editor }) => {
        saver.current?.edit({ html: editor.getHTML(), text: editor.getText({ blockSeparator: "\n" }) }, pendingRun.current)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { void flush() }, 600)
      },
    })

    useEffect(() => { if (editor) onReady?.() }, [editor, onReady])
    useEffect(() => { const state = saver.current?.state; if (state?.status === 'clean' && persist(workRef, state)) acknowledgeSaved(state) }, [])

    useEffect(() => {
      alive.current = true
      const before = (e: BeforeUnloadEvent) => { if (saver.current?.state.status !== 'clean') {e.preventDefault(); e.returnValue = ''} }
      window.addEventListener('beforeunload', before)
      return () => { alive.current = false; window.removeEventListener('beforeunload', before); if (timer.current) clearTimeout(timer.current); void flush() }
    }, [])

    useImperativeHandle(ref, () => ({
      acceptExternalVersion(from, to) {saver.current?.acceptExternalVersion(from, to)},
      appendMarkdown(md, heading) {
        if (!editor || unsafeOriginal.current) return false
        const html = (heading ? `<h3>${heading.replace(/</g, "&lt;")}</h3>` : "") + mdToHtml(md)
        if (!supportedHtml(html)) { toast('지원하지 않는 내용이 있어 넣지 않았어요. 원문을 복사해 보관해 주세요.'); return false }
        return editor.chain().focus("end").insertContent(html).run()
      },
      // AI 초안: 노트가 비었으면 그대로 채우고, 아니면 아래에 붙인다
      hasDraftRun(runId) { return !!saver.current?.hasDraftRun(runId) },
      fillMarkdown(md, runId) {
        if (!editor || unsafeOriginal.current || (runId && saver.current?.hasDraftRun(runId))) return false
        const html = mdToHtml(md)
        if (!supportedHtml(html)) { toast('지원하지 않는 AI 초안 형식이에요. 원문을 보관해 주세요.'); return false }
        pendingRun.current = runId
        const applied = editor.isEmpty ? editor.commands.setContent(html, { emitUpdate: true }) : editor.chain().focus("end").insertContent("<hr>" + html).run()
        pendingRun.current = undefined
        if (!applied) return false
        setFlash(true)
        setTimeout(() => setFlash(false), 900)
        return true
      },
    }), [editor])

    const st = useEditorState({
      editor,
      selector: ({ editor: e }) => e ? {
        bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"), code: e.isActive("code"),
        h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), link: e.isActive("link"),
        bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), task: e.isActive("taskList"),
      } : null,
    })

    if (!editor) return null
    const mark = (range: { from: number; to: number } | null) => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(askMarkKey, range).setMeta("addToHistory", false))
    }
    markRef.current = mark
    const closeAsk = () => { setAsk(null); setQuestion(""); mark(null) }
    const B = ({ on, onClick, label, children }: { on?: boolean; onClick: () => void; label: string; children: React.ReactNode }) => (
      <button type="button" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
        className={cn("grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4", on && "bg-muted text-foreground")}>
        {children}
      </button>
    )
    const setLink = () => {
      const prev = editor.getAttributes("link").href as string | undefined
      const url = window.prompt("링크 주소", prev || "https://")
      if (url === null) return
      if (!url || url === "https://") editor.chain().focus().unsetLink().run()
      else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
    }
    const selected = () => {
      const { from, to } = editor.state.selection
      return editor.state.doc.textBetween(from, to, "\n").trim()
    }
    const A = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5">
        {children}
      </button>
    )
    const ai = !!(onMakeWork || onAsk)
    const adoptCurrent = () => {
      if (!currentNote || currentNote.version === null || !copiedDraft) return
      const unknown = saved.status === 'unknown'
      if (!window.confirm('편집기를 불러온 서버 내용으로 바꿔요. 내 초안은 따로 보관하고 자동으로 합치지 않아요. 계속할까요?')) return
      const current = {html:currentNote.html, text:currentNote.text}
      const adopted = unknown ? saver.current?.adoptUnknownCurrent(currentNote.version, current) : saver.current?.loadConflictCurrent(currentNote.version, current)
      if (!adopted) {setCurrentError('안전하게 전환할 수 없어요. 보관된 초안과 서버 상태를 다시 확인해 주세요.'); return}
      onAdopt?.()
      unsafeOriginal.current = !supportedHtml(currentNote.html)
      setSourceHtml(currentNote.html); setSourceMode(false)
      editor.commands.setContent(currentNote.html, {emitUpdate:false})
      editor.setEditable(!unsafeOriginal.current, false)
      setCurrentNote(null); setCopiedDraft(false)
    }

    return (
      <div className="relative">
        {!saved.protected && <p role="status" className="mb-3 rounded-md border p-2 text-xs">충돌 보호 꺼짐 · 이전 서버에서는 다른 곳의 변경을 덮어쓸 수 있어요.</p>}
        {unsafeOriginal.current && <div className="mb-3 rounded-md border p-3 text-sm"><p>표처럼 이 편집기가 못 다루는 형식이 있어 원본 HTML 을 그대로 둬요.</p>{!sourceMode && <button className="mt-2 underline" onClick={() => setSourceMode(true)}>HTML 원본 편집</button>}{sourceMode && <p className="mt-2 text-xs">HTML을 직접 수정하면 원본 그대로 저장하고 서버에서 마크다운으로 변환해요.</p>}</div>}
        {storageError && <p role="alert" className="mb-2 text-sm">브라우저에 초안을 보관하지 못했어요. 페이지를 닫기 전에 내용을 복사해 주세요.</p>}
        {(saved.status === 'conflict' || saved.status === 'unknown' || saved.status === 'error' || saved.status === 'review') && <div role="alert" className="mb-3 rounded-md border p-3 text-sm"><p>{saved.message}</p><p>내 기준 버전: {saved.version ?? '확인할 수 없음'}</p>{saved.current && <><p>충돌 당시 서버 버전 {saved.current.version}{saved.current.truncated ? ' · 일부만 표시' : ''}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{saved.current.md}</pre></>}
          {saved.draft && <div><p>보존된 내 초안 HTML (직접 복사)</p><textarea readOnly aria-label="보존된 내 초안 HTML" value={saved.draft.html} className="h-24 w-full border p-2 font-mono text-xs" /></div>}
          {saved.status === 'error' && <button className="mr-3 underline" onClick={() => {saver.current?.retryError(); void flush()}}>수정한 초안 다시 저장</button>}
          {(saved.status === 'conflict' || saved.status === 'unknown') && <><button disabled={loadingCurrent} className="mr-3 underline" onClick={() => void reloadCurrent()}>현재 노트 새로 불러오기</button>{saved.status === 'unknown' && <p>이전 요청이 늦게 완료될 수 있어 자동 재전송하지 않아요. 버전 보호가 있으면 현재 노트를 채택한 후 편집할 수 있으며, 이전 요청이 먼저 끝나면 다음 저장은 충돌로 멈춰요. 이전 요청에 버전 보호가 없었다면 늦은 덮어쓰기를 막을 수 없어 여기서 저장을 재개할 수 없어요.</p>}</>}
          {currentError && <p>{currentError}</p>}
          {currentNote && <><p>불러온 현재 서버 버전: {currentNote.version ?? '확인할 수 없음'}</p><textarea readOnly aria-label="불러온 현재 노트 HTML" value={currentNote.html} className="h-24 w-full border p-2 font-mono text-xs" /><p>두 내용을 비교해 주세요. 현재 노트를 채택하면 편집기가 서버 내용으로 바뀌고, 내 초안은 따로 보관해요. 필요한 내용을 직접 합쳐 주세요.</p><label className="my-2 flex items-center gap-2"><input type="checkbox" checked={copiedDraft} onChange={(e) => setCopiedDraft(e.target.checked)} />내 초안을 별도 장소에 복사했어요</label><button className="underline" disabled={!copiedDraft || currentNote.version === null || (saved.status === 'unknown' && (!saved.unknownProtected || !saved.protected))} onClick={adoptCurrent}>현재 서버 노트 채택 후 직접 합치기</button></>}
        </div>}
        {saved.backup && <div className="mb-3 rounded-md border p-3 text-sm"><p>전환 전 내 초안을 보관하고 있어요.</p><textarea readOnly aria-label="전환 전 내 초안 HTML" value={saved.backup.html} className="h-24 w-full border p-2 font-mono text-xs" /><button className="underline" onClick={() => {if (window.confirm('보관된 초안을 지울까요? 먼저 필요한 내용을 복사해 주세요.')) saver.current?.clearBackup()}}>보관 초안 지우기</button></div>}
        {saved.additionalBackups?.map((backup, index) => <div key={index} className="mb-3 rounded-md border p-3 text-sm"><p>추가로 보관한 병합 초안 {index + 1}</p><textarea readOnly aria-label={`추가로 보관한 병합 초안 ${index + 1} HTML`} value={backup.html} className="h-24 w-full border p-2 font-mono text-xs" /><button className="underline" onClick={() => {if (window.confirm('이 보관 초안을 지울까요? 먼저 필요한 내용을 복사해 주세요.')) saver.current?.clearAdditionalBackup(index)}}>이 보관 초안 지우기</button></div>)}
        {saved.status === 'merging' && <div role="status" className="mb-3 rounded-md border p-3 text-sm"><p>서버 노트와 보관한 초안을 직접 비교해 합쳐 주세요. 자동 저장은 중단되어 있어요.</p>{(saved.recoveryDraftRuns || []).map((runId) => <fieldset key={runId} className="mt-2"><legend>AI 초안 {runId}의 포함 여부</legend><label className="mr-3"><input type="radio" name={`merge-run-${runId}`} checked={saved.recoveryRunChoices?.[runId] === 'included'} onChange={() => saver.current?.chooseRecoveryRun(runId, 'included')} /> 병합 내용에 포함했어요</label><label><input type="radio" name={`merge-run-${runId}`} checked={saved.recoveryRunChoices?.[runId] === 'excluded'} onChange={() => saver.current?.chooseRecoveryRun(runId, 'excluded')} /> 포함하지 않았어요</label></fieldset>)}<p className="mt-2 text-xs">포함한 AI 초안은 노트 저장을 확인한 뒤 적용한 것으로 처리해요. 포함하지 않은 초안은 다시 넣을 수 있어요.</p><button className="mt-2 underline disabled:opacity-50" disabled={(saved.recoveryDraftRuns || []).some((id) => !saved.recoveryRunChoices?.[id])} onClick={() => {if (window.confirm(`서버 버전 ${saved.version}의 내용과 내 초안을 합친 결과를 저장할까요? 서버가 다시 바뀌었다면 충돌로 멈춰요.`)) void saver.current?.saveMerged()}}>병합한 노트 저장</button></div>}
        {!unsafeOriginal.current && <BubbleMenu editor={editor} options={bubbleOptions} className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
          {ask !== null ? (
            <div className="flex w-[min(440px,80vw)] items-center gap-1">
              <span className="flex items-center pr-0.5 pl-1.5 text-ai" aria-hidden><AiMark className="size-3.5" /></span>
              <input
                autoFocus
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches(e, "editor.ask") && !composing(e.nativeEvent)) {
                    e.preventDefault()
                    onAsk?.(ask, question.trim())
                    closeAsk()
                  } else if (e.key === "Escape" && matches(e, "editor.ask")) {
                    e.preventDefault()
                    e.stopPropagation()
                    closeAsk()
                    editor.commands.focus()
                  }
                }}
                aria-label="고른 부분에 대해 AI에게 물어보기"
                placeholder="고른 부분에 대해 물어봐요 (비워두면 설명해 줘요)"
                className="h-7 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button type="button" aria-label="보내기" title="보내기 (Enter)" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onAsk?.(ask, question.trim()); closeAsk() }}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-background [&_svg]:size-3.5">
                <ArrowUp />
              </button>
            </div>
          ) : <>
          {ai && (
            <>
              <span className="flex items-center pr-0.5 pl-1.5 text-ai" aria-hidden><AiMark className="size-3.5" /></span>
              {onMakeWork && <A onClick={() => { const t = selected(); if (t) onMakeWork(t, editor.getText({ blockSeparator: "\n" })) }}><SquarePlus />새 일로 만들기</A>}
              {onAsk && <A onClick={() => { const t = selected(); if (t) { const { from, to } = editor.state.selection; mark({ from, to }); setQuestion(""); setAsk(t) } }}><MessageSquare />AI에게 묻기</A>}
              <span className="mx-0.5 h-4 w-px bg-border" />
            </>
          )}
          <B label="굵게" on={st?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></B>
          <B label="기울임" on={st?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></B>
          <B label="취소선" on={st?.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></B>
          <B label="코드" on={st?.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code /></B>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <B label="큰 제목" on={st?.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></B>
          <B label="제목" on={st?.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></B>
          <B label="링크" on={st?.link} onClick={setLink}><LinkIcon /></B>
          </>}
        </BubbleMenu>}
        {!unsafeOriginal.current && <FloatingMenu editor={editor} className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-sm">
          <B label="제목" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></B>
          <B label="목록" on={st?.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></B>
          <B label="번호 목록" on={st?.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></B>
          <B label="체크리스트" on={st?.task} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks /></B>
          <B label="인용" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></B>
          <B label="이미지" onClick={() => fileInput.current?.click()}><ImagePlus /></B>
        </FloatingMenu>}
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => {
          const files = imagesOf(e.target.files)
          if (files.length) insertImages(editor.view, files)
          e.target.value = ""
        }} />
        {drafting && (
          <div className="mb-4 flex flex-col gap-2.5 rounded-xl border border-dashed p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              AI가 초안 쓰는 중{drafting.steps.length ? ` · ${drafting.steps[drafting.steps.length - 1].tool === "memory_search" ? "기억 찾는 중" : drafting.steps[drafting.steps.length - 1].tool === "read_file" ? "자료 읽는 중" : "자료 모으는 중"}` : ""}
            </div>
            {[92, 78, 85, 60].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}
          </div>
        )}
        {unsafeOriginal.current ? !sourceMode ? <OriginalPreview html={sourceHtml} /> : <textarea aria-label="노트 HTML 원본 편집" value={sourceHtml} onChange={(event) => {const html = event.target.value; setSourceHtml(html); saver.current?.edit({html, text:sourceText(html)}); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => {void flush()}, 600)}} className="min-h-64 w-full rounded-md border p-3 font-mono text-sm" /> : <div className={cn("transition-opacity duration-700", flash && "animate-in fade-in")}>
          <EditorContent editor={editor} />
        </div>}
        <div role="status" aria-live="polite" className="pointer-events-none mt-2 text-right text-2xs text-muted-foreground">
          {saved.status === "saving" ? "저장 중이에요" : saved.status === "dirty" ? "저장 대기 중" : saved.status === "conflict" || saved.status === "unknown" || saved.status === "review" || saved.status === "merging" || saved.status === "error" ? "자동 저장 중단" : saved.updatedAt ? `저장했어요 · ${ago(saved.updatedAt)}` : updatedAt ? `저장했어요 · ${ago(updatedAt)}` : "자동으로 저장해요"}
        </div>
      </div>
    )
  },
)
