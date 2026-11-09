import type { SettingsInfo } from '@direction-board/contracts'
import { api } from '../../api/client'
import { useQuery } from '../../api/query'
import { useServer } from '../../server'
import type { DraftOwner } from './promptDraft'

/** 지시문 초안의 주인(서버 주소 + 서버가 확인한 계정). 계정을 아직 모르면 email 이 null 이라 보관하지 않아요 */
export function useDraftOwner(): DraftOwner & { known: boolean } {
  const { origin } = useServer()
  const info = useQuery<SettingsInfo>('settings', () => api.settings(origin))
  return { origin, email: info.data?.me.email ?? null, known: info.data !== undefined || info.status === 'error' }
}
