// 일 하나의 실행 중 노트 초안(대화 묶음은 레인 3 features/ai/runLogic.ts groupThreads)
import type { Run } from '@direction-board/contracts'

/** 아직 노트에 넣지 않은 AI 초안(웹 work-view: kind draft, applied 아님) */
export const pendingDraft = (runs: Run[]) => [...runs].sort((a, b) => b.created_at - a.created_at).find((r) => r.kind === 'draft' && !r.applied) ?? null
