import React from 'react'
import { Alert } from 'react-native'
import type { Board } from '@direction-board/contracts'
import { AREA_COLORS } from '@direction-board/contracts/board-text'
import { showActions } from '../../../ui/actions'
import { Row } from '../../../ui/Row'
import { Section } from '../../../ui/Section'
import { Sheet } from '../../../ui/Sheet'
import { Dot } from '../parts'

const COLOR_KO = ['파랑', '청록', '황토', '보라', '초록', '분홍', '회색']

/** 판 영역 고치기(이름·색·추가·지우기). 저장은 PATCH /api/boards/:id {areas} */
export function AreasSheet({ board, visible, onClose, onSave }: { board: Board | undefined; visible: boolean; onClose: () => void; onSave: (areas: { id?: string; name: string; color?: string }[]) => void }) {
  const areas = board?.areas ?? []
  const put = (next: { id?: string; name: string; color?: string }[]) => onSave(next)
  const rename = (i: number) =>
    Alert.prompt('영역 이름', '30자까지', (v) => { const name = (v ?? '').trim(); if (name) put(areas.map((a, j) => (j === i ? { ...a, name } : a))) }, 'plain-text', areas[i].name)
  const recolor = (i: number) => showActions(AREA_COLORS.map((color, k) => ({ label: COLOR_KO[k] ?? color, onPress: () => put(areas.map((a, j) => (j === i ? { ...a, color } : a))) })), '영역 색')
  const remove = (i: number) =>
    Alert.alert(`${areas[i].name} 영역을 지울까요?`, '그 영역에 있던 일은 영역 없음이 돼요', [{ text: '취소', style: 'cancel' }, { text: '지우기', style: 'destructive', onPress: () => put(areas.filter((_, j) => j !== i)) }])
  const add = () => Alert.prompt('새 영역', '30자까지', (v) => { const name = (v ?? '').trim(); if (name) put([...areas, { name }]) })
  return (
    <Sheet visible={visible} title={`${board?.name ?? ''} 영역`} onClose={onClose}>
      <Section title="영역" count={areas.length}>
        {areas.map((a, i) => (
          <Row key={a.id} title={a.name} leading={<Dot color={a.color} />} onPress={() => rename(i)} actions={[{ label: '이름 바꾸기', onPress: () => rename(i) }, { label: '색 바꾸기', onPress: () => recolor(i) }, { label: '지우기', destructive: true, onPress: () => remove(i) }]} />
        ))}
        <Row title="+ 영역 추가" onPress={add} />
      </Section>
    </Sheet>
  )
}
