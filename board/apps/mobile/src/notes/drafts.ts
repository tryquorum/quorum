// 노트 저장 상태(초안) 보관(레인 1·2 공용). "서버 주소 + 확인한 계정 이메일 + ref" 별 파일이라 다른 서버·계정의 같은 ref 초안이
// 섞이지 않아요. 계정을 모르면 보관하지 않고(false), 쓰기 실패도 false 로 알려 화면이 "기기에 보관하지 못했어요"를 띄우게 해요.
import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import type { NoteState } from './noteSaver'

export type DraftKey = { origin: string; email: string | null; ref: string }

async function draftFile(key: DraftKey): Promise<File | null> {
  if (!key.email) return null
  const name = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${key.origin}\n${key.email.toLowerCase()}\n${key.ref}`)
  const dir = new Directory(Paths.document, 'note-drafts')
  if (!dir.exists) dir.create()
  return new File(dir, `${name}.json`)
}

/** 깨끗한 상태면 파일을 지우고, 아니면 써요. 보관을 확인했으면 true */
export async function keepDraft(key: DraftKey, state: NoteState): Promise<boolean> {
  try {
    const file = await draftFile(key)
    if (!file) return false
    if (state.status === 'clean' && !state.backups.length) {
      if (file.exists) file.delete()
      return true
    }
    if (!file.exists) file.create()
    await file.write(JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export async function readDraft(key: DraftKey): Promise<NoteState | null> {
  try {
    const file = await draftFile(key)
    if (!file?.exists) return null
    const value: unknown = JSON.parse(await file.text())
    return value && typeof value === 'object' && typeof (value as NoteState).draft === 'string' && typeof (value as NoteState).version === 'number' ? (value as NoteState) : null
  } catch {
    return null
  }
}
