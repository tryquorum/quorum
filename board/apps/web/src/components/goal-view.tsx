import { useEffect, useMemo, useRef, useState } from "react"
import { koDateLabel } from "@/lib/ko-date"
import { discardBothNote, draftAfterDoneNote, planDiscardBoth, runDiscardBoth } from "@/lib/quick-discard"
import { CHANGED_TEXT } from "@direction-board/contracts/slot-store"
import { toast } from "sonner"
import { ArrowRight, Calendar, Check, ChevronRight, Plus } from "lucide-react"
import { normTitle } from "@direction-board/contracts"
import { EditConflictProblem, EditSaveProblem, ReadyStall, ParsedChips, PendingNotice, SameWarning, SlotProblem, reportCreated, useQuickAdd, useQuickSubmit } from "@/components/quick-add"
import { TaskRow } from "@/components/task-row"
import { spaceOf } from "@/lib/spaces"
import { Button } from "@/components/ui/button"
import {
  computeGoalProgress,
  computeGoalState,
  dday,
  goalProgressBasis,
  goalStateLabel,
  linkedTodosForGoal,
  W,
  whenOf,
  type Board,
  type GoalState,
  type Item,
} from "@/lib/api"
import { assertNever, findSameOpen, goalTodoDraft, parseQuick } from "@/lib/quick-add"
import { inputLocked, inputReady, LOADING_TEXT, SAVE_FAILED, slotFor, type QuickEdit } from "@direction-board/contracts/quick-recovery"
import { confirmDiscard, useQuickEdit, useQuickSlot } from "@/lib/quick-slot"
import { toggleMain, useMainKeys, useSetDone, type Task } from "@/lib/tasks"
import { cn } from "@/lib/utils"

const stateBadgeClass = (state: GoalState) =>
  state === "late"
    ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20"
    : state === "done"
      ? "bg-muted text-muted-foreground"
      : "bg-done/10 text-done-foreground ring-1 ring-done/30"

function itemToTask(it: Item, boards: Board[], mainSet: Set<string>, now: number): Task {
  const key = `i:${it.boardId}:${it.id}`
  const at = whenOf(it)
  const area = boards.find((b) => b.id === it.boardId)?.areas.find((a) => a.id === it.area)
  return {
    key,
    ref: `item:${it.boardId}:${it.id}`,
    space: spaceOf(it),
    kind: "todo",
    title: (it.text || "(제목 없음)").split("\n")[0],
    at,
    when: it.remindAt ?? it.due ?? null,
    z: typeof it.z === "number" ? it.z : undefined,
    done: !!it.done,
    late: !it.done && at !== null && at < now,
    area: area ? { name: area.name, color: area.color } : null,
    source: "미리알림",
    main: mainSet.has(key),
    updatedAt: Number(it.updatedAt) || 0,
    item: it,
  }
}

/** 목표 페이지 상단 요약: 기한·남은 기간·상태·진행률 바·다음 행동 1개 강조·하위 할 일 목록·할 일 바로 추가(+) */
type GoalOverviewProps = Parameters<typeof GoalOverviewIn>[0]
/** 입력 상태는 범위 키로만(리뷰 18): 계정이 바뀌면 다시 그려 쓰던 글이 다른 범위로 넘어가지 않아요(그 범위의 편집 초안에 남아요) */
export function GoalOverview(props: GoalOverviewProps) {
  const { env } = useQuickAdd()
  return <GoalOverviewIn key={env.scope ?? "no-scope"} {...props} />
}

function GoalOverviewIn({
  workRef,
  items,
  boards,
  save,
  patchSignal,
  onOpen,
  onSubtaskAdded,
  linkedRefs,
}: {
  workRef: string
  items: Item[]
  boards: Board[]
  save: (it: Item) => Promise<boolean> | void
  patchSignal: (id: string, body: Record<string, unknown>) => Promise<void>
  onOpen: (ref: string) => void
  onSubtaskAdded?: () => void
  linkedRefs?: string[]
}) {
  const [, bid, gid] = workRef.split(":")
  const goal = items.find((i) => i.boardId === bid && i.id === gid && i.type === "goal")
  const board = boards.find((b) => b.id === bid)
  const [mainKeys, setMainKeys] = useMainKeys()
  const setDone = useSetDone(save, patchSignal)
  const { open: openQuickAdd, env } = useQuickAdd()
  // 복구 기록(lib/quick-slot.ts, 리뷰 16): 범위별 localStorage 의 "goal:<목표 id>" 자리. 지우는 길은 끝(done)과 사람의 버리기(확인창)뿐
  // 자리 = 목표 할 일 + 대상(그 목표의 판·목표, 리뷰 18)
  const scope = env.scope ?? null
  const slotName = slotFor("goal", { boardId: bid, goalId: gid })
  const slot = useQuickSlot(slotName, scope)
  const pending = slot.pending
  const edit = useQuickEdit(slotName, scope)
  const submitQuickAdd = useQuickSubmit(scope)
  const [text, setText] = useState(() => (inputLocked(pending) ? pending?.text : (edit.initial?.text ?? pending?.text)) ?? "")
  const editLocked = inputLocked(pending)
  // 규칙 G(PR #43 리뷰 4): 프로그램이 칸을 바꿀 때는 이것으로만 — 자동 저장이 그 값을 사람 편집처럼 쓰지 않아요
  const editOf = (t: string): QuickEdit => ({ text: t, boardId: bid, goalId: gid })
  const setByProgram = (t: string) => {
    setText(t)
    edit.adopt(editOf(t))
  }
  useEffect(() => {
    edit.adopt(editOf(text))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 그림의 칸(복원), 한 번
  }, [])
  useEffect(() => {
    if (!editLocked && scope) edit.change(editOf(text))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 글이 바뀔 때만
  }, [text, editLocked])
  // 열 때 기기 저장을 읽지 못해 막혀 있다가 다시 읽어 준비가 되면 그때 복원해요(그동안은 입력이 막혀 덮을 글이 없어요, 규칙 E)
  const storeReady = !!scope && slot.loaded && edit.ready
  const restoredAtOpen = useRef(storeReady)
  useEffect(() => {
    if (restoredAtOpen.current || !storeReady) return
    restoredAtOpen.current = true
    const t = inputLocked(pending) ? pending?.text : (edit.initial?.text ?? pending?.text)
    if (t) setByProgram(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 준비가 된 때 한 번만
  }, [storeReady])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  useEffect(() => {
    if (pending && !text) setByProgram(pending.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 기록을 처음 읽었을 때만
  }, [pending?.id])
  const [showDone, setShowDone] = useState(false)

  const linkedIds = useMemo(() => {
    const prefix = `item:${bid}:`
    return (linkedRefs ?? []).filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length))
  }, [bid, linkedRefs])

  const subtasks = useMemo(() => {
    if (!goal) return []
    const mainSet = new Set(mainKeys)
    const now = Date.now()
    return linkedTodosForGoal(goal, items, linkedIds).map((it) => itemToTask(it, boards, mainSet, now))
  }, [goal, items, linkedIds, boards, mainKeys])

  const openKeys = useMemo(
    () => new Set(items.filter((i) => !i.deleted && !i.done && (i.type === "todo" || i.type === "goal")).map((i) => `i:${i.boardId}:${i.id}`)),
    [items],
  )

  if (!goal) return null

  const progress = computeGoalProgress(goal, items, linkedIds)
  const basis = goalProgressBasis(goal, items, linkedIds)
  const state = computeGoalState(goal)
  const stateText = goalStateLabel(state)
  const dd = dday(goal.due)
  const area = board?.areas.find((a) => a.id === goal.area)
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : goal.done ? 100 : 0
  const openTodos = subtasks.filter((t) => !t.done)
  const doneTodos = subtasks.filter((t) => t.done)
  const nextAction = openTodos[0] ?? null
  const restOpenTodos = openTodos.slice(1)
  const star = (t: Task) => toggleMain(t, mainKeys, setMainKeys, openKeys)

  const parsed = text.trim() ? parseQuick(text, board?.areas ?? [], W.parse, board?.kind !== "company") : null
  // 결과를 모르거나 앞 단계가 저장됐거나 사람 값과 부딪친 기록이면 칸을 잠가요(버리기는 사람이)
  const frozen = inputLocked(pending)
  // 규칙 C(리뷰 21): 범위·대상(목표)·그 자리의 기록·편집 초안을 다 읽어 복원한 뒤에만 입력·제출
  const ready = inputReady({ scope: !!scope, target: !!goal, record: slot.loaded, edit: edit.ready, restored: true })
  const retrying = !!pending && (frozen || pending.text === text)
  const same = parsed && !retrying ? findSameOpen(items, goal.boardId, parsed.title, spaceOf(goal)) : null

  const submitSubtask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || !scope || !parsed || busy || !slot.ready) return
    const key = normTitle(parsed.title)
    if (same && confirm !== key) return setConfirm(key)
    // 목표의 판·영역·공간을 물려받아요(공간을 빠뜨리면 회사 판 새 항목이 첫 워크스페이스로 갔어요 — 서버도 goalId 로 물려받음)
    setBusy(true)
    try {
      // 제출한 초안 원문이 전제(PR #43 리뷰 3): 끝나면 그 원문일 때만 쓰던 글을 비워요
      const draftTarget = edit.planClear()
      const r = await submitQuickAdd(text, () => goalTodoDraft(goal, { title: parsed.title, at: parsed.at, areaId: parsed.area?.id, tags: parsed.tags }), pending, slot.writeAhead)
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
          onSubtaskAdded?.()
          return reportCreated(r.result, r.draft.title, onOpen)
        default:
          return assertNever(r)
      }
    } finally {
      setBusy(false)
    }
  }

  const openSheetForGoal = (from: HTMLElement) => {
    // 쓰던 글을 상세 시트로 옮기기: 이 자리에 먼저 저장된 뒤에만(규칙 D)
    if (!edit.flush()) return void toast(SAVE_FAILED)
    // 시트로 넘긴 원문이 전제: 시트에서 추가가 끝나면 그 원문일 때만 이 자리 쓰던 글을 비워요(규칙 G)
    const handoff = edit.planClear()
    openQuickAdd(text, from, () => { const cleared = edit.applyClear(handoff); setByProgram(cleared.r === "changed" ? (cleared.now?.text ?? "") : ""); setConfirm(null); onSubtaskAdded?.() }, goalTodoDraft(goal, { title: text, at: parsed?.at ?? null, areaId: parsed?.area?.id, tags: parsed?.tags ?? [] }))
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

  const failed = pending

  return (
    <section aria-label="목표 진행과 하위 할 일" className="mb-6 flex flex-col gap-4 rounded-xl border bg-card p-4">
      {/* 상단 메타·기한·진행률 바 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-md px-2 py-0.5 font-medium", stateBadgeClass(state))}>{stateText}</span>
        {area && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-foreground">
            <span className="size-2 rounded-full" style={{ background: area.color }} />
            {area.name}
          </span>
        )}
        <label className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 max-md:min-h-11 max-md:px-3 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3 text-muted-foreground hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
          <Calendar className="size-3.5" aria-hidden />
          <input
            type="date"
            aria-label="목표 기한"
            aria-describedby={goal.due ? "goal-due-ko" : undefined}
            value={goal.due ?? ""}
            onChange={(e) => { void save({ ...goal, due: e.target.value || null }) }}
            className="num bg-transparent text-xs outline-none max-md:min-h-11 [@media(pointer:coarse)]:min-h-11"
          />
          {goal.due && <span id="goal-due-ko" className="num text-foreground">{koDateLabel(goal.due)}</span>}
          {goal.due && (
            <span className={cn("num font-medium", dd.late && !goal.done ? "text-destructive" : "text-foreground")}>
              · {dd.t}
            </span>
          )}
        </label>
        <span className="num ml-auto text-xs font-medium text-muted-foreground">
          {progress.done}/{progress.total} 완료 · {pct}%
          {basis !== "linked" && <span className="font-normal" title={basis === "area" ? "이 목표에 붙인 할 일이 없어 같은 영역의 할 일을 세요. 목표 페이지에서 할 일을 추가하면 이 목표에 붙어요" : "이 목표에 붙인 할 일도, 영역도 없어요. 목표 페이지에서 할 일을 추가하면 이 목표에 붙어요"}> · {basis === "area" ? "영역 기준" : "붙인 할 일 없음"}<span className="sr-only">. {basis === "area" ? "이 목표에 붙인 할 일이 없어 같은 영역의 할 일을 세요. 목표 페이지에서 할 일을 추가하면 이 목표에 붙어요" : "이 목표에 붙인 할 일도, 영역도 없어요. 목표 페이지에서 할 일을 추가하면 이 목표에 붙어요"}</span></span>}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="목표 진행률"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full transition-all", state === "late" ? "bg-destructive" : "bg-done")}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* 다음 행동 1개 강조 */}
      {nextAction ? (
        <div data-goal-next-action className="rounded-lg border border-foreground/15 bg-muted/40 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold text-foreground">
            <ArrowRight className="size-3.5 text-done-foreground" aria-hidden />
            <span>다음 행동</span>
          </div>
          <ul className="flex flex-col">
            <TaskRow t={nextAction} onOpen={onOpen} onDone={setDone} onStar={star} />
          </ul>
        </div>
      ) : progress.total > 0 && progress.done === progress.total ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-done/10 px-3 py-2 text-xs text-done-foreground">
          <span className="flex items-center gap-1.5 font-medium"><Check className="size-3.5" />연결된 할 일을 모두 끝냈어요</span>
          {!goal.done && (
            <Button size="xs" variant="outline" onClick={() => { void save({ ...goal, done: true }) }}>
              목표 완료
            </Button>
          )}
        </div>
      ) : null}

      {/* 나머지 열린 하위 할 일 목록 */}
      {restOpenTodos.length > 0 && (
        <div>
          <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">
            이어서 할 일 <span className="num">{restOpenTodos.length}</span>
          </div>
          <ul className="flex flex-col divide-y divide-border/60">
            {restOpenTodos.map((t) => (
              <TaskRow key={t.key} t={t} onOpen={onOpen} onDone={setDone} onStar={star} />
            ))}
          </ul>
        </div>
      )}

      {/* 목표에 연결되는 할 일 바로 추가 (+) */}
      <form onSubmit={submitSubtask} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            value={text}
            readOnly={busy || frozen}
            disabled={!ready}
            aria-busy={busy}
            onChange={(e) => { setText(e.target.value); setConfirm(null) }}
            placeholder={ready ? "이 목표의 할 일 추가" : LOADING_TEXT}
            aria-label="이 목표의 할 일 추가"
            className="h-9 max-md:h-11 [@media(pointer:coarse)]:h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!ready || !parsed || busy}>
            <Plus className="size-3.5" />추가
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="목표 할 일 자세히 추가" title="자세히 추가" disabled={!ready || busy || !!failed} onClick={(e) => openSheetForGoal(e.currentTarget)}>
            <Plus />
          </Button>
        </div>
        <ReadyStall waiting={!scope ? "로그인 정보" : null} retry={env.retry} />
        <SlotProblem slot={slot} />
        <SlotProblem slot={edit} what="쓰던 초안" />
        <EditSaveProblem edit={edit} />
        <EditConflictProblem edit={edit} onLoad={(e) => setByProgram(e?.text ?? "")} />
        {failed ? (
          <PendingNotice pending={failed} onOpen={onOpen} onDiscard={discard} hint="Enter 로" />
        ) : same ? (
          <SameWarning same={same} onOpen={onOpen} confirmed={!!parsed && confirm === normTitle(parsed.title)} />
        ) : (
          <ParsedChips parsed={parsed} />
        )}
      </form>

      {/* 끝낸 하위 할 일 */}
      {doneTodos.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", showDone && "rotate-90")} />
            끝낸 할 일 <span className="num">{doneTodos.length}</span>
          </button>
          {showDone && (
            <ul className="mt-1 flex flex-col divide-y divide-border/60">
              {doneTodos.map((t) => (
                <TaskRow key={t.key} t={t} onOpen={onOpen} onDone={setDone} onStar={star} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
