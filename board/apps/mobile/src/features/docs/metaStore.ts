// 속성 입력 초안 보관(웹 document-metadata.tsx 의 archivedDrafts 자리). 노트 초안(notes/drafts.ts)과 같은 열쇠 규칙:
// "서버 주소 + 확인한 계정 이메일 + ref" 의 SHA-256 파일. 계정을 모르면 보관하지 않고 false 를 돌려줘요.
import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import type { DraftKey } from '../../notes/drafts'
import type { SavedMeta } from './metaDraft'

async function metaFile(key: DraftKey): Promise<File | null> {
  if (!key.email) return null
  const name = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${key.origin}\n${key.email.toLowerCase()}\n${key.ref}`)
  const dir = new Directory(Paths.document, 'meta-drafts')
  if (!dir.exists) dir.create()
  return new File(dir, `${name}.json`)
}
/** saved 가 null 이면 지워요. 보관(또는 지우기)을 확인했으면 true */
export async function keepMeta(key: DraftKey, saved: SavedMeta | null): Promise<boolean> {
  try {
    const file = await metaFile(key)
    if (!file) return false
    if (!saved) {
      if (file.exists) file.delete()
      return true
    }
    if (!file.exists) file.create()
    await file.write(JSON.stringify(saved))
    return true
  } catch {
    return false
  }
}
export async function readMeta(key: DraftKey): Promise<SavedMeta | null> {
  try {
    const file = await metaFile(key)
    if (!file?.exists) return null
    return JSON.parse(await file.text()) as SavedMeta
  } catch {
    return null
  }
}
