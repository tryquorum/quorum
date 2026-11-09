// 빠른 추가 여러 단계(contracts createWork)를 범위 고정 클라이언트로. 새 추가는 화면을 연 시점의 범위(useWriteScope), 재개는 기록의 시작 범위(resumeClient)로만.
// 흐름(먼저 기록·결과 불명은 읽기만·done 만 끝)은 웹과 같이 쓰는 계약 submitWithRecord(contracts/quick-recovery.ts, 리뷰 16). 화면 훅 없이 실제 클라이언트로 시험해요.
import type { Item } from '@direction-board/contracts'
import { checkCreate, createWork, type CreateResult, type Draft } from '@direction-board/contracts/quick-add'
import { settleCheck, submitWithRecord, type Pending, type Resume, type Submitted } from '@direction-board/contracts/quick-recovery'
import { resumeClient, type ScopedClient } from '../../../api/client'
import { callWith } from '../../../api/work'

export type { Done, Submitted } from '@direction-board/contracts/quick-recovery'

/** 웹 lib/api.ts uid 와 같은 모양(서버 항목 id 규칙 [A-Za-z0-9_-]{4,40}) */
export const uid = () => Math.random().toString(36).slice(2, 12)

export async function createScoped(a: {
  /** 화면을 연 시점의 범위 고정 클라이언트 */
  scope: ScopedClient
  /** 항목 저장: true·false(거절)·"unknown"(결과 모름). 범위가 바뀌면 ScopeChangedError 로 거절해요 */
  save: (it: Item) => Promise<boolean | 'unknown'>
  draft: Draft
  resume?: Resume
  id?: () => string
  now?: () => number
}): Promise<CreateResult & { scope: string }> {
  const c = a.resume ? resumeClient(a.scope.origin, a.resume.scope, () => a.scope.same()) : a.scope
  const save = async (it: Item) => {
    c.check()
    return a.save(it)
  }
  const r = await createWork(a.draft, { save, call: callWith(c), id: a.id ?? uid, now: a.now ?? Date.now }, a.resume ? { id: a.resume.id, from: a.resume.from } : undefined)
  return { ...r, scope: c.scope }
}

/** 결과 불명 기록을 시작 범위의 클라이언트로 읽어 확인만(contracts checkCreate, 쓰기 0건) */
const readCheck = (scope: ScopedClient) => (p: Pending) => checkCreate(p.draft, callWith(resumeClient(scope.origin, p.scope, () => scope.same())), { id: p.id, from: p.from })

/** 결과 불명 기록의 확인(읽기만, 리뷰 9). 못 읽으면 기록 그대로 */
export async function checkPending(scope: ScopedClient, p: Pending): Promise<Submitted> {
  try {
    return settleCheck(await readCheck(scope)(p), p)
  } catch {
    return { kind: 'pending', pending: p, note: '아직 확인하지 못했어요 · 잠시 뒤 다시 확인해 주세요' }
  }
}

/**
 * 빠른 추가 한 번(useCreateWork 가 부름). 계약 submitWithRecord 에 iOS 의 범위 고정 클라이언트를 붙여요:
 * 확인은 기록의 시작 범위로 읽기만, 보내기는 새 추가면 화면을 연 시점의 범위·재개면 기록의 시작 범위(createScoped).
 */
export function createWithRecord(a: {
  text: string
  makeDraft: () => Draft
  pending: Pending | null
  writeAhead: (p: Pending) => Promise<boolean>
  scope: ScopedClient
  save: (it: Item) => Promise<boolean | 'unknown'>
  id?: () => string
}): Promise<Submitted> {
  return submitWithRecord({
    text: a.text,
    makeDraft: a.makeDraft,
    pending: a.pending,
    writeAhead: a.writeAhead,
    scope: a.scope.scope,
    same: () => a.scope.same(),
    check: readCheck(a.scope),
    create: (draft, id, resume) => createScoped({ scope: a.scope, save: a.save, draft, id: () => id, ...(resume ? { resume } : {}) }),
    id: a.id ?? uid,
  })
}
