import { useMemo } from 'react'
import { validChoice, type ModelCatalog, type ModelChoice } from '@direction-board/contracts/models'
import { useQuery } from '../../api/query'
import { runsApi } from '../../api/runs'
import { useServer } from '../../server'
import { setPrefs, usePrefs } from '../settings/prefs'

/** 모델 카탈로그(공용 캐시)와 기본 모델. 고른 값이 만료·사라졌으면 서버 기본(웹 useChoice 와 같은 규칙) */
export function useModels() {
  const { origin } = useServer()
  const query = useQuery<ModelCatalog>('ai/models', () => runsApi.models(origin))
  const prefs = usePrefs()
  const cat = query.data ?? null
  const choice = useMemo(() => validChoice(cat, prefs.model), [cat, prefs.model])
  /** 시트에 넘길 목록 오류(권한·연결)와 다시 읽기 */
  const sheet = { loadError: query.status === 'error' ? query.error : undefined, onRetry: () => void query.refresh() }
  return { cat, query, choice, sheet, setChoice: (c: ModelChoice) => setPrefs({ model: c }) }
}
