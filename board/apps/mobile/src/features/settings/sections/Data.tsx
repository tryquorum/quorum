import React from 'react'
import type { SettingsInfo } from '@direction-board/contracts'
import { Section } from '../../../ui/Section'
import { CopyButton, SettingRow } from '../parts'

/** 데이터: DB·거울 위치(맥 주인만, 읽기 전용) */
export function DataSection({ info }: { info: SettingsInfo }) {
  if (!info.paths) return <Section><SettingRow id="data-paths" label="DB·거울 위치" info="맥 주인만 볼 수 있어요" /></Section>
  return (
    <Section title="DB·거울 위치">
      <SettingRow id="data-paths" label="DB" info={info.paths.db}>
        <CopyButton text={info.paths.db} label="DB 경로 복사" />
      </SettingRow>
      <SettingRow id="data-vault" label="거울" info={info.paths.vault}>
        <CopyButton text={info.paths.vault} label="거울 경로 복사" />
      </SettingRow>
    </Section>
  )
}

/** 정보: 서버 버전·커밋 */
export function AboutSection({ info }: { info: SettingsInfo }) {
  return (
    <Section>
      <SettingRow id="version" label="서버 버전·커밋" info={`${info.version}${info.commit ? ` · ${info.commit}` : ''}`} />
    </Section>
  )
}
