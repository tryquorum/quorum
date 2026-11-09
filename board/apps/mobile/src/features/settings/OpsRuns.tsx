import React from 'react'
import { refreshOps, useOps } from '../../api/ops'
import { Screen } from '../../ui/Screen'
import { ErrorCard, Loading } from '../../ui/StateView'
import { Row } from '../../ui/Row'
import { Section } from '../../ui/Section'
import { OpsRunsList } from './OpsRunsList'

/** 지난 운영 순회 모두(공용 상세 OpsRuns) */
export function OpsRuns() {
  const { data, status, error } = useOps(true)
  return (
    <Screen onRefresh={() => refreshOps()}>
      {status === 'forbidden' ? (
        <Section><Row title="운영 순회는 이 맥의 주인만 볼 수 있어요" /></Section>
      ) : !data ? (
        status === 'error' ? <ErrorCard error={error} retry={() => void refreshOps()} /> : <Loading />
      ) : (
        <OpsRunsList runs={data.runs} title={`지난 순회 ${data.runs.length}개`} />
      )}
    </Screen>
  )
}
