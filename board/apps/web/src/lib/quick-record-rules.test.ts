import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// PR #39 리뷰 16 고정 시험(웹·iOS 모든 빠른 추가 화면): 기록·초안을 지우는 길은 끝(done)과 사람의 버리기(확인창)뿐이고,
// 닫기·뒤로·화면 내리기·새로고침은 아무것도 지우지 않아요. 기록은 화면 상태가 아니라 범위별 저장(웹 localStorage·iOS 기기 저장)에 있어요.
const ROOT = join(import.meta.dir, "../../../..")
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")
const SCREENS = [
  "apps/web/src/components/quick-add.tsx",
  "apps/web/src/components/quick-add-sheet.tsx",
  "apps/web/src/components/goal-view.tsx",
  "apps/mobile/src/features/board/quick/QuickAddBar.tsx",
  "apps/mobile/src/features/board/quick/QuickAddSheet.tsx",
  "apps/mobile/src/features/board/work/GoalOverview.tsx",
]
const lines = (src: string) => src.split("\n")
// const discard = (async )() => { … } 안의 줄이고, 그 discard 는 확인창 안(onDiscard={discard}·confirmDiscard(() => void discard()))에서만 불러요
function viaDiscard(src: string, ls: string[], i: number): boolean {
  // 함수 머리는 바로 위 줄(사이에 주석·결과 확인 줄이 몇 줄 있어도 돼요 — 규칙 F 의 const r = … 처럼)
  const head = ls.slice(Math.max(0, i - 4), i).reverse().find((x) => !/^\s*(\/\/|const r = |if \(r === )/.test(x))
  if (!/^\s*const discard = (async )?\(\) => \{\s*$/.test(head ?? "")) return false
  const uses = src.match(/(?<![.\w])discard\b(?! = )/g)?.length ?? 0
  const safe = (src.match(/onDiscard=\{discard\}/g)?.length ?? 0) + (src.match(/confirmDiscard\(\(\) => void discard\(\)\)/g)?.length ?? 0)
  return uses > 0 && uses === safe
}

describe("빠른 추가 기록은 done·사람 버리기 밖의 길로 지워지지 않아요", () => {
  for (const f of SCREENS)
    test(f, () => {
      const src = read(f)
      // 기록은 영속 자리(웹 useQuickSlot·iOS usePendingSlot)에서만 — 화면 상태(useState)로 두지 않아요
      expect(/useQuickSlot\(|usePendingSlot\(/.test(src)).toBe(true)
      expect(src.match(/useState<[^>]*Pending/)?.[0] ?? null).toBeNull()
      // 옛 setter 로 지우는 길이 없어요
      expect(src.match(/set(Pending|Failure)\(/)?.[0] ?? null).toBeNull()
      const ls = lines(src)
      ls.forEach((l, i) => {
        // done 은 끝난 결과(case "done")에서만
        if (/slot\.done\(/.test(l)) expect(ls.slice(Math.max(0, i - 14), i).some((x) => /case ["']done["']/.test(x))).toBe(true)
        // discard 는 확인창 안에서만(웹 PendingNotice 의 onDiscard 는 그 안에서 확인창을 거쳐요).
        // 규칙 D(리뷰 21)로 결과를 보려고 discard 함수로 묶었으면 그 함수는 확인창 안에서만 불러요(viaDiscard)
        if (/slot\.discard\b/.test(l)) expect(/confirmDiscard\(|onDiscard=/.test(l) || viaDiscard(src, ls, i)).toBe(true)
      })
    })
  test("웹 PendingNotice 는 확인창을 거친 뒤에만 onDiscard, 깨진 기록 버리고 새로도 확인창", () => {
    const src = read("apps/web/src/components/quick-add.tsx")
    // 남은 기록 버리기(PR #43 리뷰 3): 단추는 onDiscard 로, 화면의 discard 가 계획(기록·쓰던 초안) → 그 글의 확인창 → 대상마다 실행
    expect(src).toContain('onClick={onDiscard}>버리기</button>')
    for (const f of ["apps/web/src/components/quick-add.tsx", "apps/web/src/components/quick-add-sheet.tsx", "apps/web/src/components/goal-view.tsx"]) expect([f, /const plan = planDiscardBoth\(slot, edit\)\s*if \(!plan\) return void toast\(CHANGED_TEXT\)\s*if \(!confirmDiscard\("이 기록", plan\.message\)\) return\s*const x = runDiscardBoth\(slot, edit, plan\)/.test(read(f))]).toEqual([f, true])
    // 깨진 기록 버리고 새로(규칙 F): 누를 때 계획 → 확인창은 그 계획의 글 → 확인하면 그 계획만 실행
    expect(src).toContain("const p = slot.plan?.()")
    expect(src).toContain("if (!confirmDiscard(what, p.message)) return")
    expect(src).toContain("const r = slot.apply?.(p)")
    expect(src).toContain('what = "복구 기록"')
  })
  test("기록 훅은 done·discard 안에서만 그 자리를 비워요(언마운트·정리 함수에서 지우지 않음), discard 는 보인 기록만(규칙 F)", () => {
    for (const f of ["apps/web/src/lib/quick-slot.ts", "apps/mobile/src/features/board/quick/pendingSlot.ts"]) {
      const src = read(f)
      // done 만 put(null), 버리기는 계획(보인 기록이 지금도 그 자리에 있을 때만 그 자리를 비움)
      expect(src.match(/put\(null\)/g)?.length).toBe(1)
      expect(/const done = useCallback\([\s\S]*?put\(null\)/.test(src)).toBe(true)
    }
    // 버리기는 보인 기록(mine·shown)을 전제로 한 대상과 비교-후-쓰기 실행(PR #43 리뷰 3)
    const web = read("apps/web/src/lib/quick-slot.ts")
    expect(web).toMatch(/const planDiscard = useCallback\(\(\): WebTarget \| null => \{[\s\S]*?planRecordDiscard\([\s\S]*?mine, ""\)/)
    expect(web).toMatch(/const run = useCallback\(\(t: WebTarget\): PlanResult => \{[\s\S]*?compareAndWrite\(storage, t\)/)
    const ios = read("apps/mobile/src/features/board/quick/pendingSlot.ts")
    expect(ios).toContain("const planDiscard = useCallback(async () => (shown ? planShown(shown) : null), [shown, planShown])")
    expect(ios).toContain("return runTarget(t)")
  })
  test("iOS 상세 시트의 뒤로·닫기는 기록이 있으면 결과 종류와 무관하게 확인, 닫기는 기록을 남겨요", () => {
    const src = read("apps/mobile/src/features/board/quick/QuickAddSheet.tsx")
    const listener = src.slice(src.indexOf("addListener('beforeRemove'"), src.indexOf("const input ="))
    expect(listener).toContain("closeGuard(")
    expect(listener).toContain("{ text: '버리기', style: 'destructive', onPress: () => void askRef.current(editRef.current, () => { failureRef.current = null; leave() }) }")
    expect(src).toMatch(/const askDiscard = async \(ed: typeof edit, after: \(kept: boolean\) => void\) => \{\s*const plan = await planDiscardBoth\(slot, ed\)\s*if \(!plan\) return toast\(CHANGED_TEXT\)\s*confirmDiscard\(/)
    const guard = read("packages/contracts/src/quick-recovery.ts")
    expect(guard).toContain("!p ? null :")
  })
  test("웹 시트를 다시 열면 저장에서(편집 초안이 먼저, 잠긴 기록이면 기록의 초안) — 새 key 로 마운트돼도 저장에서 읽어요", () => {
    const src = read("apps/web/src/components/quick-add-sheet.tsx")
    expect(src).toContain("useQuickSlot(slotName, openScope)")
    expect(src).toContain("useQuickEdit(slotName, openScope)")
    // 열 때 그 대상 자리에서 읽어 복원(리뷰 20 — 자리는 그다음부터 지금 고른 대상에서 나와요)
    expect(src).toContain("const opened = useRef(peekSlot(openScope, openSlot)).current")
    expect(src).toContain("restoreSource(opened.record, opened.edit)")
  })
})

describe("결과 불명 확인 경로는 쓰기 0건(공용 흐름)", () => {
  test("확인은 checkCreate(읽기)로만 — 웹·iOS 가 같은 submitWithRecord", () => {
    const flow = read("packages/contracts/src/quick-recovery.ts")
    const branch = flow.slice(flow.indexOf("checkOnly(a.pending)"), flow.indexOf("const draft = plan.kind"))
    expect(branch).toContain("a.check(a.pending)")
    expect(branch).not.toContain("a.create(")
    expect(branch).not.toContain("writeAhead")
    expect(read("apps/web/src/lib/quick-slot.ts")).toContain("check: checkWith(call)")
    expect(read("apps/mobile/src/features/board/quick/createScoped.ts")).toContain("submitWithRecord(")
  })
})

// PR #39 리뷰 17: 편집 중 초안은 제출 기록과 따로 저장되고(닫기·화면 내리기·pagehide 에 바로), 지우는 길은 done·버리기·AI 정리로 옮김·쓰던 초안 버리기(확인창)뿐.
describe("편집 중 초안(리뷰 17)", () => {
  for (const f of SCREENS)
    test(f, () => {
      const src = read(f)
      expect(/useQuickEdit\(|useEditSlot\(/.test(src)).toBe(true)
      expect(src).toContain("edit.change(")
      const ls = lines(src)
      ls.forEach((l, i) => {
        if (!/edit\.clear\(\)/.test(l)) return
        const before = ls.slice(Math.max(0, i - 8), i).join("\n")
        // 옮기기(리뷰 20 웹 시트 공간 바꾸기): 새 자리에 저장된 뒤에만(if (!putEditNow(…)) return …) 옛 자리를 비워요
        const ok = /confirmDiscard\(|onDiscard=/.test(l) || viaDiscard(src, ls, i) || /case ["']done["']/.test(before) || /const done = (async )?\(|if \(!r\.ok\) return setAiError|confirmDiscard\("쓰던 초안"\)|const clearDraft = \(\) =>\s*$|^\s*if \(!putEditNow\(.*\)\) return /m.test(ls.slice(Math.max(0, i - 3), i).join("\n"))
        expect([f, i + 1, ok]).toEqual([f, i + 1, true])
      })
    })
  test("편집 훅은 닫기·화면 내리기에 지우지 않고 바로 저장(웹 pagehide·iOS 앱이 뒤로)", () => {
    const web = read("apps/web/src/lib/quick-slot.ts")
    expect(web).toContain('window.addEventListener("pagehide", onHide)')
    expect(web).toMatch(/flush\(\) \/\/ 닫기·화면 내리기/)
    const ios = read("apps/mobile/src/features/board/quick/editSlot.ts")
    expect(ios).toContain("AppState.addEventListener")
    expect(ios).toMatch(/flush\(\) \/\/ 닫기·화면 내리기/)
  })
  test("끝난 뒤 기록 지우기 실패는 호출자가 알려요(웹 done 은 참·거짓)", () => {
    for (const f of SCREENS.slice(0, 3)) expect(read(f)).toContain("if (!slot.done(r.result))")
  })
})

// PR #39 리뷰 17: 서버가 마지막 관문 — 웹 빠른 추가·iOS 범위 고정 클라이언트의 모든 쓰기에 시작 범위의 주체(X-Direction-Expect-User)
describe("쓰기에 시작 범위의 주체를 밝혀요(리뷰 17)", () => {
  test("웹: 항목 저장(saveKnown)·노트·태그·속성(unknownWrites) 모두", () => {
    const slot = read("apps/web/src/lib/quick-slot.ts")
    expect(slot).toContain("[EXPECT_USER]: expectUser")
    expect(slot).toContain("a.save(it, { expectUser })")
    expect(read("apps/web/src/hooks/use-data.ts")).toContain("[EXPECT_USER]: opts.expectUser")
  })
  test("iOS: 범위 고정 클라이언트의 write·upload 모두, 409 scope-changed 는 ScopeChangedError", () => {
    const c = read("apps/mobile/src/api/client.ts")
    expect(c).toContain("writeNow(origin, path, method, body, expect)")
    expect(c).toContain("...expect } }))")
    expect(c).toContain("response.status === 409 && text === 'scope-changed'")
  })
  test("서버: 헤더가 있는 쓰기만 인증 주체와 비교(헤더 없으면 그대로)", () => {
    expect(read("apps/server/server.ts")).toContain('if (scopeChanged(req, u.email)) return err(409, "scope-changed")')
  })
})

// PR #39 리뷰 18: 입력 상태(쓰던 글·초안)는 범위·대상 키로만 — 계정·판이 바뀌면 다시 그려 다른 범위·대상으로 넘어가지 않고,
// 범위를 모르는 동안(null)은 입력·제출을 막아요. 기록·편집 초안의 자리는 자리 + 대상(판·목표·공간, slotFor).
describe("입력 상태는 범위·대상 키로만(리뷰 18)", () => {
  test("웹 한 줄: 범위|대상 키로 다시 그리고, 범위가 없으면 입력·제출 막힘", () => {
    const src = read("apps/web/src/components/quick-add.tsx")
    expect(src).toContain('<QuickAddBarIn key={(scope ?? "no-scope") + "|" + slotName}')
    expect(src).toContain('slotFor("bar", { boardId, space })')
    expect(src).toContain("disabled={!ready}")
    expect(src).toContain("if (!ready || !scope || !boardId || !parsed || busy || !slot.ready) return")
    expect(src).toContain('key={sheet.key + "|" + (env.scope ?? "no-scope")}')
  })
  test("웹 목표 할 일: 범위 키로 다시 그리고 대상 자리, 범위가 없으면 막힘", () => {
    const src = read("apps/web/src/components/goal-view.tsx")
    expect(src).toContain('<GoalOverviewIn key={env.scope ?? "no-scope"} {...props} />')
    expect(src).toContain('slotFor("goal", { boardId: bid, goalId: gid })')
    expect(src).toContain("disabled={!ready}")
  })
  test("웹 시트: 연 때의 대상 자리, 복원한 대상(판) 그대로, 대상이 없으면 제출 막힘", () => {
    const src = read("apps/web/src/components/quick-add-sheet.tsx")
    expect(src).toContain('slotFor("sheet", {')
    // 판은 지금 고른 공간에서(리뷰 19), 목표 시트는 목표의 판. 자리는 지금 대상에서 나와요(리뷰 20) — 기록이 있는 동안은 공간을 못 바꿔 기록의 대상 그대로
    expect(src).toContain("const boardId = forGoal && start ? start.boardId : boardForSpace(boards, viewBoard, space)")
    expect(src).toContain('const slotName = slotFor("sheet", { boardId, goalId, space: targetSpace })')
    expect(src).toContain("if (next === space || failure) return")
    expect(src).toContain("disabled={!!failure}")
    // 새 자리에 초안·기록이 있으면 덮지 않고 멈춰요
    expect(src).toContain("if (there.record || there.edit) {")
    expect(src).toContain("disabled={locked || !prepared}")
    const provider = read("apps/web/src/components/quick-add.tsx")
    expect(provider).toContain('prefill={sameSheetScope ? sheet.prefill : ""}')
    expect(provider).toContain("if (sameSheetScope) created.current?.()")
    expect(src).toContain("!!openScope && !targetIssue")
  })
  test("iOS: 범위가 바뀌면 화면 나무 전체를 다시 그리고(api/query.ts), 한 줄은 대상 키로, 시트·목표는 대상 자리·대상 적용", () => {
    expect(read("apps/mobile/src/api/query.ts")).toContain("React.createElement(React.Fragment, { key: gen.current.value }, children)")
    const bar = read("apps/mobile/src/features/board/quick/QuickAddBar.tsx")
    expect(bar).toContain("<QuickAddBarIn key={slotName} slotName={slotName} targetReady={ready} />")
    const sheet = read("apps/mobile/src/features/board/quick/QuickAddSheet.tsx")
    expect(sheet).toContain("slotFor('sheet', {")
    expect(sheet).toContain("const t = { boardId: d.boardId, goalId: d.goalId ?? null, space: d.space ?? null }")
    expect(sheet).toContain("setTgt(t)")
    expect(sheet).toContain("...(t.space ? { space: t.space } : {})")
    expect(sheet).toContain("failureReady && !targetIssue")
    expect(read("apps/mobile/src/features/board/work/GoalOverview.tsx")).toContain("slotFor('goal', { boardId: goal.boardId, goalId: goal.id })")
  })
  test("화면은 대상 없는 자리 이름(문자 그대로 'bar'·'sheet')을 쓰지 않아요", () => {
    for (const f of SCREENS) expect(read(f).match(/use(QuickSlot|QuickEdit|PendingSlot|EditSlot)\(["'](bar|sheet)["']/)?.[0] ?? null).toBeNull()
  })
  // PR #39 리뷰 20: 자리는 "지금 대상"에서 나와요. iOS 시트엔 공간 고르기가 없지만, 보고 있는 판(기기에 고른 판)을 늦게 읽으면
  // 연 때 고정한 자리(기본 판)와 실제로 보내는 판이 달라져 기록이 다른 자리에 남을 수 있어요 — 자리를 지금 대상에서 만들고, 대상이 정해진 뒤에만 복원해요
  test("iOS 시트: 자리는 지금 대상(판·목표·공간)에서, 대상(고른 판·판 목록)을 다 읽은 뒤에만 복원, 편집 초안은 그 자리를 읽은 뒤에만 준비", () => {
    const sheet = read("apps/mobile/src/features/board/quick/QuickAddSheet.tsx")
    expect(sheet).toContain("const slotName = slotFor('sheet', { boardId: boardId ?? null, goalId: tgt.goalId, space: tgt.space })")
    expect(sheet).not.toContain("useRef(slotFor('sheet'")
    expect(sheet).toContain("if (!targetReady || !boardId || !slot.loaded || !edit.ready || restored.current) return")
    expect(read("apps/mobile/src/features/board/parts.tsx")).toContain("ready: pickReady && !!board.data")
    const edit = read("apps/mobile/src/features/board/quick/editSlot.ts")
    // 편집 초안 준비 = 기기 저장을 잘 읽음(규칙 E, 리뷰 22 — 읽는 중·읽기 실패·깨짐이면 아님)
    expect(edit).toContain("const { ok, value, issue, okNow, run, names, seenBoth, runQuiet } = useSlotStore(EDIT_DRAFTS, slot)")
  })
})

// PR #39 리뷰 21: 규칙 C "입력 가능 = 준비 완료"와 규칙 D "저장 실패면 화면 상태를 바꾸지 않음"을 웹·iOS 빠른 추가 세 화면에 고정해요.
// 동작은 웹 quick-add-dom.test.ts·iOS quickInput.dom.test.tsx 가 실제 컴포넌트로 봐요. 여기서는 모든 화면이 같은 장치를 쓰는지(빠진 화면이 없게)
describe("규칙 C: 입력 가능 = 준비 완료(리뷰 21)", () => {
  const INPUT: Record<string, RegExp[]> = {
    "apps/web/src/components/quick-add.tsx": [/disabled=\{!ready\}/, /const ready = inputReady\(\{ scope: !!scope, target: !!boardId, record: slot\.loaded, edit: edit\.ready/],
    "apps/web/src/components/quick-add-sheet.tsx": [/<fieldset disabled=\{locked \|\| !prepared\}/, /const prepared = inputReady\(\{ scope: !!openScope, target: !!boardId, record: slot\.loaded, edit: edit\.ready/],
    "apps/web/src/components/goal-view.tsx": [/disabled=\{!ready\}/, /const ready = inputReady\(\{ scope: !!scope, target: !!goal, record: slot\.loaded, edit: edit\.ready/],
    "apps/mobile/src/features/board/quick/QuickAddBar.tsx": [/editable=\{ready && /, /const ready = inputReady\(\{ scope: true, target: targetReady && !!current, record: slot\.loaded, edit: edit\.ready, restored \}\)/],
    "apps/mobile/src/features/board/quick/QuickAddSheet.tsx": [/const locked = busy \|\| !!frozen \|\| !prepared/, /const prepared = inputReady\(\{ scope: true, target: targetReady && !!boardId, record: slot\.loaded, edit: edit\.ready, restored: restoredDone \}\)/],
    "apps/mobile/src/features/board/work/GoalOverview.tsx": [/editable=\{ready && /, /const ready = inputReady\(\{ scope: true, target: true, record: slot\.loaded, edit: edit\.ready, restored \}\)/],
  }
  for (const f of SCREENS)
    test(f, () => {
      const src = read(f)
      for (const re of INPUT[f]!) expect([f, re.source, re.test(src)]).toEqual([f, re.source, true])
      // 입력칸은 모두 준비 판정으로 막아요(iOS 시트의 칸은 모두 locked 로)
      if (f.endsWith("mobile/src/features/board/quick/QuickAddSheet.tsx")) for (const m of src.match(/editable=\{[^}]*\}/g) ?? []) expect(m).toBe("editable={!locked}")
      // 복원 뒤에 기록을 칸에 다시 넣는 옛 효과([pending?.id])가 iOS 에 없어요(복원이 입력을 덮던 길)
      if (f.includes("mobile")) expect(src.includes("}, [pending?.id])")).toBe(false)
    })
  test("판정은 계약 하나(inputReady) — 웹·iOS 가 같은 함수", () => {
    expect(read("packages/contracts/src/quick-recovery.ts")).toContain("export const inputReady = (s: { scope: boolean; target: boolean; record: boolean; edit: boolean; restored: boolean }) => s.scope && s.target && s.record && s.edit && s.restored")
  })
})

describe("규칙 D: 저장 실패면 화면 상태를 바꾸지 않음(리뷰 21)", () => {
  test("편집 초안 훅: flush·clear 는 성공 여부를 돌려주고 실패면 밀린 값을 버리지 않아요(웹·iOS), 기록 훅의 keep·discard 도", () => {
    const web = read("apps/web/src/lib/quick-slot.ts")
    expect(web).toContain("flush: () => boolean")
    // 비우기는 비교-후-쓰기(PR #43 리뷰 3): 바뀜·busy·실패면 밀린 값을 내려놓지 않아요(done·changed 에서만)
    expect(web).toContain("applyClear: (t: WebTarget | null) => { r: PlanResult; now: QuickEdit | null }")
    // 자동 저장이 닿았을 때만 밀린 값을 내려놓고, 실패·충돌이면 그대로(규칙 D·G)
    expect(web).toMatch(/if \(r === "done"\) \{\s*base\.current = [^\n]*\n\s*queued\.current = null/)
    expect(web).toContain("setFailed(true) // 실패하면 밀린 값을 그대로 둬요")
    expect(web).toMatch(/if \(r === "done"\) \{\s*queued\.current = null/)
    const ios = read("apps/mobile/src/features/board/quick/editSlot.ts")
    expect(ios).toContain("flush: () => Promise<boolean>")
    expect(ios).toContain("applyClear: (t: CasTarget<string> | null) => Promise<{ r: PlanResult; now: QuickEdit | null }>")
    expect(ios).toMatch(/if \(r === 'done'\) \{\s*base\.current = [^\n]*\n\s*mark\(true\)\n\s*markRead\(false\)\n\s*if \(queued\.current === next\) \{\s*queued\.current = null/)
    expect(ios).toMatch(/if \(r === 'done'\) \{\s*queued\.current = null/)
    expect(web).toContain("keep: (p: Pending) => boolean")
    expect(web).toContain("planDiscard: () => WebTarget | null")
    const slot = read("apps/mobile/src/features/board/quick/pendingSlot.ts")
    expect(slot).toContain("keep: (p: Pending) => Promise<boolean>")
    expect(slot).toContain("planDiscard: () => Promise<CasTarget<string> | null>")
  })
  for (const f of SCREENS)
    test(f, () => {
      const src = read(f)
      const ls = lines(src)
      ls.forEach((l, i) => {
        // flush·clear·discard·keep 의 결과를 버리지 않아요: if (!…)·!(await …)·.then( 로 이어져요(알림의 "다시 저장"만 결과를 화면이 보여 줘요)
        for (const m of l.match(/\b(edit\.(flush|clear)|slot\.(discard|keep))\([^)]*\)/g) ?? []) {
          // 규칙 F: const r = (await) slot.discard() 뒤 줄에서 바뀜(changed)·실패(done 아님)를 나눠 봐요
          const next = ls.slice(i + 1, i + 3).join("\n")
          const viaResult = (l.includes("const r = " + m) || l.includes("const r = await " + m)) && /r === ["']changed["']/.test(next) && /r !== ["']done["']/.test(next)
          const checked = viaResult || l.includes("if (!" + m) || l.includes("|| !" + m) || l.includes("!(await " + m + ")") || l.includes(m + ".then(") || (m === "edit.flush()" && l.includes("() => void edit.flush()"))
          expect([f, i + 1, m, checked]).toEqual([f, i + 1, m, true])
        }
      })
      // 저장 실패 안내를 보여요
      expect(/<EditSaveProblem |<EditSaveNotice /.test(src)).toBe(true)
    })
  test("웹 시트 닫기는 저장된 뒤에만(Dialog·Sheet·취소 모두 requestOpen), iOS 시트 뒤로·끌어내림은 먼저 저장(실패면 닫지 않음)", () => {
    const web = read("apps/web/src/components/quick-add-sheet.tsx").split("function QuickAddSheetIn(")[1]!
    expect(web.match(/onOpenChange=\{requestOpen\}/g)?.length).toBe(2)
    expect(web).toContain("if (!edit.flush()) return setCloseStop(true)")
    expect(web).not.toContain("onOpenChange={onOpenChange}")
    expect(web).toContain("if (!edit.flush()) return setSpaceStop({ space: next, text: SAVE_FAILED, go: false })")
    const ios = read("apps/mobile/src/features/board/quick/QuickAddSheet.tsx")
    const listener = ios.slice(ios.indexOf("addListener('beforeRemove'"), ios.indexOf("const input ="))
    expect(listener).toContain("if (!message && !ed.unsaved()) return")
    expect(listener).toContain("void ed.flush().then((ok) => {")
  })
})

// PR #39 리뷰 22: 규칙 E "읽기 실패 ≠ 빈 값". 모든 기기 저장 기본 요소는 읽는 중·잘 읽음·읽기 실패·깨짐을 나누고, 잘 읽음이 아니면
// 준비 완료가 아니에요(입력·제출·자동 저장·자동 삭제 없음) + 안내 + 다시 읽기(실제로 다시 읽음) + 버리고 새로(확인창).
// 동작은 웹 quick-add-dom.test.ts·iOS quickInput.dom.test.tsx·smallStore.test.ts 의 "규칙 E" 표 시험이 봐요. 여기서는 빠진 기본 요소가 없게
describe("규칙 E: 읽기 실패 ≠ 빈 값(리뷰 22)", () => {
  test("iOS SmallStore: 잘 읽기 전·읽기 문제면 쓰지 않고(set false), 덮는 길은 사람이 고른 reset 뿐", () => {
    const src = read("apps/mobile/src/features/board/smallStore.ts")
    expect(src).toContain("if (this.status(name) !== 'ok') return false")
    // 규칙 F(PR #43 리뷰 2): 무조건 덮는 초기화는 없어요 — 계획 실행(apply)은 같은 줄에서 전제를 다시 읽어 같을 때만 그 한 곳에 쓰고, 쓰기가 닿은 뒤에만 문제를 지워요
    expect(src).not.toContain("reset<T>(")
    expect(src).toContain("apply(plan: StorePlan): Promise<PlanResult> {")
    expect(src).toMatch(/for \(const \[i, x\] of plan\.premises\.entries\(\)\) if \(!premiseHolds\(plan, i, await this\.seeNow\(x\.key\)\)\) return 'changed'\s*await this\.writeIO\(target, JSON\.stringify\(plan\.write\.value\)\)/)
    expect(src).toMatch(/if \(r === 'done'\) \{[\s\S]*?this\.problems\.delete\(target\)[\s\S]*?if \(r === 'failed'\) \{\s*this\.resetFails\.add\(target\)/)
    // 시간 상한(PR #43 리뷰 2 P2): 입출력마다 상한, 끝나지 않은 쓰기가 있으면 다음 쓰기를 보내지 않아요
    expect(src).toContain("private timed<T>(p: Promise<T>): Promise<T> {")
    expect(src).toContain("if (before) await this.timed(before)")
    // 한 줄 대기열(PR #43 리뷰): 읽기·쓰기도 같은 줄, 실행 중에는 쓰기·다시 읽기가 닫히고 늦은 읽기 결과는 세대로 버려요
    expect(src).toContain("p = this.line(name, () => this.readIO(name))")
    expect(src).toContain("await this.line(name, () => this.writeIO(name, text))")
    expect(src).toContain("if (!this.loaded.has(name) || this.resets.has(name)) return 'loading'")
    expect(src).toContain("if (reset) return reset.then(() => undefined)")
    expect(src).toContain("const stale = () => gen !== this.gen(name)")
    expect(src).toContain("if (!this.set(name, value)) return false")
    // 다시 읽기는 오류 상태를 지우고 실제로 다시 읽고, 시작을 바로 알려요(PR #43 리뷰 P2)
    expect(src).toMatch(/reload<T>[\s\S]*?this\.problems\.delete\(name\)[\s\S]*?const p = this\.load\(name, check\)\s*this\.notify\(name\)/)
    const gate = read("apps/mobile/src/features/board/storeGate.ts")
    expect(gate).toContain("plan: async () => planFileDiscard({ key: name, seen: await store.see(name) }, check, empty, label, split),")
    expect(gate).toContain("apply: (p: StorePlan) => store.apply(p),")
    expect(gate).toContain("ok: ready && !problem")
    // 버리고 새로는 확인창 뒤에만, 확인창 글은 그 계획의 글, 실행은 그 계획만
    expect(read("apps/mobile/src/features/board/quick/SlotIssueNotice.tsx")).toContain("confirmDiscard(() => void issue.apply?.(p).then((r) => setNote(r === 'changed' ? CHANGED_TEXT : r === 'failed' ? SAVE_FAILED : null)), p.message)")
  })
  test("iOS 기본 요소 모두 같은 장치: 기록·쓰던 초안·AI 정리 칩·보낸 요청·지금 판·화면 설정(useStored)", () => {
    expect(read("apps/mobile/src/features/board/quick/pendingSlot.ts")).toContain("loaded: s.ok, ready: s.ok")
    const edit = read("apps/mobile/src/features/board/quick/editSlot.ts")
    expect(edit).toContain("return { ready: ok, initial, issue, failed, readFailed, unsaved, change, flush, planClear, applyClear, adopt, conflict, takeTheirs, keepMine }")
    expect(edit).toContain("if (!okNow()) return false")
    expect(edit).toMatch(/const change = useCallback\(\s*\(e: QuickEdit \| null\) => \{\s*if \(!okNow\(\)\) return/)
    expect(read("apps/mobile/src/features/board/quick/useCaptures.ts")).toContain("problem\n        ? null")
    const intents = read("apps/mobile/src/features/board/useIntents.ts")
    expect(intents).toContain("useStoreGate(INTENTS, isIntents, EMPTY, '보낸 요청', splitIntents)")
    const parts = read("apps/mobile/src/features/board/parts.tsx")
    expect(parts).toContain("const pickGate = useStoreGate('board', isPick, null, '지금 판')")
    expect(parts).toContain("ready: pickReady && !!board.data, issue")
    const hook = read("apps/mobile/src/features/board/storedHook.ts")
    expect(hook).toContain("return [value, set, status === 'ok', issue]")
    expect(hook).toContain("if (!done && now !== 'ok') onProblem?.(name, now, actions)")
    // 머지 뒤 P2(리뷰 23): 다시 읽기는 실제로 다시 읽고(store.reload), 깨진 화면 설정은 그 이름만 처음 값으로(store.reset — 화면은 확인창 뒤)
    expect(hook).toContain("retry: () => void store.reload(name, check),")
    expect(hook).toContain("plan: async () => planFileDiscard({ key: name, seen: await store.see(name) }, check, first, name, undefined, SETTING_RESET_TEXT),")
    // 리뷰 24 P2: 문제는 지금 상태 그대로(넷째 값) — 한 번만 알리는 장치(announce) 없이, 화면이 풀릴 때까지 표시
    expect(hook).toContain("? { problem: status, ...(resetFailed === '1' ? { resetFailed: true } : {}), ...actions }")
    // 다시 읽는 동안은 직전 문제를 "다시 읽는 중"으로 남겨요(리뷰 25 P2)
    expect(hook).toContain(": status === 'loading' && retrying")
    expect(hook).not.toContain("announce")
    const stored = read("apps/mobile/src/features/board/stored.ts")
    expect(stored).toContain("return useStoredIn(store, name, init, check, onProblem)")
    // 화면 설정 세 가지는 쓰는 화면이 풀릴 때까지 남는 표시(다시 읽기·초기화 확인창)로 보여요
    const home = read("apps/mobile/src/features/board/Home.tsx")
    expect(home).toContain('<StoreProblemNotice label="집중 모드" issue={focusIssue} />')
    expect(home).toContain('<StoreProblemNotice label="오늘 메인" issue={main.issue} />')
    expect(read("apps/mobile/src/features/board/List.tsx")).toContain('<StoreProblemNotice label="목록 설정" issue={prefsIssue} />')
    expect(read("apps/mobile/src/features/board/StoreProblemNotice.tsx")).toContain("Alert.alert(reset.title, p.message, [{ text: '취소', style: 'cancel' }, { text: '초기화', style: 'destructive', onPress: () => void issue.apply(p).then((r) => setNote(r === 'changed' ? CHANGED_TEXT : null)) }])")
    // 범위 폴더 준비는 실패를 기억하지 않아요(onceOk)
    expect(stored).toContain("const folder = onceOk(() =>")
  })
  test("iOS 세 화면이 기록·쓰던 초안(·지금 판) 문제를 모두 안내", () => {
    for (const f of SCREENS.slice(3)) {
      const src = read(f)
      expect([f, src.includes("<SlotIssueNotice issue={slotIssue} />") && src.includes("<SlotIssueNotice issue={edit.issue} />")]).toEqual([f, true])
    }
    for (const f of SCREENS.slice(3, 5)) expect([f, read(f).includes("<SlotIssueNotice issue={boardIssue} />")]).toEqual([f, true])
  })
  test("웹 기본 요소: 기록·쓰던 초안 읽기를 나누고, 잘 읽지 않았으면 쓰지 않아요 · AI 정리 칩도", () => {
    const src = read("apps/web/src/lib/quick-slot.ts")
    expect(src).toContain("export const readEditState = (storage: StorageLike, scope: string, slot: string): SlotView<QuickEdit> =>")
    expect(src).toContain("if (!okRef.current) return false // 읽지 못한 저장소에는 쓰지 않아요(규칙 E)")
    expect(src).toContain('if (!scope || !storage || stateRef.current?.s !== "ok") return false')
    expect(src).toContain("return { initial, ready: !!scope && ok, notice, reread, plan, apply, failed, readFailed, change, flush, planClear, applyClear, adopt, conflict, takeTheirs, keepMine }")
    const cap = read("apps/web/src/hooks/use-captures.ts")
    expect(cap).toContain("readCaptures(")
    expect(cap).not.toContain("loadCaptures(")
  })
  test("웹 세 화면이 기록·쓰던 초안 문제와 늦은 준비 신호를 안내, 시트는 둘 다 잘 읽어야 본문을 그려요", () => {
    for (const f of [SCREENS[0]!, SCREENS[2]!]) {
      const src = read(f)
      expect([f, src.includes("<SlotProblem slot={slot} />") && src.includes('<SlotProblem slot={edit} what="쓰던 초안" />') && src.includes("<ReadyStall waiting=")]).toEqual([f, true])
    }
    const sheet = read("apps/web/src/components/quick-add-sheet.tsx")
    expect(sheet).toContain("if (!props.env.scope || health.ok) return <QuickAddSheetIn {...props} />")
    expect(sheet).toContain("<ReadyStall waiting=")
  })
})

// 머지 뒤 P2(리뷰 25): 전체 목록도 오늘 메인을 써요 — 오늘 메인 문제도 그 화면에 보여요
describe('전체 목록의 화면 설정 표시(리뷰 25 P2)', () => {
  test('목록 설정과 오늘 메인 둘 다', () => {
    const list = read("apps/mobile/src/features/board/List.tsx")
    expect(list).toContain('<StoreProblemNotice label="목록 설정" issue={prefsIssue} />')
    expect(list).toContain('<StoreProblemNotice label="오늘 메인" issue={main.issue} />')
  })
})

// PR #43 리뷰: 빠른 추가 기록·쓰던 초안은 자리마다 따로(한 자리의 깨짐·버리기가 다른 자리에 닿지 않게). 예전 묶음은 읽어 넘기기·묶음 문제의 버리기만.
// 동작은 iOS quickSlots.dom.test.tsx·웹 quick-slot.test.ts·계약 slot-store.test.ts 가 봐요. 여기서는 묶음 이름에 쓰는 길이 다시 생기지 않게
describe("자리별 저장(PR #43 리뷰)", () => {
  test("iOS 기록·쓰던 초안은 자리 파일에만 써요(useSlotStore), 묶음 이름 쓰기는 묶음 문제의 버리기뿐", () => {
    for (const f of ["apps/mobile/src/features/board/quick/pendingSlot.ts", "apps/mobile/src/features/board/quick/editSlot.ts"]) {
      const src = read(f)
      expect([f, /useSlotStore\(/.test(src), /set(Durable)?\((SLOTS|EDITS)\b/.test(src), /useStoreGate\(/.test(src)]).toEqual([f, true, false, false])
    }
    const slot = read("apps/mobile/src/features/board/quick/slotStore.ts")
    expect(slot).toContain("viewNow().s === 'ok' ? store.setDurable(own, value) : false")
    expect(slot).toContain("plan: async () => planSlotDiscard({ key: own, seen: await store.see(own) }, { key: kind.base, seen: await store.see(kind.base) }, slot, kind.isOne, kind.migrate, kind.what),")
  })
  test("웹 기록·쓰던 초안은 자리 키에만 써요, 묶음 키 쓰기는 묶음 문제의 버리기뿐", () => {
    const src = read("apps/web/src/lib/quick-slot.ts")
    // 저장소에 직접 쓰는 곳은 하나뿐(자리 키에 값). 버리기는 모두 계획 실행(store-plan applyPlan — 계획의 쓸 곳 하나에만)
    const sets = src.split("\n").filter((l) => l.includes("setItem(")).map((l) => l.trim())
    expect(sets).toEqual(["storage.setItem(k.own(scope, slot), JSON.stringify(v))"])
    expect(read("apps/web/src/lib/store-plan.ts").split("\n").filter((l) => l.includes("setItem(")).map((l) => l.trim())).toEqual(["storage.setItem(plan.write.key, JSON.stringify(plan.write.value))"])
  })
})

// PR #43 리뷰 2 규칙 F "확인한 계획만 실행": 모든 버리기·초기화는 확인창을 띄울 때 지금 읽은 것으로 계획(지울 곳 하나 + 전제 + 확인창 글)을 만들고,
// 실행은 그 계획만 받아 전제를 다시 읽어 같을 때만 써요. 실패를 더 넓은 삭제(전체 비우기·묶음 비우기)로 바꾸는 길이 없어요.
// 동작은 웹 quick-discard-dom.test.ts·iOS quickSlots.dom.test.tsx "규칙 F"·smallStore.queue.test.ts 가 봐요
describe("규칙 F: 확인한 계획만 실행(PR #43 리뷰 2)", () => {
  const appFiles = (dir: string) => [...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: join(ROOT, dir) })].filter((f) => !/\.test\.|__tests__/.test(f)).map((f) => dir + "/" + f)
  test("앱 코드에 무조건 덮는 버리기(store.reset·resetAll·resetSlot·resetOne)가 없어요", () => {
    for (const f of [...appFiles("apps/web/src"), ...appFiles("apps/mobile/src")]) {
      const hit = read(f).match(/store\.reset\(|\bresetAll\b|\bresetSlot\(|\bresetOne\(|\.reset\(name,/)?.[0] ?? null
      expect([f, hit]).toEqual([f, null])
    }
  })
  test("버리기 안내 셋(웹 SlotProblem·iOS SlotIssueNotice·StoreProblemNotice)은 계획 → 그 글의 확인창 → 그 계획만 실행", () => {
    const web = read("apps/web/src/components/quick-add.tsx")
    expect(web).toMatch(/const p = slot\.plan\?\.\(\)[\s\S]*?if \(!confirmDiscard\(what, p\.message\)\) return\s*const r = slot\.apply\?\.\(p\)/)
    const ios = read("apps/mobile/src/features/board/quick/SlotIssueNotice.tsx")
    expect(ios).toMatch(/const p = await issue\.plan\?\.\(\)[\s\S]*?confirmDiscard\(\(\) => void issue\.apply\?\.\(p\)[\s\S]*?p\.message\)/)
    const set = read("apps/mobile/src/features/board/StoreProblemNotice.tsx")
    expect(set).toMatch(/const p = await issue\.plan\(\)[\s\S]*?Alert\.alert\(reset\.title, p\.message,[\s\S]*?issue\.apply\(p\)/)
  })
  test("계획 실행은 전제를 다시 읽어 같을 때만 쓸 곳 하나에 써요(웹·iOS)", () => {
    expect(read("apps/web/src/lib/store-plan.ts")).toMatch(/for \(const \[i, p\] of plan\.premises\.entries\(\)\) if \(!premiseHolds\(plan, i, seeKey\(storage, p\.key\)\)\) return "changed"\s*try \{\s*storage\.setItem\(plan\.write\.key/)
    const c = read("packages/contracts/src/slot-store.ts")
    expect(c).toContain('(a.s === "absent" && b.s === "absent") || (a.s === "text" && b.s === "text" && a.text === b.text)')
    // 웹 AI 정리 칩도 계획(성한 칩까지 지우는 길이 없어요)
    const cap = read("apps/web/src/hooks/use-captures.ts")
    expect(cap).toContain("planFileDiscard({ key: CAPTURE_STORE, seen: seeKey(s, CAPTURE_STORE) }")
    expect(cap).not.toContain('setItem(CAPTURE_STORE, "[]")')
  })
})

// PR #43 리뷰 3: 원자적 비교-후-쓰기 하나(compareAndWrite)로만 버리기·초기화, 기록 버리기는 대상 둘(기록·쓰던 초안)을 각자 전제와 함께,
// 쓰던 초안을 따로 무조건 비우는 호출(edit.clear 등)은 없어요. 동작은 iOS smallStore.queue.test.ts "compareAndWrite 경합 표"·quickSlots.dom "리뷰 3"·웹 quick-discard-dom "리뷰 3"
describe("원자적 비교-후-쓰기·기록과 쓰던 초안(PR #43 리뷰 3)", () => {
  test("iOS SmallStore: 앞선 쓰기(시간 초과 포함)가 끝난 뒤 → 전제 다시 읽기 → 같으면 쓰기가 한 임계 구역, 안 끝나면 busy", () => {
    const src = read("apps/mobile/src/features/board/smallStore.ts")
    expect(src).toContain("compareAndWrite(plan: CasTarget<string>, opts: { quiet?: boolean } = {}): Promise<PlanResult> {")
    expect(src).toMatch(/const run = this\.lineMany\(names, async \(\): Promise<PlanResult> => \{\s*for \(const n of names\) \{\s*const before = this\.hung\.get\(n\)[\s\S]*?return 'busy'[\s\S]*?for \(const \[i, x\] of plan\.premises\.entries\(\)\) if \(!premiseHolds\(plan, i, await this\.seeNow\(x\.key\)\)\) return 'changed'\s*await this\.writeIO\(target/)
    expect(src).toContain("    return this.compareAndWrite(plan)")
    // 다시 읽기가 닿으면 늘 디스크 값(P2)
    expect(src).toContain("if (text === null) return void this.values.delete(name)")
    expect(src).not.toContain("this.values.has(name)) return")
  })
  test("웹 저장 실행도 같은 모양(compareAndWrite), 빠른 추가·칩 모두 이것으로", () => {
    expect(read("apps/web/src/lib/store-plan.ts")).toContain("export function compareAndWrite(storage: StorageLike, plan: CasTarget<string>): PlanResult {")
    for (const f of ["apps/web/src/lib/quick-slot.ts", "apps/web/src/hooks/use-captures.ts"]) expect([f, read(f).includes("applyPlan")]).toEqual([f, false])
  })
  test("화면은 쓰던 초안을 따로 무조건 비우지 않아요(edit.clear 없음) — 제출 끝·버리기·공간 옮기기·AI 넘김 모두 planClear 로 만든 대상만 applyClear", () => {
    for (const f of SCREENS) {
      const src = read(f)
      expect([f, src.match(/\bedit\.clear\(|editRef\.current\.clear\(|\bslot\.discard\(|putEditNow\(/)?.[0] ?? null]).toEqual([f, null])
      // applyClear 의 대상은 그 화면이 planClear 로 만든 것(제출 전 draftTarget·버리기 target·옮기기 oldDraft·넘기기 handoff)뿐
      for (const m of src.match(/edit\.applyClear\([^)]*\)/g) ?? []) expect([f, m, /^edit\.applyClear\((draftTarget|target|oldDraft|handoff)\)$/.test(m)]).toEqual([f, m, true])
      expect([f, /planClear\(\)/.test(src)]).toEqual([f, true])
    }
    for (const f of ["apps/web/src/lib/quick-slot.ts", "apps/mobile/src/features/board/quick/editSlot.ts"]) expect([f, /\bconst clear = useCallback/.test(read(f))]).toEqual([f, false])
  })
  test("기록 버리기 계획은 대상 둘(기록·쓰던 초안)과 둘 다 밝히는 확인창 글", () => {
    for (const f of ["apps/web/src/lib/quick-discard.ts", "apps/mobile/src/features/board/quick/discardBoth.ts"]) {
      const src = read(f)
      expect([f, src.includes("message: recordDiscardText(!!draft)")]).toEqual([f, true])
      expect([f, /const record = (await )?slot\.run\(plan\.record\)\s*const d = (await )?edit\.applyClear\(plan\.draft\)/.test(src)]).toEqual([f, true])
    }
    expect(read("packages/contracts/src/slot-store.ts")).toContain('withDraft ? "이 기록과 이 자리의 쓰던 초안을 버려요')
  })
})

// PR #43 리뷰 4 규칙 G: 프로그램이 칸을 바꾸는 곳은 setByProgram(시트는 setFieldsByProgram) 하나로만 — 그 값을 디스크와 맞춘 값으로 기록(edit.adopt)해
// 자동 저장이 사람 편집처럼 쓰지 않아요. 자동 저장도 비교-후-쓰기(전제 = 이 화면이 마지막으로 읽거나 쓴 디스크 값). 동작은 웹 quick-discard-dom·iOS quickSlots.dom "규칙 G"
describe("규칙 G: 프로그램이 바꾼 칸·자동 저장(PR #43 리뷰 4)", () => {
  test("화면 셋 × 웹·iOS: 프로그램 초기화·채우기는 setByProgram/setFieldsByProgram 으로만(직접 setText('')·setText(cleared…)·setText(x.now…)·setTitle('') 없음)", () => {
    for (const f of SCREENS) {
      const src = read(f)
      expect([f, src.match(/\bset(Text|Title|Note)\((""|''|cleared|x\.now|c\.now|pending\.text)/)?.[0] ?? null]).toEqual([f, null])
      expect([f, /const set(By|FieldsBy)Program = /.test(src) && /edit\.adopt\(/.test(src)]).toEqual([f, true])
      // 충돌 안내(불러오기·내 것으로 덮기)
      expect([f, /<EditConflict(Problem|Notice) edit=\{edit\}/.test(src)]).toEqual([f, true])
    }
  })
  test("편집 초안 자동 저장은 비교-후-쓰기, 충돌이면 쓰지 않아요(웹·iOS)", () => {
    const web = read("apps/web/src/lib/quick-slot.ts")
    expect(web).toMatch(/if \(conflictRef\.current\) return false[\s\S]*?const r = compareAndWrite\(st, \{ premises: \[\{ key: draftKey\(scope, slot\), seen: b\.own \}, \{ key: editKey\(scope\), seen: b\.bundle \}\]/)
    expect(web).not.toMatch(/const ok = !!scope && !!st && writeEdit\(st, scope, slot, next\.e\)/)
    const ios = read("apps/mobile/src/features/board/quick/editSlot.ts")
    expect(ios).toMatch(/if \(conflictRef\.current\) return false[\s\S]*?const r = await runQuiet\(\{ premises: \[\{ key: names\.own, seen: b\.own \}, \{ key: names\.base, seen: b\.bundle \}\]/)
    expect(ios).not.toContain("await put(")
  })
  test("AI 넘김·시트 넘김은 넘기기 전 원문을 전제로 대상(handoff) → 성공 뒤 applyClear(handoff)", () => {
    for (const f of ["apps/web/src/components/quick-add.tsx", "apps/mobile/src/features/board/quick/QuickAddBar.tsx"]) {
      const src = read(f)
      expect([f, /const handoff = (await )?edit\.planClear\(\)\s*const r = await (captures|center)\.start\(/.test(src)]).toEqual([f, true])
      expect([f, (src.match(/edit\.applyClear\(handoff\)/g) ?? []).length >= 2]).toEqual([f, true])
    }
  })
})

// PR #43 리뷰 5: 화면마다 저장 줄 하나 — 다음 저장은 앞 저장이 끝난 뒤 최신 입력으로, 전제는 줄 안에서 읽은 known(이 화면이 마지막으로 잘 읽거나 쓴 값).
// 비우기 전제도 known(그때 디스크의 다른 초안이 아님), 충돌 중(사람이 고르기 전)이면 비우기 0건
describe("저장 줄·known 전제(리뷰 5)", () => {
  test("iOS: 자동 저장·비우기·불러오기·덮기는 모두 저장 줄 안에서, 전제는 줄 안에서 읽어요", () => {
    const ios = read("apps/mobile/src/features/board/quick/editSlot.ts")
    expect(ios).toContain("return inLine(saveInLine)")
    expect(ios).toContain("if (ok) void inLine(ensureBase)")
    expect(ios).toMatch(/const saveInLine = useCallback\(async \(\): Promise<boolean> => \{\s*for \(;;\) \{\s*const next = queued\.current/)
    // 비우기 계획은 known 으로(planDraftClear 에 기기를 지금 다시 읽은 값을 넘기지 않아요)
    expect(ios).toContain("return b ? planDraftClear({ key: names.own, seen: b.own }, { key: names.base, seen: b.bundle }, slot, isEdit, migrateEdits) : null")
    expect(ios).not.toContain("planTarget()")
    expect(ios).toMatch(/return inLine\(async \(\) => \{\s*\/\/ 충돌 중[^\n]*\n\s*if \(conflictRef\.current\) \{\s*queued\.current = null\s*return \{ r: 'changed' as PlanResult, now: null \}/)
  })
  test("웹: 비우기 계획은 known 으로, 충돌 중이면 비우기 0건", () => {
    const web = read("apps/web/src/lib/quick-slot.ts")
    expect(web).toContain("return b ? planDraftClear({ key: draftKey(scope, slot), seen: b.own }, { key: editKey(scope), seen: b.bundle }, slot, isEdit, migrateEdits) : null")
    expect(web).not.toContain("planDraftClear({ key: draftKey(scope, slot), seen: seeKey(")
    expect(web).toMatch(/if \(conflictRef\.current\) \{\s*queued\.current = null\s*return \{ r: "changed", now: null \}/)
  })
  test("iOS 시트: 복원이 끝난 순간에도 편집 초안 저장 예약(넘겨받은 글), 복원은 setFieldsByProgram 으로만", () => {
    const sheet = read("apps/mobile/src/features/board/quick/QuickAddSheet.tsx")
    expect(sheet).toContain("}, [title, note, kind, atPick, areaPick, tags, props, !!frozen, restoredEdit, restoredDone])")
    const restore = sheet.slice(sheet.indexOf("const src = restoreSource(failure, edit.initial)"), sheet.indexOf("// 칸 묶음 → 편집 초안"))
    expect(restore).not.toMatch(/\bset(Title|Note|Kind|AtPick|AreaPick|Tags|Props)\(/)
    expect(restore.match(/setFieldsByProgram\(/g)?.length).toBe(2)
  })
})

// PR #43 리뷰 6: known 은 잘 읽거나 쓴 원문만. 못 읽음을 전제로 쓰는 길은 사람이 확인창에서 고른 계획(premiseHolds — 확인창 글이 있는 계획) 하나뿐
describe("못 읽은 값은 known 이 아니에요(리뷰 6)", () => {
  const contracts = () => read("packages/contracts/src/slot-store.ts")
  test("계약: 같음 판정(sameSeen)에는 못 읽음 동등 분기가 없고, 못 읽음 전제는 확인창 글이 있는 계획만(premiseHolds)", () => {
    const c = contracts()
    const same = c.slice(c.indexOf("export const sameSeen"), c.indexOf("export const isConfirmedPlan"))
    expect(same).not.toContain("unreadable")
    expect(c).toContain('if (seen.s === "unreadable") return isConfirmedPlan(plan) && now.s === "unreadable"')
    expect(c).toContain('typeof (plan as Partial<DiscardPlan<K>>).message === "string"')
  })
  test("비교-후-쓰기는 전제를 premiseHolds 로만(웹·iOS 일반), 자동 저장(iOS 조용한 쓰기)은 sameSeen 으로만", () => {
    const web = read("apps/web/src/lib/store-plan.ts")
    expect(web).not.toContain("sameSeen(")
    const ios = read("apps/mobile/src/features/board/smallStore.ts")
    const quiet = ios.slice(ios.indexOf("private quietCompareAndWrite"), ios.indexOf("async planReset"))
    expect(quiet).toContain("if (!sameSeen(await this.seeNow(x.key), x.seen)) return 'changed'")
    expect(quiet).not.toContain("premiseHolds")
  })
  test("자동 저장·비우기 경로는 못 읽음 전제를 만들지 않아요: known 은 잘 읽힌 것(look ok)·쓴 원문만", () => {
    for (const f of ["apps/web/src/lib/quick-slot.ts", "apps/mobile/src/features/board/quick/editSlot.ts"]) {
      const src = read(f)
      const hook = src.slice(src.indexOf(f.endsWith("editSlot.ts") ? "export function useEditSlot" : "export function useQuickEdit"))
      // 못 읽음을 직접 만들거나 받지 않아요
      expect([f, /s: ['"]unreadable['"]/.test(hook)]).toEqual([f, false])
      // known 에 들어가는 값: 잘 읽힌 look 의 known 이거나 방금 쓴 원문(text) 뿐
      for (const m of hook.matchAll(/base\.current = ([^\n]+)/g)) expect([f, m[1]]).toEqual([f, expect.stringMatching(/^(l\.known|\{ \.\.\.b, own: \{ s: ['"]text['"]|\{ \.\.\.base\.current, own: \{ s: ['"]text['"])/)])
      // 못 읽으면 쓰지 않아요
      expect(hook).toMatch(/if \(!l\.ok\) return (null|undefined|false|\{ r: ['"]failed['"])/)
    }
    // 공간 옮기기 되돌리기 전제도 쓴 원문(다시 읽지 않아요)
    expect(read("apps/web/src/lib/quick-slot.ts")).toContain('seen: { s: "text", text: JSON.stringify(editEmpty(e) ? null : e) }')
  })
})

// PR #43 리뷰 7: known 을 처음 잡거나 다시 잡는 모든 경로에서 화면이 복원한 값과 읽은 값을 비교 — 다르면 충돌
describe("늦게 읽은 known 은 화면 값과 비교(리뷰 7)", () => {
  test("웹: 그림 중 known 잡기는 화면 값과 같을 때만, ensureBase 는 다르면 충돌, 다시 읽기는 known 을 바꾸지 않아요", () => {
    const src = read("apps/web/src/lib/quick-slot.ts")
    const hook = src.slice(src.indexOf("export function useQuickEdit"))
    expect(hook).toContain("if (base.current === null && ok) { const l = lookNow(slot); if (l.ok && matchesShown(slot, l.value)) base.current = l.known }")
    expect(hook).toContain("if (!matchesShown(slot, l.value)) markConflict(true)")
    const reread = hook.slice(hook.indexOf("const reread = useCallback"), hook.indexOf("const plan = useCallback"))
    expect(reread).not.toContain("base.current =")
  })
  test("iOS: 처음 known 은 ensureBase 하나로만 잡고, 처음 복원한 값과 다르면 충돌", () => {
    const src = read("apps/mobile/src/features/board/quick/editSlot.ts")
    expect(src).toContain("if (firstShown.current?.slot === slot && keyOf(l.value) !== firstShown.current.key) markConflict(true)")
    // known 이 비는 길(null 대입)이 없어요 — 한 번 잡으면 잘 읽거나 쓴 값으로만 바뀌어요
    expect(src).not.toMatch(/base\.current = null/)
  })
})
