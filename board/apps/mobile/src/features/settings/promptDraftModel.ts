// 운영 순회 지시문 초안의 순수 규칙(파일은 promptDraft.ts). 웹 prompt-editor 와 같은 판단이에요.

export type PromptDraft = { text: string; rev: number }

/** 저장된 초안을 읽어요. 모양이 다르면 버려요 */
export function parseDraft(raw: string | null): PromptDraft | null {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null
    if (!v || typeof v !== 'object') return null
    const { text, rev } = v as { text?: unknown; rev?: unknown }
    return typeof text === 'string' && typeof rev === 'number' && Number.isInteger(rev) ? { text, rev } : null
  } catch {
    return null
  }
}

/** 되살릴 초안: 서버 글과 다를 때만(같으면 이미 저장된 것) */
export function restorable(draft: PromptDraft | null, server: string): PromptDraft | null {
  return draft && draft.text !== server ? draft : null
}

/** 저장 성공 뒤: 저장하는 동안 더 쓴 글이 있으면 새 rev 위의 초안으로 이어가고, 아니면 초안을 비워요 */
export function afterSave(latest: string, sent: string, savedRev: number): PromptDraft | null {
  return latest === sent ? null : { text: latest, rev: savedRev }
}
