// 빠른 추가: 어느 화면에서나 같은 입구. 한 줄(QuickAddBar) Enter 는 바로 할 일, [+]·머리글 +·n 은 상세 시트.
// ✦(한 줄 ⌘⏎, 시트 ⌘⇧⏎)는 AI에게 맡긴다: 같은 일을 찾고 확인하고 다듬어서 올리고, 결과는 한 줄 아래(없으면 화면 위 오른쪽)에 뜬다.
import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { discardBothNote, draftAfterDoneNote, planDiscardBoth, runDiscardBoth } from "@/lib/quick-discard"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { CalendarClock, CircleAlert, Hash, Plus } from "lucide-react"
import { normTitle } from "@direction-board/contracts"
import { AiMark } from "@/components/ai-mark"
import { CaptureTray } from "@/components/capture-tray"
import { Button } from "@/components/ui/button"
import { QuickAddSheet } from "@/components/quick-add-sheet"
import { useShortcut } from "@/components/shortcut-dispatch"
import { useCaptures, type CapturePage, type Captures } from "@/hooks/use-captures"
import { api, W, type Board, type Item, type Run, type Signal } from "@/lib/api"
import type { SpaceId } from "@direction-board/contracts"
import { boardForSpace } from "@/lib/spaces"
import { activeSame, captureHints, hiddenFailures, lastFinishedRun, visibleEntries, type CaptureEntry } from "@/lib/capture"
import { assertNever, findSameOpen, parseQuick, type Draft, type Parsed } from "@/lib/quick-add"
import { aiAllowed, EDIT_READ_FAILED_TEXT, inputLocked, inputReady, LOADING_TEXT, retryLabel, SAVE_FAILED, slotFor, stallText, stepFailureText, type Done, type Pending, type QuickEdit, type Submitted } from "@direction-board/contracts/quick-recovery"
import { confirmDiscard, submitQuick, useQuickEdit, useQuickSlot, type QuickEditSlot, type QuickSlot } from "@/lib/quick-slot"
import type { WebPlan } from "@/lib/store-plan"
import { CHANGED_TEXT, type PlanResult } from "@direction-board/contracts/slot-store"
import { composing, matches } from "@/lib/shortcuts"
import { useStall } from "@/lib/stall"
import { cn } from "@/lib/utils"

/** space: 새 일의 기본 공간(보고 있는 공간, 모든 공간이면 개인) */
export type QuickAddEnv = { boards: Board[]; boardId: string | undefined; items: Item[]; signals?: Signal[]; onHidden?: (hidden: ReadonlySet<string>) => void; save: (it: Item) => Promise<boolean>; onOpenWork: (ref: string) => void; page?: CapturePage; space?: SpaceId; saveKnown?: (it: Item, opts?: { expectUser?: string }) => Promise<boolean | "unknown" | "scope">; scope?: string | null; boardsReady?: boolean; retry?: () => void }
/** saveKnown: 저장됨·확실한 거절·결과 불명을 나누는 저장(빠른 추가가 써요). scope: 서버 주소 + 로그인 주체(복구 기록의 범위, 모르면 null — 새 제출을 막아요) */
/** draft 가 있으면 그 초안 전체(제목·노트·날짜·영역·태그·속성)로 시트를 연다(AI 정리 실패 뒤 직접 추가) */
export type QuickAddApi = { open: (prefill?: string, returnTo?: HTMLElement | null, onCreated?: () => void, draft?: Draft | null) => void }

const Ctx = createContext<(QuickAddApi & { env: QuickAddEnv; captures: Captures; hidden: ReadonlySet<string>; setSlot: (el: HTMLElement | null) => void }) | null>(null)
export function useQuickAdd() {
  const c = useContext(Ctx)
  if (!c) throw new Error("QuickAddProvider 밖에서 썼어요")
  return c
}

/** 다 만든 결과 알림(done 만 — 그 밖은 lib/quick-add-outcome.ts settle 이 기록으로 남겨요). "열기" 로 잇는다 */
export function reportCreated(r: Done, title: string, onOpenWork: (ref: string) => void) {
  const action = { label: "열기", onClick: () => onOpenWork(r.ref) }
  toast(r.existed ? "앞에서 보낸 할 일이 이미 저장돼 있어요" : "추가했어요", { description: title, action })
}

/** 한 줄에서 알아본 날짜·영역·태그 칩 */
export function ParsedChips({ parsed, className }: { parsed: Parsed | null; className?: string }) {
  if (!parsed || (!parsed.at && !parsed.area && !parsed.tags.length)) return null
  const chip = "inline-flex h-6 items-center gap-1 rounded-md bg-muted px-2 text-xs text-foreground"
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="알아본 것">
      {parsed.at && <span className={chip}><CalendarClock className="size-3 text-muted-foreground" /><span className="num">{W.long(parsed.at)}</span></span>}
      {parsed.area && <span className={chip}><span className="size-2 rounded-full" style={{ background: parsed.area.color }} />{parsed.area.name}</span>}
      {parsed.tags.map((t) => <span key={t} className={chip}><Hash className="size-3 text-muted-foreground" />{t}</span>)}
    </div>
  )
}

/** 같은 제목의 열린 일이 있을 때 한 줄 경고 */
export function SameWarning({ same, onOpen, confirmed }: { same: Item; onOpen: (ref: string) => void; confirmed: boolean }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <CircleAlert className="size-3.5" />
      <span>같은 일이 열려 있어요</span>
      <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => onOpen(`item:${same.boardId}:${same.id}`)}>열기</button>
      {confirmed && <span>· 한 번 더 누르면 추가해요</span>}
    </p>
  )
}

export function QuickAddProvider({ children, handle, ...env }: QuickAddEnv & { children: ReactNode; handle?: RefObject<QuickAddApi | null> }) {
  // scope: 시트를 연 범위(리뷰 19). 범위가 바뀌어 다시 그린 시트에는 연 쪽의 글·초안·onCreated 를 넘기지 않아요(그 글은 연 범위의 초안에 남아요)
  const [sheet, setSheet] = useState<{ open: boolean; prefill: string; key: number; draft: Draft | null; scope: string | null }>({ open: false, prefill: "", key: 0, draft: null, scope: null })
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const captures = useCaptures(env.page)
  // 트레이에 보이는 AI 정리 실패는 홈 결정 칸과 사이드바 "홈" 숫자에서 모두 빼요(같은 실패를 두 곳에 띄우지 않기)
  const shownFailed = visibleEntries(captures.entries, captures.expanded).map((e) => ({ run: captures.views[e.id]?.run })).filter((x) => x.run?.status === "error")
  const failedKey = shownFailed.map((x) => x.run?.id).join(",")
  const [lastByRun, setLastByRun] = useState<Record<string, string | null>>({})
  useEffect(() => {
    for (const { run } of shownFailed) {
      if (!run || run.id in lastByRun) continue
      const thread = run.thread || run.id
      api<{ runs: Run[] }>(`/api/runs?thread=${encodeURIComponent(thread)}`).then((r) => setLastByRun((m) => ({ ...m, [run.id]: lastFinishedRun(r.runs) })), () => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 보이는 실패 실행이 바뀔 때만 묻는다
  }, [failedKey])
  const lastFinished = Object.fromEntries(shownFailed.flatMap(({ run }) => (run ? [[run.thread || run.id, lastByRun[run.id]]] : [])))
  const hidden = useMemo(() => hiddenFailures(env.signals ?? [], shownFailed, lastFinished), [env.signals, failedKey, lastByRun])
  useEffect(() => { env.onHidden?.(hidden) }, [env.onHidden, hidden])
  const returnTo = useRef<HTMLElement | null>(null)
  const created = useRef<(() => void) | null>(null)
  const scopeNow = useRef(env.scope ?? null)
  scopeNow.current = env.scope ?? null
  const open = useCallback<QuickAddApi["open"]>((prefill = "", from, onCreated, draft = null) => {
    returnTo.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    created.current = onCreated ?? null
    setSheet((s) => ({ open: true, prefill, key: s.key + 1, draft, scope: scopeNow.current }))
  }, [])
  useImperativeHandle(handle, () => ({ open }), [open])
  const sheetScope = env.scope ?? null
  const sameSheetScope = sheet.scope === sheetScope
  // 입력 중이 아닐 때 n(문서 화면에서는 새 문서). 판정은 단축키 레지스트리(lib/shortcuts.ts quickAdd.open)
  useShortcut("quickAdd.open", () => open())
  const value = useMemo(() => ({ open, env, captures, hidden, setSlot }), [open, env, captures, hidden])
  // 실패한 AI 정리를 사람이 이어서: 남겨 둔 초안 전체(없으면 원문)로 시트를 연다
  const manual = (e: CaptureEntry) => open(e.draft ? e.draft.title : e.text, null, () => captures.dismiss(e.id), e.draft ?? { boardId: env.boardId ?? "", kind: "todo", title: e.text, at: null, areaId: null, tags: [], note: "", props: [] })
  const tray = <CaptureTray c={captures} onOpen={env.onOpenWork} onManual={manual} floating={!slot} top={env.page?.view === "board" && !env.page?.work} />
  return (
    <Ctx.Provider value={value}>
      {children}
      {slot ? createPortal(tray, slot) : tray}
      {sheet.key > 0 && (
        <QuickAddSheet
          key={sheet.key + "|" + (env.scope ?? "no-scope")}
          open={sheet.open}
          prefill={sameSheetScope ? sheet.prefill : ""}
          draft={sameSheetScope ? sheet.draft : null}
          env={env}
          captures={captures}
          onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
          onCreated={() => { if (sameSheetScope) created.current?.(); created.current = null }}
          onCloseFocus={() => { if (returnTo.current?.isConnected) returnTo.current.focus() }}
        />
      )}
    </Ctx.Provider>
  )
}

/** 머리글의 + (어느 화면에서나) */
export function QuickAddButton({ keyHint = true }: { keyHint?: boolean }) {
  const { open } = useQuickAdd()
  return <Button variant="ghost" size="icon-sm" aria-label="빠른 추가" aria-keyshortcuts={keyHint ? "n" : undefined} title={keyHint ? "빠른 추가 (N)" : "빠른 추가"} onClick={(e) => open("", e.currentTarget)}><Plus /></Button>
}

/** 웹 빠른 추가 한 번(한 줄·상세 시트·목표 할 일 공용): 계약 submitWithRecord + 같은 출처 api(lib/quick-slot.ts submitQuick). 범위는 그린 때의 것 */
export function useQuickSubmit(fixed?: string | null) {
  const { env } = useQuickAdd()
  // 시트는 연 때의 범위로 고정(fixed), 한 줄·목표 할 일은 누른 때의 범위. 마지막 관문은 서버(X-Direction-Expect-User, 리뷰 17)
  const scope = fixed !== undefined ? fixed : (env.scope ?? null)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const saveKnown = env.saveKnown ?? env.save
  return useCallback(
    (text: string, makeDraft: () => Draft, pending: Pending | null, writeAhead: (p: Pending) => Promise<boolean>): Promise<Submitted> => {
      if (!scope) return Promise.resolve({ kind: "not-sent", message: "로그인을 확인하는 중이에요 · 잠시 뒤 다시 해 주세요" })
      return submitQuick({ text, makeDraft, pending, writeAhead, scope, same: () => scopeRef.current === scope, save: saveKnown })
    },
    [scope, saveKnown],
  )
}

/** 기록 자리의 읽기 실패·깨짐 안내(다시 읽기·버리고 새로 — 버리기는 확인창 뒤) */
/** 기기 저장(기록·쓰던 초안)을 읽지 못했거나 깨졌을 때: 원인 + 다시 읽기(실제로 다시 읽음) + 버리고 새로(확인창) — 규칙 E(리뷰 22) */
export function SlotProblem({ slot, what = "복구 기록" }: { slot: Pick<QuickSlot, "notice" | "reread"> & { plan?: () => WebPlan | null; apply?: (plan: WebPlan) => PlanResult; retry?: () => void }; what?: string }) {
  // 버리기 결과 안내(그사이 바뀜·쓰지 못함)
  const [note, setNote] = useState<string | null>(null)
  if (!slot.notice) return note ? <p role="alert" className="text-xs text-destructive">{note}</p> : null
  // 규칙 F(PR #43 리뷰 2): 누르면 지금 읽어 계획(지울 곳 하나 + 확인창 글)을 만들고, 확인창은 그 글을 그대로, 실행은 그 계획만
  const askDiscard = () => {
    const p = slot.plan?.()
    if (!p) {
      setNote(null)
      return slot.reread()
    }
    if (!confirmDiscard(what, p.message)) return
    const r = slot.apply?.(p)
    setNote(r === "changed" ? CHANGED_TEXT : r === "failed" ? SAVE_FAILED : null)
  }
  return (
    <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5" />{slot.notice.text}
      {slot.notice.kind === "write" && slot.retry && <button type="button" className="font-medium text-foreground hover:underline" onClick={slot.retry}>다시 저장</button>}
      {slot.notice.kind !== "write" && <button type="button" className="font-medium text-foreground hover:underline" onClick={slot.reread}>다시 읽기</button>}
      {slot.notice.kind !== "write" && slot.plan && <button type="button" className="font-medium text-foreground hover:underline" onClick={askDiscard}>버리고 새로</button>}
      {note && <span>{note}</span>}
    </p>
  )
}

/** 준비 신호(로그인·판 목록)가 stallTimer.ms 안에 안 오면 원인과 다시 시도(리뷰 22 P2). 그 전에는 아무것도 보이지 않아요 */
export function ReadyStall({ waiting, retry }: { waiting: string | null; retry?: () => void }) {
  const late = useStall(!!waiting)
  if (!late || !waiting) return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5" />{stallText(waiting)}
      {retry && <button type="button" className="font-medium text-foreground hover:underline" onClick={retry}>다시 시도</button>}
    </p>
  )
}

/** 남은 기록 안내: 무엇이 남았는지 + (Enter 로 하는 일) + 열기 + 버리기(확인창). 버리기만이 기록을 지워요 */
/** 규칙 D(리뷰 21): 편집 초안을 기기에 저장하지 못했으면 칸은 그대로 두고 알려요 — 다시 저장(밀린 값 그대로). 저장될 때까지 전환·닫기·옮기기를 하지 않아요 */
export function EditSaveProblem({ edit, extra }: { edit: QuickEditSlot; extra?: ReactNode }) {
  if (!edit.failed && !edit.readFailed) return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5" />{edit.readFailed ? EDIT_READ_FAILED_TEXT : SAVE_FAILED}
      <button type="button" className="font-medium text-foreground hover:underline" onClick={() => void edit.flush()}>{edit.readFailed ? "다시 읽어 저장" : "다시 저장"}</button>
      {extra}
    </p>
  )
}

/**
 * 규칙 G(PR #43 리뷰 4): 자동 저장이 "다른 곳에서 바뀐 초안"을 만나 쓰지 않았을 때 — 불러오기(그 초안을 칸에, 화면은 setByProgram 으로) ·
 * 내 것으로 덮기(확인창 뒤 지금 칸의 글을 저장). 고를 때까지 자동 저장은 쓰지 않아요
 */
export function EditConflictProblem({ edit, onLoad }: { edit: QuickEditSlot; onLoad: (e: QuickEdit | null) => void }) {
  if (!edit.conflict) return null
  return (
    <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5" />다른 곳에서 바뀐 초안이 있어요 · 지금 칸의 글은 아직 저장하지 않았어요
      <button type="button" className="font-medium text-foreground hover:underline" onClick={() => { const e = edit.takeTheirs(); if (e !== undefined) onLoad(e) }}>불러오기</button>
      <button type="button" className="font-medium text-foreground hover:underline" onClick={() => { if (window.confirm("다른 곳에서 바뀐 초안을 지금 칸의 글로 덮을까요? 덮으면 그 초안은 사라져요.") && !edit.keepMine()) toast(SAVE_FAILED) }}>내 것으로 덮기</button>
    </p>
  )
}

export function PendingNotice({ pending, onOpen, onDiscard, hint }: { pending: Pending; onOpen: (ref: string) => void; onDiscard: () => void; hint?: string }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-1.5 text-xs text-destructive">
      <CircleAlert className="size-3.5" />
      {stepFailureText(pending)}
      {inputLocked(pending) && <span className="text-muted-foreground">· 결과를 확인할 때까지 내용은 고정돼요</span>}
      {hint && <span className="text-muted-foreground">· {hint} {retryLabel(pending)}</span>}
      {pending.ref && <button type="button" className="font-medium text-foreground hover:underline" onClick={() => onOpen(pending.ref ?? "")}>열기</button>}
      {/* 버리기: onDiscard 가 계획(기록·쓰던 초안)을 만들고 그 글로 확인창을 띄워요(PR #43 리뷰 3) */}
      <button type="button" className="font-medium text-foreground hover:underline" onClick={onDiscard}>버리기</button>
    </p>
  )
}

/** 한 줄 + [✦] + [+]. Enter 는 바로 할 일, ✦·⌘⏎ 는 AI에게 맡기기, [+] 는 쓰던 글을 상세 시트로 */
export function QuickAddBar({ className }: { className?: string }) {
  const { env } = useQuickAdd()
  const space = env.space ?? "personal"
  const boardId = boardForSpace(env.boards, env.boardId, space)
  const scope = env.scope ?? null
  const slotName = slotFor("bar", { boardId, space })
  // 입력 상태는 범위·대상 키로만(리뷰 18): 계정이나 판·공간이 바뀌면 다시 그려 쓰던 글이 다른 범위·대상으로 넘어가지 않아요.
  // 쓰던 글은 그 범위·대상의 편집 초안에 남아 돌아오면 복원돼요. 범위를 모르는 동안(null)은 입력·제출을 막아요
  return <QuickAddBarIn key={(scope ?? "no-scope") + "|" + slotName} className={className} scope={scope} slotName={slotName} boardId={boardId} space={space} />
}

function QuickAddBarIn({ className, scope, slotName, boardId, space }: { className?: string; scope: string | null; slotName: string; boardId: string | undefined; space: SpaceId }) {
  const { open, env, captures, setSlot } = useQuickAdd()
  const { boards, items, onOpenWork } = env
  // 복구 기록(lib/quick-slot.ts, 리뷰 16): 범위별 localStorage 의 그 대상 한 줄 자리. 새로고침·화면 이동 뒤에도 같은 id·단계·초안으로 이어요.
  // 지우는 길은 끝(done)과 사람의 버리기(확인창)뿐
  const slot = useQuickSlot(slotName, scope)
  const pending = slot.pending
  // 편집 중 글(리뷰 17): 새로고침·화면 이동 뒤에도 쓰던 글이 남아요. 잠긴 기록이면 기록의 글로만
  const edit = useQuickEdit(slotName, scope)
  const submitQuickAdd = useQuickSubmit(scope)
  const [text, setText] = useState(() => (inputLocked(pending) ? pending?.text : (edit.initial?.text ?? pending?.text)) ?? "")
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  // 규칙 G(PR #43 리뷰 4): 프로그램이 칸을 바꿀 때는 이것으로만 — 그 값을 디스크와 맞춘 값으로 기록해 자동 저장이 사람 편집처럼 쓰지 않아요
  const editOf = (t: string): QuickEdit => ({ text: t, ...(boardId ? { boardId } : {}), space })
  const setByProgram = (t: string) => {
    setText(t)
    edit.adopt(editOf(t))
  }
  // 처음 그림의 칸(복원)도 프로그램이 정한 값이에요
  useEffect(() => {
    edit.adopt(editOf(text))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 한 번
  }, [])
  useEffect(() => {
    if (pending && !text) setByProgram(pending.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 기록을 처음 읽었을 때만
  }, [pending?.id])
  const locked = inputLocked(pending)
  // 규칙 C(리뷰 21): 범위·대상·그 자리의 기록·편집 초안을 다 읽어 복원한 뒤에만 입력·제출(localStorage 는 바로 읽혀 첫 그림에서 복원이 끝나요)
  const ready = inputReady({ scope: !!scope, target: !!boardId, record: slot.loaded, edit: edit.ready, restored: true })
  // 열 때 기기 저장을 읽지 못해 막혀 있다가 다시 읽어 준비가 되면 그때 복원해요(그동안은 입력이 막혀 덮을 글이 없어요, 규칙 E)
  const restoredAtOpen = useRef(ready)
  useEffect(() => {
    if (restoredAtOpen.current || !ready) return
    restoredAtOpen.current = true
    const t = inputLocked(pending) ? pending?.text : (edit.initial?.text ?? pending?.text)
    if (t) setByProgram(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 준비가 된 때 한 번만
  }, [ready])
  useEffect(() => {
    if (!locked && scope) edit.change(editOf(text))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 글이 바뀔 때만
  }, [text, locked])
  const board = boards.find((b) => b.id === boardId)
  const parsed = text.trim() ? parseQuick(text, board?.areas ?? [], W.parse, board?.kind !== "company") : null
  const retrying = !!pending && (locked || pending.text === text)
  const same = parsed && boardId && !retrying ? findSameOpen(items, boardId, parsed.title, space) : null
  const aiSame = text.trim() ? activeSame(captures.entries, captures.phases, text) : null
  // AI가 만드는 할 일은 개인 판에 올라가서, 회사 판을 보고 있을 때는 쓰지 않는다. 기록이 있는 동안도 막아요(먼저 끝내거나 버려요)
  const personal = board?.kind !== "company" && space === "personal"
  const aiReady = ready && captures.available && personal && !!boardId && !!text.trim() && !busy && !aiBusy && !aiSame && aiAllowed(pending)
  const slotRef = useCallback((el: HTMLDivElement | null) => setSlot(el), [setSlot])
  const askAi = async () => {
    if (!aiReady || !boardId || !parsed) return
    const draft: Draft = { boardId, kind: "todo", title: text.trim(), at: parsed.at, areaId: parsed.area?.id ?? null, tags: parsed.tags, note: "", props: [] }
    setAiBusy(true)
    try {
      // 넘기기 전 원문이 전제(PR #43 리뷰 4 규칙 G): 넘긴 뒤 그 원문일 때만 쓰던 글을 비우고, 그사이 바뀌었으면 남겨 칸에 그 글
      const handoff = edit.planClear()
      const r = await captures.start(text.trim(), draft, captureHints(draft, board?.areas ?? []))
      if (!r.ok) return void toast("AI에게 맡기지 못했어요", { description: r.error })
      const cleared = edit.applyClear(handoff)
      setByProgram(cleared.r === "changed" ? (cleared.now?.text ?? "") : "")
      const kept = draftAfterDoneNote(cleared.r, "AI에게 맡겼어요 · 기기의 쓰던 글을 지우지 못했어요")
      if (kept) toast(kept)
      setConfirm(null)
    } finally {
      setAiBusy(false)
    }
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || !scope || !boardId || !parsed || busy || !slot.ready) return
    const key = normTitle(parsed.title)
    if (same && confirm !== key) return setConfirm(key)
    setBusy(true)
    try {
      // 제출한 초안 원문이 전제(PR #43 리뷰 3): 끝나면 그 원문일 때만 쓰던 글을 비워요
      const draftTarget = edit.planClear()
      const r = await submitQuickAdd(text, (): Draft => ({ boardId, space, kind: "todo", title: parsed.title, at: parsed.at, areaId: parsed.area?.id ?? null, tags: parsed.tags, note: "", props: [] }), pending, slot.writeAhead)
      switch (r.kind) {
        case "other-scope":
        case "not-sent":
          return void toast(r.message)
        case "pending":
          if (r.note) toast(r.note)
          if (!slot.keep(r.pending)) toast(SAVE_FAILED)
          return
        case "done":
          // 끝(done)일 때만 칸·기록을 비워요
          setConfirm(null)
          {
            // 제출한 초안 원문이 전제(PR #43 리뷰 3): 그사이 바뀐 쓰던 글은 남기고 그 글을 보여요
            const cleared = edit.applyClear(draftTarget)
            setByProgram(cleared.r === "changed" ? (cleared.now?.text ?? "") : "")
            const kept = draftAfterDoneNote(cleared.r, "추가했어요 · 기기의 쓰던 글을 지우지 못했어요")
            if (kept) toast(kept, { description: "다음에 열면 그 글이 다시 보일 수 있어요" })
          }
          if (!slot.done(r.result)) toast("추가했어요 · 기기의 기록을 지우지 못했어요", { description: "다음에 열면 확인으로 정리해요(다시 보내지 않아요)" })
          return reportCreated(r.result, r.draft.title, onOpenWork)
        default:
          return assertNever(r)
      }
    } finally {
      setBusy(false)
    }
  }
  // 쓰던 글을 상세 시트로 옮기기: 이 자리에 먼저 저장된 뒤에만(규칙 D)
  const toSheet = (from: HTMLElement) => {
    if (!edit.flush()) return void toast(SAVE_FAILED)
    // 시트로 넘긴 원문이 전제: 시트에서 추가가 끝나면 그 원문일 때만 이 자리 쓰던 글을 비워요(규칙 G)
    const handoff = edit.planClear()
    open(text, from, () => {
      const cleared = edit.applyClear(handoff)
      setByProgram(cleared.r === "changed" ? (cleared.now?.text ?? "") : "")
      setConfirm(null)
    })
  }
  // 버리기(PR #43 리뷰 3): 확인창을 띄울 때 남은 기록과 그 자리의 쓰던 글을 각자 전제와 함께 계획하고 확인창에 둘 다 밝혀요.
  // 확인 뒤 대상마다 비교-후-쓰기 — 그사이 바뀐 것은 지우지 않아요
  const discard = () => {
    const plan = planDiscardBoth(slot, edit)
    if (!plan) return void toast(CHANGED_TEXT)
    if (!confirmDiscard("이 기록", plan.message)) return
    const x = runDiscardBoth(slot, edit, plan)
    if (x.draft === "done") setByProgram("")
    else if (x.draft === "changed") setByProgram(x.now?.text ?? "")
    const note = discardBothNote(x)
    if (note) toast(note)
  }
  return (
    <div className={className}>
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          value={text}
          readOnly={busy || aiBusy || locked}
          aria-busy={busy || aiBusy}
          onChange={(e) => { setText(e.target.value); setConfirm(null) }}
          onKeyDown={(e) => { if (matches(e, "quickAdd.ai") && !composing(e.nativeEvent)) { e.preventDefault(); void askAi() } }}
          placeholder={ready ? "할 일 추가" : LOADING_TEXT}
          aria-label="할 일 추가"
          aria-describedby="quick-add-hint"
          disabled={!ready}
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none max-md:h-11 [@media(pointer:coarse)]:h-11 placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span id="quick-add-hint" className="sr-only">Enter 로 바로 추가해요. 내일 3시, 금요일 같은 날짜와 #영역, #태그를 알아봐요{captures.available ? ". ⌘Enter 는 AI가 찾아보고 다듬어서 올려요" : ""}</span>
        {captures.available && (
          <Button type="button" variant="outline" size="icon-lg" aria-label="AI로 정리해서 올리기" aria-keyshortcuts="Meta+Enter Control+Enter" title={!personal ? "AI 추가는 개인 판에 올려요. 개인 판에서 써 주세요" : pending ? "남은 추가 기록을 먼저 끝내거나 버려 주세요" : aiSame ? "같은 글을 AI가 정리하고 있어요" : "AI로 정리해서 올리기 (⌘↵)"} disabled={!aiReady} onClick={() => void askAi()}>
            <AiMark className={cn("text-ai", aiBusy && "animate-pulse motion-reduce:animate-none")} />
          </Button>
        )}
        <Button type="button" size="icon-lg" aria-label="자세히 추가" title="자세히 추가" disabled={!ready || busy || !!pending} onClick={(e) => toSheet(e.currentTarget)}><Plus /></Button>
      </div>
      <ReadyStall waiting={!scope ? "로그인 정보" : !boardId ? "판 목록" : null} retry={env.retry} />
      <SlotProblem slot={slot} />
      <SlotProblem slot={edit} what="쓰던 초안" />
      {captures.issue && <SlotProblem slot={captures.issue} what="AI 정리 칩" />}
      <EditSaveProblem edit={edit} />
      <EditConflictProblem edit={edit} onLoad={(e) => setByProgram(e?.text ?? "")} />
      {pending ? <PendingNotice pending={pending} onOpen={onOpenWork} onDiscard={discard} hint="Enter 로" />
        : same ? <SameWarning same={same} onOpen={onOpenWork} confirmed={!!parsed && confirm === normTitle(parsed.title)} /> : <ParsedChips parsed={parsed} />}
    </form>
    {/* AI 정리 칩 자리. form 밖이라 칩의 버튼이 제출을 일으키지 않는다 */}
    <div ref={slotRef} />
    </div>
  )
}
