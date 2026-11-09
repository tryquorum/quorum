// 빠른 추가 상세 시트: 제목 한 줄이 먼저, 노트·알림/마감·영역·태그·속성은 아래. 데스크톱은 가운데 창, 좁은 화면은 아래 시트
// "추가"(⌘⏎)는 사람이 쓴 그대로, "AI로 정리해서 올리기"(⌘⇧⏎)는 같은 내용을 원문·힌트로 AI에게 맡긴다
import { koDateLabel } from "@/lib/ko-date"
import { CHANGED_TEXT, DRAFT_KEPT_TEXT, resultText } from "@direction-board/contracts/slot-store"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Bell, Building2, Circle, Flag, Hash, ListPlus, X } from "lucide-react"
import { normTitle } from "@direction-board/contracts"
import type { PropType, SpaceId } from "@direction-board/contracts"
import { useSpaces } from "@/hooks/use-space"
import { boardForSpace } from "@/lib/spaces"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AiMark } from "@/components/ai-mark"
import { EditConflictProblem, EditSaveProblem, ParsedChips, PendingNotice, ReadyStall, SameWarning, SlotProblem, reportCreated, useQuickSubmit, type QuickAddEnv } from "@/components/quick-add"
import type { Captures } from "@/hooks/use-captures"
import { useIsMobile } from "@/hooks/use-mobile"
import { W } from "@/lib/api"
import { captureHints, captureText } from "@/lib/capture"
import { assertNever, findSameOpen, parseQuick, type Draft, type DraftProp } from "@/lib/quick-add"
import { aiAllowed, inputLocked, inputReady, LOADING_TEXT, restoreSource, retryLabel, SAVE_FAILED, slotFor, targetProblem, type QuickEdit } from "@direction-board/contracts/quick-recovery"
import { confirmDiscard, peekSlot, placeEditNow, undoPlace, useQuickEdit, useQuickSlot, useStoreHealth } from "@/lib/quick-slot"
import { discardBothNote, draftAfterDoneNote, planDiscardBoth, runDiscardBoth } from "@/lib/quick-discard"
import { cn } from "@/lib/utils"
import { composing, matches } from "@/lib/shortcuts"

const PROP_TYPES: [PropType, string][] = [["text", "글"], ["number", "숫자"], ["date", "날짜"], ["checkbox", "체크"], ["url", "링크"], ["select", "선택"], ["list", "목록"]]
const field = "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
const chip = (on: boolean) => cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap transition-colors", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-h-8 items-start gap-3">
      <span className="flex h-8 w-4 shrink-0 items-center text-muted-foreground" title={label}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

type SheetProps = {
  open: boolean; prefill: string; draft?: Draft | null; env: QuickAddEnv; captures: Captures; onOpenChange: (open: boolean) => void; onCreated: () => void; onCloseFocus: () => void
}

/**
 * 규칙 E(리뷰 22): 기기 저장(기록·쓰던 초안)을 잘 읽어야 시트 본문을 그려요. 못 읽었거나 깨졌으면 원인 + 다시 읽기 + 버리고 새로(확인창)만 —
 * 입력·제출·자동 저장·자동 삭제가 없어요. 다시 읽어 둘 다 잘 읽히면 그때 본문을 처음 그려 저장에서 복원해요
 */
/** 열 때의 대상(판·목표·공간)의 시트 자리(리뷰 20). 열기 전 검사와 본문이 같은 자리를 봐요(자리마다 저장이 따로 — PR #43 리뷰) */
const openSlotOf = (initial: Draft | null | undefined, env: QuickAddEnv): string => {
  const openSpace: SpaceId = initial?.space ?? env.space ?? "personal"
  return slotFor("sheet", { boardId: initial?.goalId ? initial.boardId : boardForSpace(env.boards, env.boardId, openSpace), goalId: initial?.goalId ?? null, space: openSpace })
}

export function QuickAddSheet(props: SheetProps) {
  const health = useStoreHealth(props.env.scope ?? null, openSlotOf(props.draft, props.env))
  const mobile = useIsMobile()
  if (!props.env.scope || health.ok) return <QuickAddSheetIn {...props} />
  const body = (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">빠른 추가</p>
      <SlotProblem slot={health.records} />
      <SlotProblem slot={health.edits} what="쓰던 초안" />
      <div className="flex justify-end"><Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>닫기</Button></div>
    </div>
  )
  if (mobile) return <Sheet open={props.open} onOpenChange={props.onOpenChange}><SheetContent side="bottom" showCloseButton={false} className="rounded-t-xl px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><SheetTitle className="sr-only">빠른 추가</SheetTitle><SheetDescription className="sr-only">기기 저장을 읽지 못했어요</SheetDescription>{body}</SheetContent></Sheet>
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent showCloseButton={false} className="top-[12vh] translate-y-0 gap-0 p-5 sm:max-w-xl"><DialogTitle className="sr-only">빠른 추가</DialogTitle><DialogDescription className="sr-only">기기 저장을 읽지 못했어요</DialogDescription>{body}</DialogContent></Dialog>
}

function QuickAddSheetIn({ open, prefill, draft: initial, env, captures, onOpenChange, onCreated, onCloseFocus }: SheetProps) {
  const mobile = useIsMobile()
  const { boards, boardId: viewBoard, items, onOpenWork } = env
  const { spaces, me } = useSpaces()
  // 복구 기록(lib/quick-slot.ts, 리뷰 16): 범위별 localStorage 의 시트 자리. 닫기·뒤로·새로고침 뒤에도 남아 다시 열면 그 초안·id·단계로 이어요.
  // 지우는 길은 끝(done)과 사람의 버리기(확인창)뿐
  // 범위는 연 때의 것으로 고정해요(리뷰 17 — 서버가 쓰기마다 그 범위의 주체인지 마지막으로 봐요)
  const openScope = useRef(env.scope ?? null).current
  // 열 때의 대상(판·목표·공간)의 자리에서 남은 기록·편집 초안을 읽어 복원해요. 그다음부터 자리는 늘 "지금 고른 대상"에서 나와요(리뷰 20)
  const openSpace: SpaceId = initial?.space ?? env.space ?? "personal"
  const openSlot = useRef(openSlotOf(initial, env)).current
  const opened = useRef(peekSlot(openScope, openSlot)).current
  const source = useRef(restoreSource(opened.record, opened.edit)).current
  const submitQuickAdd = useQuickSubmit(openScope)
  // 저장에서 복원했으면(이번에 넘긴 글·초안보다 먼저) 이번에 연 쪽(AI 정리 칩 등)의 onCreated 는 부르지 않아요. 다른 공간의 초안으로 옮겨 가도 마찬가지
  const fromStore = useRef(!!source)
  const restoredEdit = source?.from === "edit" ? source.edit : null
  const start: Draft | null | undefined = source?.from === "record" ? source.draft : restoredEdit
    ? { boardId: restoredEdit.boardId ?? initial?.boardId ?? "", kind: restoredEdit.kind ?? "todo", title: restoredEdit.text, at: restoredEdit.at ?? null, areaId: restoredEdit.areaId ?? null, tags: restoredEdit.tags ?? [], note: restoredEdit.note ?? "", props: (restoredEdit.props ?? []) as DraftProp[], ...(restoredEdit.space ? { space: restoredEdit.space as SpaceId } : {}), ...(restoredEdit.goalId ? { goalId: restoredEdit.goalId } : {}) }
    : initial
  // 공간: 보던 공간(모든 공간이면 개인). 워크스페이스 일은 회사 판이 있으면(파일럿) 그 판에 둬요
  const [space, setSpace] = useState<SpaceId>(start?.space ?? env.space ?? "personal")
  // 목표에서 연 시트는 목표의 판·공간 그대로(공간 고르기를 숨겨요). 서버도 goalId 로 공간을 물려받고 다르면 400
  const forGoal = !!start?.goalId
  // 판은 지금 고른 공간에서 새 시트와 같은 규칙으로 정해요(리뷰 19 — 판은 공간에서 나오는 값). 목표에 붙인 시트는 목표의 판·공간
  const goalId = forGoal ? (start?.goalId ?? null) : null
  const boardId = forGoal && start ? start.boardId : boardForSpace(boards, viewBoard, space)
  // 자리 = 시트 + 지금 대상(리뷰 20). 기록·편집 초안 모두 이 자리 — 공간을 바꾸면 자리도 바뀌어요(기록이 있는 동안은 공간을 못 바꿔요)
  const targetSpace = forGoal ? (start?.space ?? openSpace) : space
  const slotName = slotFor("sheet", { boardId, goalId, space: targetSpace })
  const slot = useQuickSlot(slotName, openScope)
  // 편집 중 초안(리뷰 17): 제출 기록과 따로 두고 짧은 지연·닫기·pagehide 에 저장해요
  const edit = useQuickEdit(slotName, openScope)
  const board = boards.find((b) => b.id === boardId)
  const docs = board?.kind !== "company" // 회사 판 항목은 문서 색인 밖이라 태그·속성을 못 붙인다
  // initial: 실패한 AI 정리를 이어서 쓸 때의 초안 전체
  const [title, setTitle] = useState(start?.title ?? prefill)
  const [note, setNote] = useState(start?.note ?? "")
  const [kind, setKind] = useState<"todo" | "goal">(start?.kind ?? "todo")
  const [atPick, setAtPick] = useState<string | null | undefined>(restoredEdit ? restoredEdit.at : (start?.at ?? undefined)) // undefined: 제목에서 알아본 것을 쓴다
  const [areaPick, setAreaPick] = useState<string | null | undefined>(restoredEdit ? restoredEdit.areaId : (start?.areaId ?? undefined))
  const [tags, setTags] = useState<string[]>(start?.tags ?? [])
  const [tagText, setTagText] = useState("")
  const [props, setProps] = useState<DraftProp[]>(start?.props ?? [])
  const [busy, setBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  // 남은 기록. 앞 단계가 저장됐거나 결과를 모르거나 사람 값과 부딪쳤으면 그 초안으로만 이어요(내용 고정)
  const failure = slot.pending
  const frozen = inputLocked(failure) ? (failure?.draft ?? null) : null
  const locked = busy || !!frozen
  // 칸 묶음 → 편집 초안(자동 저장과 프로그램 변경이 같은 모양을 써요)
  type Fields = { title: string; note: string; kind: "todo" | "goal"; atPick: string | null | undefined; areaPick: string | null | undefined; tags: string[]; props: DraftProp[]; space: SpaceId }
  const boardOf = (sp: SpaceId) => (forGoal && start ? start.boardId : boardForSpace(boards, viewBoard, sp))
  const editOfFields = (f: Fields): QuickEdit => {
    const bid = boardOf(f.space)
    return { text: f.title, note: f.note, kind: f.kind, ...(f.atPick !== undefined ? { at: f.atPick } : {}), ...(f.areaPick !== undefined ? { areaId: f.areaPick } : {}), tags: f.tags, props: f.props, space: f.space, ...(bid ? { boardId: bid } : {}), ...(start?.goalId ? { goalId: start.goalId } : {}) }
  }
  const fieldsNow = (): Fields => ({ title, note, kind, atPick, areaPick, tags, props, space })
  /**
   * 규칙 G(PR #43 리뷰 4): 프로그램이 칸을 바꿀 때는 이것으로만(복원·되돌리기·바뀜 채우기·공간 옮기기) — 그 값을 그 자리의 디스크와 맞춘 값으로 기록해
   * 자동 저장이 사람 편집처럼 쓰지 않아요
   */
  const setFieldsByProgram = (f: Fields) => {
    setTitle(f.title); setNote(f.note); setKind(f.kind); setAtPick(f.atPick); setAreaPick(f.areaPick); setTags(f.tags); setProps(f.props); setSpace(f.space)
    edit.adopt(editOfFields(f), slotFor("sheet", { boardId: boardOf(f.space), goalId, space: forGoal ? (start?.space ?? openSpace) : f.space }))
  }
  // 저장에서 복원한 처음 그림의 칸은 디스크와 같은 값이에요(넘겨받은 글은 디스크에 없는 사람 글이라 그대로 저장해요 — 리뷰 19)
  useEffect(() => {
    if (fromStore.current) edit.adopt(editOfFields(fieldsNow()))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 한 번
  }, [])
  // 쓰는 대로 편집 초안에 남겨요(잠긴 동안은 편집할 수 없어 남기지 않아요)
  useEffect(() => {
    if (frozen) return
    edit.change(editOfFields(fieldsNow()))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 칸이 바뀔 때만
  }, [title, note, kind, atPick, areaPick, tags, props, space, !!frozen])
  const [draftCleared, setDraftCleared] = useState(false)
  // 공간 바꾸기(리뷰 20): (a) 기록이 있는 동안은 잠금(기록의 대상 그대로), (b) 기록 없이 쓰던 초안은 새 대상 자리로 옮기고 옛 자리를 비워요 —
  // 새 자리에 이미 초안·기록이 있으면 덮지 않고 멈춰 "그 공간에 쓰던 초안이 있어요"(그쪽으로 가면 지금 초안은 이 자리에 남아요)
  const [spaceStop, setSpaceStop] = useState<{ space: SpaceId; text: string; go: boolean } | null>(null)
  const nowEdit = (sp: SpaceId, bid: string | undefined) => ({ text: title, note, kind, ...(atPick !== undefined ? { at: atPick } : {}), tags, props, space: sp, ...(bid ? { boardId: bid } : {}) })
  const chooseSpace = (next: SpaceId) => {
    if (next === space || failure) return
    const nextBoard = boardForSpace(boards, viewBoard, next)
    const nextSlot = slotFor("sheet", { boardId: nextBoard, goalId: null, space: next })
    const there = peekSlot(openScope, nextSlot)
    // 그 공간 자리의 기록·초안을 읽지 못했거나 깨졌으면 비어 있다고 보지 않고 옮기지 않아요(PR #43 리뷰)
    if (there.problem) return setSpaceStop({ space: next, text: "그 공간의 추가 기록·쓰던 초안을 읽지 못했어요 · 이 공간에 그대로 두었어요", go: false })
    if (there.record || there.edit) {
      setSpaceStop({ space: next, text: there.record ? "그 공간에 남은 추가 기록이 있어요 · 덮지 않았어요" : "그 공간에 쓰던 초안이 있어요 · 덮지 않았어요", go: true })
      return
    }
    // 옮기기: 옛 자리 비우기 대상을 먼저 만들고(전제 = 지금 원문), 새 자리에 저장된 뒤에만 옛 자리를 비교-후-쓰기로 비워요(PR #43 리뷰 3)
    const oldDraft = edit.planClear()
    const placed = placeEditNow(openScope, nextSlot, nowEdit(next, nextBoard))
    if (!placed) return setSpaceStop({ space: next, text: "쓰던 초안을 그 공간으로 옮기지 못했어요 · 이 공간에 그대로 두었어요", go: false })
    // 옛 자리를 비우지 못하면(그사이 바뀜 포함) 새 자리에 넣은 것을 방금 쓴 원문일 때만 거두고 공간을 바꾸지 않아요(규칙 D — 두 자리에 같은 초안이 남지 않게)
    const moved = edit.applyClear(oldDraft)
    if (moved.r !== "done") {
      undoPlace(placed)
      if (moved.r === "changed" && moved.now) fillFromEdit(moved.now)
      return setSpaceStop({ space: next, text: moved.r === "changed" ? DRAFT_KEPT_TEXT : SAVE_FAILED, go: false })
    }
    setSpaceStop(null)
    setFieldsByProgram({ ...fieldsNow(), areaPick: undefined, space: next })
  }
  // 그 공간의 초안·기록으로 가기: 지금 초안을 이 자리에 먼저 저장하고(규칙 D — 저장하지 못하면 가지 않고 칸 그대로), 그쪽 내용을 칸에 보여요
  const goToSpace = (next: SpaceId) => {
    const nextBoard = boardForSpace(boards, viewBoard, next)
    const there = peekSlot(openScope, slotFor("sheet", { boardId: nextBoard, goalId: null, space: next }))
    if (!edit.flush()) return setSpaceStop({ space: next, text: SAVE_FAILED, go: false })
    fromStore.current = true
    const d = there.record?.draft
    const e = there.record && inputLocked(there.record) ? null : there.edit
    setSpaceStop(null)
    setFieldsByProgram({ title: e?.text ?? d?.title ?? "", note: e?.note ?? d?.note ?? "", kind: e?.kind ?? d?.kind ?? "todo", atPick: e ? e.at : (d?.at ?? undefined), areaPick: e ? e.areaId : (d?.areaId ?? undefined), tags: e?.tags ?? d?.tags ?? [], props: ((e?.props ?? d?.props) ?? []) as DraftProp[], space: next })
  }
  // 버린 뒤에는 칸을 이번에 넘긴 글·초안으로 되돌려요(버린 내용이 편집 초안으로 다시 남지 않게)
  const resetFields = () => {
    setDraftCleared(true)
    setFieldsByProgram({ title: initial?.title ?? prefill, note: initial?.note ?? "", kind: initial?.kind ?? "todo", atPick: initial?.at ?? undefined, areaPick: initial?.areaId ?? undefined, tags: initial?.tags ?? [], props: initial?.props ?? [], space })
  }
  // 그사이 바뀐 쓰던 초안을 칸에 보여요(남겨 둔 초안의 글만)
  function fillFromEdit(e: QuickEdit) {
    setFieldsByProgram({ title: e.text, note: e.note ?? "", kind: e.kind ?? "todo", atPick: e.at, areaPick: e.areaId, tags: e.tags ?? [], props: (e.props ?? []) as DraftProp[], space })
  }
  // 쓰던 초안 버리기(PR #43 리뷰 3): 확인창을 띄울 때 지금 원문을 전제로, 확인 뒤 비교-후-쓰기
  const clearDraft = () => {
    const target = edit.planClear()
    if (!target) return resetFields()
    if (!confirmDiscard("쓰던 초안", "이 자리의 쓰던 초안을 버려요 · 되살릴 수 없어요.")) return
    const c = edit.applyClear(target)
    if (c.r === "done") return resetFields()
    if (c.r === "changed" && c.now) fillFromEdit(c.now)
    toast(c.r === "changed" ? DRAFT_KEPT_TEXT : (resultText(c.r, SAVE_FAILED) ?? SAVE_FAILED))
  }
  // 남은 기록 버리기(PR #43 리뷰 3): 기록·쓰던 초안 두 대상을 각자 전제와 함께, 확인창에 둘 다
  const discard = () => {
    const plan = planDiscardBoth(slot, edit)
    if (!plan) return void toast(CHANGED_TEXT)
    if (!confirmDiscard("이 기록", plan.message)) return
    const x = runDiscardBoth(slot, edit, plan)
    if (x.draft === "done") resetFields()
    else if (x.draft === "changed" && x.now) fillFromEdit(x.now)
    const note = discardBothNote(x)
    if (note) toast(note)
  }
  // 닫기(취소·Esc·바깥 누르기): 쓰던 초안을 먼저 저장하고, 저장하지 못하면 닫지 않아요(규칙 D). 저장하지 않고 닫기는 사람이 확인창으로
  const [closeStop, setCloseStop] = useState(false)
  const requestOpen = (o: boolean) => {
    if (o) return onOpenChange(true)
    if (!edit.flush()) return setCloseStop(true)
    setCloseStop(false)
    onOpenChange(false)
  }
  const closeUnsaved = () => {
    if (!window.confirm("쓰던 초안을 기기에 저장하지 못했어요. 저장하지 않고 닫을까요? 닫으면 이 글은 사라져요.")) return
    setCloseStop(false)
    onOpenChange(false)
  }

  const parsed = title.trim() ? parseQuick(title, board?.areas ?? [], W.parse, docs) : null
  const at = atPick !== undefined ? atPick : parsed?.at ?? null
  const areaId = areaPick !== undefined ? areaPick : parsed?.area?.id ?? null
  const allTags = docs ? [...new Set([...(parsed?.tags ?? []), ...tags])] : []
  const same = parsed && boardId && !failure ? findSameOpen(items, boardId, parsed.title, space) : null
  // 대상(판·목표)을 지금 범위에서 찾을 수 없으면 제출을 막고 안내(버리기는 열어 둬요)
  const targetIssue = targetProblem({ boardId, goalId: start?.goalId ?? null }, env.boardsReady === false ? null : boards, env.boardsReady === false ? null : items)
  // 규칙 C(리뷰 21): 범위·대상·그 자리의 기록·편집 초안을 다 읽어 복원한 뒤에만 입력·제출(열 때 peekSlot 으로 바로 복원해요)
  const prepared = inputReady({ scope: !!openScope, target: !!boardId, record: slot.loaded, edit: edit.ready, restored: true })
  const ready = prepared && !!boardId && !!parsed?.title && !busy && slot.ready && !!openScope && !targetIssue
  const addTag = () => {
    const t = tagText.replace(/^#/, "").trim()
    if (t && !allTags.some((x) => normTitle(x) === normTitle(t))) setTags((v) => [...v, t])
    setTagText("")
  }

  /** 지금 시트의 내용. 태그 칸에 쓰고 아직 칩으로 넣지 않은 글도 함께 */
  const current = (): Draft | null => {
    if (!boardId || !parsed) return null
    const typed = tagText.replace(/^#/, "").trim()
    const tagsNow = docs && typed && !allTags.some((x) => normTitle(x) === normTitle(typed)) ? [...allTags, typed] : allTags
    return { boardId, space, kind, title: parsed.title, at, areaId, ...(start?.goalId && kind === "todo" ? { goalId: start.goalId } : {}), tags: tagsNow, note, props: docs ? props : [] }
  }
  const submit = async () => {
    if (!ready || !boardId || !parsed) return
    const key = normTitle(parsed.title)
    if (same && confirm !== key) return setConfirm(key)
    const draft = frozen ?? current()
    if (!draft) return
    setBusy(true)
    try {
      // 제출한 초안 원문이 전제(PR #43 리뷰 3)
      const draftTarget = edit.planClear()
      // 잠긴 기록(결과 불명·부분 완료·사람 값과 다름)이면 그 기록의 id·단계로만(결과 불명이면 읽어서 확인만). 확실히 거절된 기록이면 고친 초안으로 새로
      const r = await submitQuickAdd("", () => draft, inputLocked(failure) ? failure : null, slot.writeAhead)
      switch (r.kind) {
        case "other-scope":
        case "not-sent":
          return void toast(r.message)
        case "pending":
          // 끝이 아니에요: 시트·기록·아직 안 보낸 노트를 그대로 두고 사람이 고르게
          if (r.note) toast(r.note)
          if (!slot.keep(r.pending)) toast(SAVE_FAILED)
          return
        case "done":
          {
            const kept = draftAfterDoneNote(edit.applyClear(draftTarget).r, "추가했어요 · 기기의 쓰던 초안을 지우지 못했어요")
            if (kept) toast(kept, { description: "다음에 열면 그 초안이 다시 보일 수 있어요" })
          }
          if (!slot.done(r.result)) toast("추가했어요 · 기기의 기록을 지우지 못했어요", { description: "다음에 열면 확인으로 정리해요(다시 보내지 않아요)" })
          reportCreated(r.result, r.draft.title, onOpenWork)
          // 저장에서 복원한 시트면 이번에 연 쪽(AI 정리 칩 등)의 onCreated 는 부르지 않아요(다른 추가를 지우지 않게)
          if (!fromStore.current) onCreated()
          return onOpenChange(false)
        default:
          return assertNever(r)
      }
    } finally {
      setBusy(false)
    }
  }
  // AI가 만드는 할 일은 개인 판에 올라가서, 회사 판 시트에서는 쓰지 않는다(docs = 개인 판)
  // AI 정리는 개인 공간에만 올려요(워크스페이스 공간은 아직 사람이 직접)
  const aiReady = captures.available && docs && space === "personal" && ready && aiAllowed(failure)
  const askAi = async () => {
    const d = current()
    if (!aiReady || !d) return
    setBusy(true)
    setAiError(null)
    try {
      const draftTarget = edit.planClear()
      // 원문은 사람이 쓴 제목 그대로(날짜·#말 포함)와 노트. 실패하면 이 초안 전체로 시트를 다시 연다
      const r = await captures.start(captureText(title, note), { ...d, title: title.trim() }, captureHints(d, board?.areas ?? []))
      if (!r.ok) return setAiError(r.error)
      // 쓴 내용은 AI 정리 칩으로 옮겨 갔어요
      {
        const kept = draftAfterDoneNote(edit.applyClear(draftTarget).r, "AI에게 맡겼어요 · 기기의 쓰던 초안을 지우지 못했어요")
        if (kept) toast(kept, { description: "다음에 열면 그 초안이 다시 보일 수 있어요" })
      }
      onCreated()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (composing(e.nativeEvent)) return
    if (matches(e, "sheet.ai")) { e.preventDefault(); if (captures.available) void askAi() }
    else if (matches(e, "sheet.submit")) { e.preventDefault(); void submit() }
  }

  const body = (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
      {/* 범위(서버·로그인)를 모르는 동안은 입력을 막아요(리뷰 19 — 범위가 오면 시트를 다시 그려 쓴 글이 사라지고 저장되지 않던 길) */}
      {!openScope && <p role="status" className="text-xs text-muted-foreground">로그인을 확인하는 중이에요 · 확인되면 쓸 수 있어요</p>}
      {/* 준비 신호가 늦으면 원인과 다시 시도(리뷰 22 P2) */}
      <ReadyStall waiting={!openScope ? "로그인 정보" : !boardId ? "판 목록" : null} retry={env.retry} />
      {/* 규칙 C: 다 읽어 복원하기 전에는 칸 전체를 막아요(복원이 입력을 덮을 길이 없게) */}
      <fieldset disabled={locked || !prepared} aria-busy={busy} className="contents">
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => { setTitle(e.target.value); setConfirm(null) }}
          onKeyDown={(e) => { if (matches(e, "sheet.submitTitle") && !composing(e.nativeEvent)) { e.preventDefault(); void submit() } }}
          placeholder={!prepared ? LOADING_TEXT : kind === "goal" ? "목표" : "할 일"}
          aria-label="제목"
          className="h-11 w-full rounded-lg border border-transparent bg-transparent px-2.5 text-lg font-medium outline-none transition-colors placeholder:text-muted-foreground hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
        />
        <ParsedChips parsed={parsed} />
      </div>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="노트" aria-label="노트" rows={4} className="min-h-24 resize-y text-sm" />
      <div className="flex flex-col gap-2 border-t pt-3">
        {spaces.length > 1 && me?.role !== "member" && !forGoal && (
          <Row icon={<Building2 className="size-4" />} label="공간">
            {spaces.map((s) => <button key={s.id} type="button" aria-pressed={space === s.id} className={chip(space === s.id)} disabled={!!failure} title={failure ? "남은 추가 기록이 있는 동안은 공간을 바꿀 수 없어요(기록의 대상 그대로)" : undefined} onClick={() => chooseSpace(s.id)}>{s.name}</button>)}
            {spaceStop && <span role="status" className="flex basis-full flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{spaceStop.text}{spaceStop.go && <button type="button" className="font-medium text-foreground hover:underline" onClick={() => goToSpace(spaceStop.space)}>그 초안으로 가기</button>}<button type="button" className="font-medium text-foreground hover:underline" onClick={() => setSpaceStop(null)}>여기서 계속</button></span>}
          </Row>
        )}
        <Row icon={kind === "goal" ? <Flag className="size-4" /> : <Bell className="size-4" />} label={kind === "goal" ? "마감" : "알림"}>
          <div className="flex rounded-md bg-muted p-0.5" role="group" aria-label="종류">
            {(["todo", "goal"] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("rounded px-2.5 py-1 text-xs font-medium", kind === k ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>{k === "todo" ? "할 일" : "목표"}</button>)}
          </div>
          {kind === "goal"
            ? <input type="date" aria-label="마감일" aria-describedby={at ? "qa-at-ko" : undefined} className={cn(field, "num")} value={at?.slice(0, 10) ?? ""} onChange={(e) => setAtPick(e.target.value || null)} />
            : <input type="datetime-local" aria-label="알림 시각" aria-describedby={at ? "qa-at-ko" : undefined} className={cn(field, "num")} value={at && at.length > 10 ? at : at ? at + "T09:00" : ""} onChange={(e) => setAtPick(e.target.value || null)} />}
          {/* 입력 칸이 보여 주는 값 그대로를 한국어로(브라우저 로캘이 영어여도 헷갈리지 않게, GAP-09). 값은 바꾸지 않아요 */}
          {at && <span id="qa-at-ko" className="num text-xs text-muted-foreground">{koDateLabel(kind === "goal" ? at.slice(0, 10) : at.length > 10 ? at : at + "T09:00")}</span>}
          {kind === "todo" && W.quick().map((q) => <button key={q.k} type="button" className={chip(at === q.at)} onClick={() => setAtPick(q.at)}>{q.label}</button>)}
          {at && <Button type="button" variant="ghost" size="icon-xs" aria-label="날짜 지우기" onClick={() => setAtPick(null)}><X /></Button>}
        </Row>
        {!!board?.areas.length && (
          <Row icon={<Circle className="size-4" />} label="영역">
            {board.areas.map((a) => (
              <button key={a.id} type="button" aria-pressed={areaId === a.id} className={chip(areaId === a.id)} onClick={() => setAreaPick(areaId === a.id ? null : a.id)}>
                <span className="size-2 rounded-full" style={{ background: a.color }} />{a.name}
              </button>
            ))}
          </Row>
        )}
        {docs && (
          <Row icon={<Hash className="size-4" />} label="태그">
            {allTags.map((t) => (
              <span key={t} className="inline-flex h-7 items-center gap-1 rounded-md bg-muted pl-2.5 pr-1 text-xs">
                {t}
                {tags.includes(t) && <button type="button" aria-label={`${t} 태그 빼기`} className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setTags((v) => v.filter((x) => x !== t))}><X className="size-3" /></button>}
              </span>
            ))}
            <input value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={addTag} onKeyDown={(e) => { if (matches(e, "sheet.tag") && !composing(e.nativeEvent)) { e.preventDefault(); addTag() } }} placeholder="태그" aria-label="태그 추가" className={cn(field, "w-28")} />
          </Row>
        )}
        {docs && (
          <Row icon={<ListPlus className="size-4" />} label="속성">
            <div className="flex w-full flex-col gap-1.5">
              {props.map((p, i) => {
                const set = (patch: Partial<DraftProp>) => setProps((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                return (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <input value={p.key} onChange={(e) => set({ key: e.target.value })} placeholder="이름" aria-label="속성 이름" className={cn(field, "w-28")} />
                    <select value={p.type} onChange={(e) => set({ type: e.target.value as PropType, value: "" })} aria-label="속성 종류" className={field}>
                      {PROP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {p.type === "checkbox"
                      ? <input type="checkbox" aria-label="속성 값" checked={p.value === "true"} onChange={(e) => set({ value: String(e.target.checked) })} className="size-4" />
                      : <input value={p.value} onChange={(e) => set({ value: e.target.value })} type={p.type === "number" ? "number" : p.type === "date" ? "date" : p.type === "url" ? "url" : "text"} placeholder={p.type === "list" ? "쉼표로 나눠요" : "값"} aria-label="속성 값" className={cn(field, "min-w-0 flex-1")} />}
                    <Button type="button" variant="ghost" size="icon-xs" aria-label="속성 빼기" onClick={() => setProps((v) => v.filter((_, j) => j !== i))}><X /></Button>
                  </div>
                )
              })}
              <button type="button" className="self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setProps((v) => [...v, { key: "", type: "text", value: "" }])}>속성 추가</button>
            </div>
          </Row>
        )}
      </div>
      </fieldset>
      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SlotProblem slot={slot} />
          <EditConflictProblem edit={edit} onLoad={(e) => (e ? fillFromEdit(e) : resetFields())} />
          <EditSaveProblem edit={edit} extra={closeStop ? <><span className="text-muted-foreground">· 닫지 않았어요</span><button type="button" className="font-medium text-foreground hover:underline" onClick={closeUnsaved}>저장하지 않고 닫기</button></> : null} />
          {targetIssue && <p role="alert" className="text-xs text-destructive">{targetIssue}</p>}
          {failure ? <PendingNotice pending={failure} onOpen={onOpenWork} onDiscard={discard} />
            : restoredEdit && !draftCleared ? <p role="status" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">쓰던 초안을 이어서 보여 줘요<button type="button" className="font-medium text-foreground hover:underline" onClick={clearDraft}>쓰던 초안 버리기</button></p>
            : aiError ? <p role="alert" className="text-xs text-destructive">AI에게 맡기지 못했어요 · {aiError}</p>
            : same ? <SameWarning same={same} onOpen={onOpenWork} confirmed={confirm === normTitle(same.text)} /> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => requestOpen(false)}>{failure ? "닫기(기록 남김)" : "취소"}</Button>
          {captures.available && (
            <Button type="button" variant="outline" disabled={!aiReady} onClick={() => void askAi()} aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter" title="AI가 같은 일을 찾고 확인해서 다듬어 올려요">
              <AiMark className="size-3.5 text-ai" />AI로 정리해서 올리기
              <kbd className="num ml-1 hidden text-2xs opacity-60 sm:inline">⌘⇧↵</kbd>
            </Button>
          )}
          <Button type="button" disabled={!ready} onClick={() => void submit()} aria-keyshortcuts="Meta+Enter Control+Enter">
            {busy ? "추가하는 중…" : failure ? retryLabel(failure) : same && confirm ? "그래도 추가" : "추가"}
            {!busy && !failure && <kbd className="num ml-1 hidden text-2xs opacity-60 sm:inline">⌘↵</kbd>}
          </Button>
        </div>
      </div>
    </div>
  )

  const close = (e: Event) => { e.preventDefault(); onCloseFocus() }
  if (mobile) return (
    <Sheet open={open} onOpenChange={requestOpen}>
      <SheetContent side="bottom" showCloseButton={false} onCloseAutoFocus={close} className="max-h-[92svh] overflow-y-auto rounded-t-xl px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetTitle className="sr-only">빠른 추가</SheetTitle>
        <SheetDescription className="sr-only">제목을 쓰고 Enter 로 추가해요. 노트, 날짜, 영역, 태그, 속성은 아래에서 더해요</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  )
  return (
    <Dialog open={open} onOpenChange={requestOpen}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={close} className="top-[12vh] translate-y-0 gap-0 p-5 sm:max-w-xl">
        <DialogTitle className="sr-only">빠른 추가</DialogTitle>
        <DialogDescription className="sr-only">제목을 쓰고 Enter 로 추가해요. 노트, 날짜, 영역, 태그, 속성은 아래에서 더해요</DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  )
}
