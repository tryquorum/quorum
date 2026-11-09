// iOS 빠른 추가 세 화면(한 줄·상세 시트·목표 할 일)의 컴포넌트 시험(PR #39 리뷰 21). 하네스는 __tests__/quickHarness.ts(대역·실제 SmallStore·도우미).
import { describe, expect, test } from 'bun:test'
import { act, alerts, BAR, beforeRemove, boards, boardState, click, created, disk, EDITS, failReads, failWrites, gate, goal, GoalOverview, h, mount, nav, q, QuickAddBar, React, refreshes, remount, SAVE_FAILED_TEXT, settle, SHEET, GOAL, sheetEl, sleep, store, toasts, typeInto, useQuickHarness, useStoredIn, win } from './__tests__/quickHarness'
import { slotName } from '@direction-board/contracts/slot-store'

useQuickHarness()
/** 자리별 파일(PR #43 리뷰)의 값 */
const fileOf = (base: string, slot: string) => JSON.parse(disk.get(slotName(base, slot)) ?? 'null')

describe('iOS 규칙 C: 입력 가능 = 준비 완료(리뷰 21)', () => {
  test('리뷰 21 P1-2 재현: 고른 판을 읽는 동안 시트는 입력을 막고, 다 읽어 복원한 뒤 쓴 글은 덮이지 않아요', async () => {
    disk.set(EDITS, JSON.stringify({ [SHEET]: { text: '저장된 초안', note: '저장된 노트', boardId: 'pb' } }))
    const openBoard = gate('board')
    await mount(sheetEl())
    const title = q<HTMLInputElement>('input[aria-label="제목"]')!
    const note = q<HTMLTextAreaElement>('textarea[aria-label="노트"]')!
    expect(title.disabled).toBe(true)
    expect(note.disabled).toBe(true)
    expect(title.placeholder).toBe('불러오는 중…')
    await openBoard()
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.disabled).toBe(false)
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe('저장된 초안')
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, '판을 읽은 뒤 새 글')
    await settle(50)
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe('판을 읽은 뒤 새 글')
  })
  test('한 줄·목표 할 일: 편집 초안을 읽기 전에는 입력을 막고, 읽으면 복원', async () => {
    disk.set(EDITS, JSON.stringify({ [BAR]: { text: '한 줄 초안', boardId: 'pb' }, [GOAL]: { text: '목표 초안', boardId: 'pb', goalId: 'g1' } }))
    const openEdits = gate(EDITS)
    await mount(h(QuickAddBar))
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.disabled).toBe(true)
    await openEdits()
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.disabled).toBe(false)
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.value).toBe('한 줄 초안')
    await remount()
    const openEdits2 = gate(EDITS)
    await mount(h(GoalOverview, { goal, items: [goal], boards, linkedRefs: [], onAdded: () => {} }))
    expect(q<HTMLInputElement>('input[aria-label="이 목표의 할 일 추가"]')!.disabled).toBe(true)
    await openEdits2()
    expect(q<HTMLInputElement>('input[aria-label="이 목표의 할 일 추가"]')!.value).toBe('목표 초안')
  })
})

describe('iOS 규칙 D: 저장 실패면 화면 상태를 바꾸지 않음(리뷰 21)', () => {
  test('시트: 쓰던 초안을 기기에 저장하지 못하면 닫지 않아요(뒤로·끌어내림) — 칸 그대로·안내, 저장되면 닫혀요', async () => {
    await mount(sheetEl())
    failWrites.add(EDITS)
    await typeInto(q<HTMLInputElement>('input[aria-label="제목"]')!, '닫기 전 글')
    const e = beforeRemove()
    await settle(30)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(nav.dispatch).not.toHaveBeenCalled()
    expect(alerts.at(-1)?.message ?? alerts.at(-1)?.title).toContain(SAVE_FAILED_TEXT)
    expect(q<HTMLInputElement>('input[aria-label="제목"]')!.value).toBe('닫기 전 글')
    failWrites.delete(EDITS)
    beforeRemove()
    await settle(30)
    expect(nav.dispatch).toHaveBeenCalled()
    expect(fileOf(EDITS, SHEET)?.text).toBe('닫기 전 글')
  })
  test('한 줄: 저장 실패를 알리고 밀린 글을 버리지 않아요, 저장되기 전에는 상세 시트로 옮기지 않아요', async () => {
    await mount(h(QuickAddBar))
    failWrites.add(EDITS)
    await typeInto(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!, '한 줄 글')
    await settle(450)
    expect(document.body.textContent).toContain(SAVE_FAILED_TEXT)
    await click(q<HTMLButtonElement>('button[aria-label="자세히 추가"]')!)
    await settle(30)
    expect(nav.navigate).not.toHaveBeenCalled()
    expect(q<HTMLInputElement>('input[aria-label="할 일 추가"]')!.value).toBe('한 줄 글')
    failWrites.delete(EDITS)
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === '다시 저장')!)
    await settle(30)
    expect(fileOf(EDITS, BAR)?.text).toBe('한 줄 글')
    expect(document.body.textContent).not.toContain(SAVE_FAILED_TEXT)
  })
  test('목표 할 일: 저장 실패를 알리고 상세 시트로 옮기지 않아요', async () => {
    await mount(h(GoalOverview, { goal, items: [goal], boards, linkedRefs: [], onAdded: () => {} }))
    failWrites.add(EDITS)
    await typeInto(q<HTMLInputElement>('input[aria-label="이 목표의 할 일 추가"]')!, '목표 글')
    await settle(450)
    expect(document.body.textContent).toContain(SAVE_FAILED_TEXT)
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === '자세히')!)
    await settle(30)
    expect(nav.navigate).not.toHaveBeenCalled()
  })
})

// PR #39 리뷰 22: 규칙 E "읽기 실패 ≠ 빈 값" — 저장 기본 요소 × 고장 × 화면 표(014_write_inventory.md 리뷰 22 절)의 iOS 칸.
// 고장 흉내: 읽기 실패(read 가 던짐)·깨짐(깨진 값)·늦음(gate)·쓰기 실패(write 가 던짐)·복구됨(읽기 실패 뒤 저장소가 돌아옴 → 다시 읽기)
const { stallTimer } = await import('./recovery')
const { IntentsNotice } = await import('../IntentsNotice')
const { StoreProblemNotice } = await import('../StoreProblemNotice')
const { useIntents } = await import('../useIntents')
const SLOTS_NAME = 'quickPending'
type Scr = 'bar' | 'sheet' | 'goal'
const SCR: Record<Scr, { slot: string; input: string; el: () => React.ReactElement; draft: Record<string, unknown> }> = {
  bar: { slot: BAR, input: 'input[aria-label="할 일 추가"]', el: () => h(QuickAddBar), draft: { boardId: 'pb' } },
  sheet: { slot: SHEET, input: 'input[aria-label="제목"]', el: sheetEl, draft: { boardId: 'pb' } },
  goal: { slot: GOAL, input: 'input[aria-label="이 목표의 할 일 추가"]', el: () => h(GoalOverview, { goal, items: [goal], boards, linkedRefs: [], onAdded: () => {} }), draft: { boardId: 'pb', goalId: 'g1', space: 'personal' } },
}
// 자리마다 파일 하나(PR #43 리뷰): 그 자리의 파일에 심고 그 파일 이름을 돌려줘요(옛 묶음 읽어 넘기기는 quickSlots.dom.test.tsx)
const seedIos = (prim: 'records' | 'edits', s: Scr) => {
  const name = slotName(NAME_OF[prim], SCR[s].slot)
  if (prim === 'records') disk.set(name, JSON.stringify({ id: 'rec1', from: 'item', text: '남은 기록 글', ref: null, scope: 'http://127.0.0.1:3181|anon', draft: { kind: 'todo', title: '남은 기록 글', at: null, areaId: null, tags: [], note: '', props: [], ...SCR[s].draft } }))
  else disk.set(name, JSON.stringify(s === 'goal' ? { text: '쓰던 글', boardId: 'pb', goalId: 'g1' } : { text: '쓰던 글', boardId: 'pb' }))
  return name
}
const NAME_OF = { records: SLOTS_NAME, edits: EDITS } as const
const WHAT_IOS = { records: '복구 기록', edits: '쓰던 초안' } as const
const RESTORED_IOS = { records: '남은 기록 글', edits: '쓰던 글' } as const
const alertIos = (t: string) => [...document.querySelectorAll('[role="alert"]')].find((x) => (x.textContent ?? '').includes(t)) as HTMLElement | undefined
const pressIn = async (box: HTMLElement | undefined, label: string) => { const b = [...(box?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === label); expect(b).toBeTruthy(); await click(b!) }
const inputOf = (s: Scr) => q<HTMLInputElement>(SCR[s].input)!
const submitIos = async (s: Scr) => {
  if (s === 'sheet') await click([...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '추가')!)
  else await act(async () => { inputOf(s).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event) })
  await settle(40)
}

describe('규칙 E iOS: 기록·쓰던 초안 × 읽기 실패·깨짐·늦음·복구됨·쓰기 실패 × 한 줄·시트·목표(리뷰 22)', () => {
  for (const prim of ['records', 'edits'] as const)
    for (const s of ['bar', 'sheet', 'goal'] as const) {
      test(prim + ' · 읽기 실패 → 입력·자동 저장·자동 삭제 없음 + 안내 → 저장소가 돌아와도 다시 읽기 전에는 그대로 → 다시 읽기 → 복원 · ' + s, async () => {
        const name = seedIos(prim, s)
        const raw = disk.get(name)
        failReads.add(name)
        await mount(SCR[s].el())
        expect(inputOf(s).disabled).toBe(true)
        expect(alertIos(WHAT_IOS[prim])?.textContent).toContain('읽지 못했어요')
        failReads.delete(name) // 사람 손 없이 저장소가 돌아와도(리뷰 22 P1-2) 오류 상태 그대로, 쓰지도 지우지도 않아요
        await settle(500)
        expect(disk.get(name)).toBe(raw)
        expect(inputOf(s).disabled).toBe(true)
        await pressIn(alertIos(WHAT_IOS[prim]), '다시 읽기')
        await settle(30)
        expect(inputOf(s).disabled).toBe(false)
        expect(inputOf(s).value).toBe(RESTORED_IOS[prim])
        expect(alertIos(WHAT_IOS[prim])).toBeUndefined()
        await settle(500)
        expect(disk.get(name)).toBe(raw)
      })
      test(prim + ' · 깨짐 → 막고 안내·그대로, 버리고 새로(확인창)만 비워요 · ' + s, async () => {
        const name = slotName(NAME_OF[prim], SCR[s].slot)
        disk.set(name, 'not json')
        await mount(SCR[s].el())
        expect(inputOf(s).disabled).toBe(true)
        expect(alertIos(WHAT_IOS[prim])?.textContent).toContain('깨져')
        await settle(500)
        expect(disk.get(name)).toBe('not json')
        await pressIn(alertIos(WHAT_IOS[prim]), '버리고 새로')
        await settle(30)
        expect(disk.get(name)).toBe('null')
        expect(inputOf(s).disabled).toBe(false)
      })
      test(prim + ' · 늦음 → 읽는 동안 입력 막힘 → 다 읽으면 복원 · ' + s, async () => {
        const name = seedIos(prim, s)
        const open = gate(name)
        await mount(SCR[s].el())
        expect(inputOf(s).disabled).toBe(true)
        await open()
        expect(inputOf(s).disabled).toBe(false)
        expect(inputOf(s).value).toBe(RESTORED_IOS[prim])
      })
    }
  for (const s of ['bar', 'sheet', 'goal'] as const)
    test('기록 · 쓰기 실패 → 기록을 못 남기면 보내지 않고(0건) 칸 그대로 · ' + s, async () => {
      await mount(SCR[s].el())
      failWrites.add(SLOTS_NAME)
      await typeInto(inputOf(s), '쓰기 실패 글')
      await submitIos(s)
      expect(created.length).toBe(0)
      expect(toasts.join(' ')).toContain('기록을 남기지 못해')
      expect(inputOf(s).value).toBe('쓰기 실패 글')
    })
})

describe('규칙 E iOS: 지금 판(고른 판) × 읽기 실패·깨짐·복구됨, 판 목록 × 늦음·실패(리뷰 22·P2)', () => {
  for (const s of ['bar', 'sheet'] as const) {
    test('고른 판 읽기 실패 → 막고 안내 → 다시 읽기 → 열림 · ' + s, async () => {
      disk.set('board', JSON.stringify('pb'))
      failReads.add('board')
      await mount(SCR[s].el())
      expect(inputOf(s).disabled).toBe(true)
      expect(alertIos('지금 판')?.textContent).toContain('읽지 못했어요')
      failReads.delete('board')
      await pressIn(alertIos('지금 판'), '다시 읽기')
      await settle(30)
      expect(inputOf(s).disabled).toBe(false)
      expect(disk.get('board')).toBe(JSON.stringify('pb'))
    })
    test('고른 판 깨짐 → 막고 안내, 버리고 새로(확인창)만 비워요 · ' + s, async () => {
      disk.set('board', '{x')
      await mount(SCR[s].el())
      expect(inputOf(s).disabled).toBe(true)
      await pressIn(alertIos('지금 판'), '버리고 새로')
      await settle(30)
      expect(disk.get('board')).toBe('null')
      expect(inputOf(s).disabled).toBe(false)
    })
    test('판 목록이 늦으면 원인 안내 + 다시 시도, 실패면 바로 · ' + s, async () => {
      stallTimer.ms = 60
      try {
        boardState.data = undefined
        await mount(SCR[s].el())
        expect(inputOf(s).disabled).toBe(true)
        expect(alertIos('판 목록')).toBeUndefined()
        await settle(120)
        await pressIn(alertIos('판 목록을 아직 받지 못했어요'), '다시 읽기')
        expect(refreshes).toBe(1)
      } finally {
        stallTimer.ms = 8000
      }
    })
  }
})

describe('규칙 E iOS: AI 정리 칩 × 읽기 실패·깨짐·늦음·복구됨·쓰기 실패(리뷰 22)', () => {
  const chips = (list: unknown[]) => JSON.stringify(JSON.stringify(list))
  const chip = { id: 'run1', clientKey: 'k1', text: '칩 글', draft: null, startedAt: 1, ended: true }
  const aiButton = () => q<HTMLButtonElement>('button[aria-label="AI로 정리해서 올리기"]')
  test('읽기 실패 → 안내·새 정리 막힘·빈 목록으로 덮지 않음 → 다시 읽기 → 안내 사라짐', async () => {
    disk.set('captures', chips([chip]))
    failReads.add('captures')
    await mount(h(QuickAddBar))
    expect(alertIos('AI 정리')?.textContent).toContain('읽지 못했어요')
    await typeInto(inputOf('bar'), '정리할 글')
    expect(aiButton()?.disabled).toBe(true)
    failReads.delete('captures')
    await settle(100)
    expect(disk.get('captures')).toBe(chips([chip]))
    await pressIn(alertIos('AI 정리'), '다시 읽기')
    await settle(30)
    expect(alertIos('AI 정리')).toBeUndefined()
    expect(aiButton()?.disabled).toBe(false)
  })
  test('깨짐 → 안내·그대로, 버리고 새로(확인창)만 비워요', async () => {
    disk.set('captures', chips([{ id: 1 }]))
    await mount(h(QuickAddBar))
    expect(alertIos('AI 정리')?.textContent).toContain('깨져')
    await pressIn(alertIos('AI 정리'), '버리고 새로')
    await settle(30)
    expect(disk.get('captures')).toBe(JSON.stringify('[]'))
  })
  test('늦음 → 읽는 동안 새 정리 막힘 → 다 읽으면 열림', async () => {
    const open = gate('captures')
    await mount(h(QuickAddBar))
    await typeInto(inputOf('bar'), '정리할 글')
    expect(aiButton()?.disabled).toBe(true)
    await open()
    expect(aiButton()?.disabled).toBe(false)
  })
  test('쓰기 실패 → 안내 → 다음 쓰기가 닿으면 풀려요', async () => {
    disk.set('captures', chips([chip, { ...chip, id: 'run2', clientKey: 'k2' }]))
    await mount(h(QuickAddBar))
    failWrites.add('captures')
    await click(q<HTMLButtonElement>('button[aria-label="칩 닫기"]')!)
    await settle(30)
    expect(alertIos('AI 정리 이어서 할 기록을 기기에 남기지 못했어요')).toBeTruthy()
    failWrites.delete('captures')
    await click(q<HTMLButtonElement>('button[aria-label="칩 닫기"]')!)
    await settle(30)
    expect(alertIos('AI 정리 이어서 할 기록을 기기에 남기지 못했어요')).toBeUndefined()
  })
})

describe('규칙 E iOS: 끝나지 않은 요청(intents) × 읽기 실패·깨짐·늦음·복구됨·쓰기 실패(리뷰 22)', () => {
  const box: { current: ReturnType<typeof useIntents> | null } = { current: null }
  const Probe = () => { box.current = useIntents(); return null }
  const intent = { key: 'i1', kind: 'item', scope: 'http://127.0.0.1:3181|anon', at: 1, label: '보낸 할 일', payload: {} }
  const both = () => h(React.Fragment, null, h(IntentsNotice), h(Probe))
  test('읽기 실패 → 안내·새로 보내지 않음(기록 못 남김)·그대로 → 다시 읽기 → 풀림', async () => {
    disk.set('intents', JSON.stringify({ i0: { ...intent, key: 'i0' } }))
    failReads.add('intents')
    await mount(both())
    expect(alertIos('보낸 요청')?.textContent).toContain('읽지 못했어요')
    expect(box.current!.journal.blocked()).toContain('읽지 못해')
    expect(await box.current!.journal.put(intent as never)).toBe(false)
    failReads.delete('intents')
    await settle(100)
    expect(disk.get('intents')).toBe(JSON.stringify({ i0: { ...intent, key: 'i0' } }))
    await pressIn(alertIos('보낸 요청'), '다시 읽기')
    await settle(30)
    expect(box.current!.journal.blocked()).toBeNull()
  })
  test('깨짐 → 안내·그대로, 버리고 새로(확인창)만 비워요', async () => {
    disk.set('intents', 'bad')
    await mount(both())
    expect(alertIos('보낸 요청')?.textContent).toContain('깨져')
    await pressIn(alertIos('보낸 요청'), '버리고 새로')
    await settle(30)
    expect(disk.get('intents')).toBe('{}')
  })
  test('늦음 → 읽는 동안 새로 보내지 않음 → 다 읽으면 풀림', async () => {
    const open = gate('intents')
    await mount(both())
    expect(box.current!.journal.blocked()).toContain('읽는 중')
    expect(await box.current!.journal.put(intent as never)).toBe(false)
    await open()
    expect(box.current!.journal.blocked()).toBeNull()
  })
  test('쓰기 실패 → 먼저 기록이 닿지 않아 false(보내지 않음) + 안내', async () => {
    await mount(both())
    failWrites.add('intents')
    expect(await box.current!.journal.put(intent as never)).toBe(false)
    await settle(30)
    expect(alertIos('보낸 요청 이어서 할 기록을 기기에 남기지 못했어요')).toBeTruthy()
  })
})

describe('규칙 E iOS: 화면 설정(useStored — 오늘 메인·집중·목록·지금 판) × 읽기 실패·복구됨·쓰기 실패(리뷰 22)', () => {
  test('읽기 실패면 준비 아님·바꾸기 거절(+다시 읽기 알림) → 다시 읽기 → 바꾸기 닿음 · 쓰기 실패는 기기 저장 오류로 알림', async () => {
    const box: { v: string[]; set: ((v: string[]) => boolean) | null; ready: boolean; refused: string[]; retry: (() => void) | null } = { v: [], set: null, ready: false, refused: [], retry: null }
    const isKeys = (v: unknown): v is string[] => Array.isArray(v)
    const Probe = () => {
      const [v, set, ready] = useStoredIn(store, 'main', [] as string[], isKeys, (n, _problem, actions) => { box.refused.push(n); box.retry = actions.retry })
      Object.assign(box, { v, set, ready })
      return null
    }
    disk.set('main', JSON.stringify(['a']))
    failReads.add('main')
    await mount(h(Probe))
    expect(box.ready).toBe(false)
    expect(box.set!(['b'])).toBe(false)
    expect(box.refused).toEqual(['main'])
    failReads.delete('main')
    await act(async () => { box.retry!(); await sleep(20) })
    expect([box.ready, box.v]).toEqual([true, ['a']])
    expect(box.set!(['a', 'b'])).toBe(true)
    await settle(20)
    expect(disk.get('main')).toBe(JSON.stringify(['a', 'b']))
    failWrites.add('main')
    expect(box.set!(['a'])).toBe(true)
    await settle(20)
    expect(store.writeFailed('main')).toBe(true)
    expect(disk.get('main')).toBe(JSON.stringify(['a', 'b']))
  })
})

// 머지 뒤 P2(리뷰 24): 화면 설정 문제를 토스트(하나·5초) 대신 문제가 풀릴 때까지 남는 표시로. 상태가 바뀌면 표시도 바뀌어요(다시 읽어도 또 실패·깨짐으로 바뀜)
describe('화면 설정 문제 표시 — 풀릴 때까지 남아요(리뷰 24 P2)', () => {
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
  const isMain = (v: unknown): v is { day: string; keys: string[] } => !!v && typeof v === 'object' && Array.isArray((v as { keys?: unknown }).keys)
  const Prefs = () => {
    const focus = useStoredIn(store, 'focus', true, isBool)
    const main = useStoredIn(store, 'main', { day: '', keys: [] as string[] }, isMain)
    return h(React.Fragment, null, h(StoreProblemNotice, { label: '집중 모드', issue: focus[3] }), h(StoreProblemNotice, { label: '오늘 메인', issue: main[3] }))
  }
  const pressAlert = async (label: string) => { const b = alerts.at(-1)?.buttons?.find((x) => x.text === label); expect(b).toBeTruthy(); await act(async () => { b!.onPress?.(); await sleep(20) }) }
  test('두 설정이 함께 깨져도 둘 다 남고(6초 뒤에도), 하나를 초기화(확인창)하면 그것만 풀려요', async () => {
    disk.set('focus', '"깨짐"')
    disk.set('main', '[1]')
    await mount(h(Prefs))
    expect(alertIos('집중 모드')?.textContent).toContain('깨져')
    expect(alertIos('오늘 메인')?.textContent).toContain('깨져')
    await settle(6000)
    expect(alertIos('집중 모드')).toBeTruthy()
    expect(alertIos('오늘 메인')).toBeTruthy()
    await pressIn(alertIos('집중 모드'), '초기화')
    expect(disk.get('focus')).toBe('"깨짐"')
    expect(alerts.at(-1)?.title).toBe('집중 모드를 초기화할까요?')
    await pressAlert('초기화')
    await settle(20)
    expect(disk.get('focus')).toBe('true')
    expect(alertIos('집중 모드')).toBeUndefined()
    expect(alertIos('오늘 메인')?.textContent).toContain('깨져')
    expect(disk.get('main')).toBe('[1]')
  }, 15000)
  test('읽기 실패 → 다시 읽기 → 또 읽기 실패면 그대로 남고, 다시 읽기 → 깨짐이면 초기화 길이 생겨요', async () => {
    disk.set('focus', '"깨짐"')
    failReads.add('focus')
    await mount(h(Prefs))
    expect(alertIos('집중 모드')?.textContent).toContain('읽지 못했어요')
    expect([...alertIos('집중 모드')!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['다시 읽기'])
    await pressIn(alertIos('집중 모드'), '다시 읽기')
    await settle(30)
    expect(alertIos('집중 모드')?.textContent).toContain('읽지 못했어요')
    failReads.delete('focus')
    await pressIn(alertIos('집중 모드'), '다시 읽기')
    await settle(30)
    expect(alertIos('집중 모드')?.textContent).toContain('깨져')
    expect([...alertIos('집중 모드')!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['다시 읽기', '초기화'])
  })
})

// 머지 뒤 P2(리뷰 25): 다시 읽는 동안 다시 그려져도 안내가 남고("다시 읽는 중"), 초기화 쓰기가 실패하면 "초기화하지 못했어요 · 다시 시도"
describe('화면 설정 표시 — 다시 읽는 중·초기화 실패(리뷰 25 P2)', () => {
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
  let renders = 0
  const Focus = () => { renders++; const f = useStoredIn(store, 'focus', true, isBool); return h(StoreProblemNotice, { label: '집중 모드', issue: f[3] }) }
  test('읽기 실패 → 다시 읽기가 늦는 동안 다른 이유로 다시 그려져도 안내가 남고 "다시 읽는 중" → 끝나면 결과대로', async () => {
    disk.set('focus', 'true')
    failReads.add('focus')
    await mount(h(Focus))
    expect(alertIos('집중 모드')?.textContent).toContain('읽지 못했어요')
    failReads.delete('focus')
    const open = gate('focus')
    await pressIn(alertIos('집중 모드'), '다시 읽기')
    const before = renders
    await mount(h(Focus))
    expect(renders).toBeGreaterThan(before)
    expect(alertIos('집중 모드')?.textContent).toContain('다시 읽는 중')
    await open()
    expect(alertIos('집중 모드')).toBeUndefined()
  })
  test('깨짐 → 초기화(확인창) → 쓰기 실패면 문제 그대로 + "초기화하지 못했어요 · 다시 시도" → 쓰기가 닿으면 풀려요', async () => {
    disk.set('focus', '"깨짐"')
    await mount(h(Focus))
    failWrites.add('focus')
    await pressIn(alertIos('집중 모드'), '초기화')
    await act(async () => { alerts.at(-1)!.buttons!.find((b) => b.text === '초기화')!.onPress!(); await sleep(30) })
    expect(disk.get('focus')).toBe('"깨짐"')
    expect(alertIos('집중 모드')?.textContent).toContain('초기화하지 못했어요')
    failWrites.delete('focus')
    await pressIn(alertIos('집중 모드'), '다시 시도')
    await act(async () => { alerts.at(-1)!.buttons!.find((b) => b.text === '초기화')!.onPress!(); await sleep(30) })
    expect(disk.get('focus')).toBe('true')
    expect(alertIos('집중 모드')).toBeUndefined()
  })
})
