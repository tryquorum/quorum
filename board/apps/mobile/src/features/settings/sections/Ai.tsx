import React, { useState } from 'react'
import { effortLabel, findModel } from '@direction-board/contracts/models'
import { errorMessage } from '../../../api/client'
import { Button } from '../../../ui/Button'
import { Section } from '../../../ui/Section'
import { ModelSheet } from '../../ai/ModelSheet'
import { useModels } from '../../ai/useModels'
import { SettingRow } from '../parts'

/** AI: 새 대화가 처음 고르는 모델·생각 수준(AI 탭·일 대화와 같은 값). 순회 모델은 운영 순회에서 따로 */
export function AiSection() {
  const { cat, choice, setChoice, sheet: modelSheet } = useModels()
  const [open, setOpen] = useState(false)
  const found = findModel(cat, choice)
  const efforts = found?.model.efforts.length ?? 0
  return (
    <Section>
      <SettingRow id="default-model" label="기본 모델" info={modelSheet.loadError ? `모델 목록을 불러오지 못했어요 · ${errorMessage(modelSheet.loadError)}` : 'AI 탭과 일 대화가 처음 고르는 모델이에요. 운영 순회 모델은 운영 순회에서 따로 정해요'}>
        <Button
          variant="plain"
          title={cat ? (found?.model.name ?? choice?.model ?? '모델') : modelSheet.loadError ? '다시 불러오기' : '불러오는 중'}
          disabled={!cat && !modelSheet.loadError}
          onPress={() => (cat ? setOpen(true) : modelSheet.onRetry())}
        />
      </SettingRow>
      <SettingRow id="default-effort" label="생각 수준" info={cat && efforts <= 1 ? '이 모델은 고를 수준이 없어요' : undefined}>
        {choice && efforts > 1 ? <Button variant="plain" title={effortLabel(choice.effort)} onPress={() => setOpen(true)} /> : null}
      </SettingRow>
      <ModelSheet visible={open} onClose={() => setOpen(false)} cat={cat} choice={choice} onChange={setChoice} title="기본 모델" {...modelSheet} />
    </Section>
  )
}
