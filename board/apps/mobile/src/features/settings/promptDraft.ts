// 운영 순회 지시문 초안 보관. notes/drafts.ts 처럼 "서버 주소 + 확인한 계정 이메일" 별 파일이라
// 다른 서버·계정의 초안을 되살리거나 덮지 않아요. 계정을 모르면 보관하지 않고(false) 화면 메모리에만 둬요.
import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { parseDraft, type PromptDraft } from './promptDraftModel'

export type DraftOwner = { origin: string; email: string | null }

async function draftFile(owner: DraftOwner): Promise<File | null> {
  if (!owner.email) return null
  const name = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${owner.origin}\n${owner.email.toLowerCase()}`)
  const dir = new Directory(Paths.document, 'ops-drafts')
  if (!dir.exists) dir.create()
  return new File(dir, `${name}.json`)
}

export async function readPromptDraft(owner: DraftOwner): Promise<PromptDraft | null> {
  try {
    const f = await draftFile(owner)
    return f?.exists ? parseDraft(await f.text()) : null
  } catch {
    return null
  }
}

/** null 이면 지워요. 보관을 확인했으면 true */
export async function keepPromptDraft(owner: DraftOwner, draft: PromptDraft | null): Promise<boolean> {
  try {
    const f = await draftFile(owner)
    if (!f) return false
    if (!draft) {
      if (f.exists) f.delete()
      return true
    }
    if (!f.exists) f.create()
    f.write(JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}
