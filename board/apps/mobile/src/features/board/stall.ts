// 준비 신호가 늦을 때(리뷰 22 P2): active 가 stallTimer.ms 동안 이어지면 true. 원인 안내와 다시 시도를 보여 주는 데 써요
import { useEffect, useState } from 'react'
import { stallTimer } from '@direction-board/contracts/quick-recovery'

export function useStall(active: boolean): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!active) return setLate(false)
    const t = setTimeout(() => setLate(true), stallTimer.ms)
    return () => clearTimeout(t)
  }, [active])
  return active && late
}
