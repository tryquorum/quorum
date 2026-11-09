// 필터·정렬·표시할 속성 시트(웹 docs-view.tsx 의 필터 패널과 같은 항목). 고르면 바로 걸리고 시트를 닫아도 남아요.
import React, { useState } from 'react'
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import type { DocStatus, SchemaResult } from '@direction-board/contracts'
import type { PropOp } from '../../api/docs'
import { showActions } from '../../ui/actions'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Sheet } from '../../ui/Sheet'
import { space, styles } from '../../ui/theme'
import { kindLabel, statusLabel } from './labels'
import { PROP_OPS, propertyFilterIssue } from './props'

export type FilterState = {
  kind: string
  area: string
  status: DocStatus | ''
  tags: string[]
  includeAi: boolean
  propKey: string
  propOp: PropOp
  propValue: string
  sort: string
}
export const EMPTY_FILTERS: FilterState = { kind: '', area: '', status: '', tags: [], includeAi: false, propKey: '', propOp: 'eq', propValue: '', sort: 'updated' }
const TAG_PREVIEW = 12

/** 걸린 필터 칩(웹 active 목록과 같은 순서·글) */
export function activeFilters(f: FilterState, set: (patch: Partial<FilterState>) => void): { key: string; label: string; clear: () => void }[] {
  const noValue = f.propOp === 'exists' || f.propOp === 'missing'
  return [
    ...(f.kind ? [{ key: 'kind', label: kindLabel(f.kind), clear: () => set({ kind: '' }) }] : []),
    ...(f.area ? [{ key: 'area', label: f.area, clear: () => set({ area: '' }) }] : []),
    ...(f.status ? [{ key: 'status', label: statusLabel(f.status), clear: () => set({ status: '' }) }] : []),
    ...(f.includeAi ? [{ key: 'ai', label: 'AI 초안 포함', clear: () => set({ includeAi: false }) }] : []),
    ...(f.propKey ? [{ key: 'prop', label: `${f.propKey} ${PROP_OPS[f.propOp]}${noValue ? '' : ' ' + f.propValue}`, clear: () => set({ propKey: '', propValue: '' }) }] : []),
    ...(f.sort !== 'updated' ? [{ key: 'sort', label: f.sort.startsWith('-') ? `${f.sort.slice(6)} 내림차순` : `${f.sort.slice(5)} 오름차순`, clear: () => set({ sort: 'updated' }) }] : []),
    ...f.tags.map((tag) => ({ key: 'tag:' + tag, label: '#' + tag, clear: () => set({ tags: f.tags.filter((t) => t !== tag) }) })),
  ]
}
export function filterIssue(f: FilterState, schema: SchemaResult | undefined): string | null {
  if (!f.propKey) return null
  if (!schema) return '속성 정보를 불러온 뒤 검색할 수 있어요.'
  return propertyFilterIssue(schema.props?.find((p) => p.key === f.propKey)?.type, f.propOp, f.propValue)
}

function Field({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <View style={s.field}>
      <Text style={styles.meta}>{label}</Text>
      <Button variant="outline" title={value} onPress={onPress} />
    </View>
  )
}

export function FilterSheet({
  visible,
  onClose,
  filters,
  set,
  schema,
  schemaError,
  retrySchema,
  showColumns,
  columns,
  setColumns,
}: {
  visible: boolean
  onClose: () => void
  filters: FilterState
  set: (patch: Partial<FilterState>) => void
  schema: SchemaResult | undefined
  schemaError: boolean
  retrySchema: () => void
  showColumns: boolean
  columns: string[]
  setColumns: (columns: string[]) => void
}) {
  const [allTags, setAllTags] = useState(false)
  const pick = (title: string, options: { label: string; value: string }[], onPick: (value: string) => void) =>
    showActions(options.map((o) => ({ label: o.label, onPress: () => onPick(o.value) })), title)
  const tags = [...(schema?.tags ?? []), ...filters.tags.filter((t) => !schema?.tags.some((x) => x.tag === t)).map((tag) => ({ tag, count: 0 }))].filter(({ tag }) => !tag.includes(','))
  const shown = allTags ? tags : [...tags].sort((a, b) => b.count - a.count).slice(0, TAG_PREVIEW)
  const propType = schema?.props?.find((p) => p.key === filters.propKey)?.type
  const issue = filterIssue(filters, schema)
  return (
    <Sheet visible={visible} title="필터" onClose={onClose} action={{ label: '완료', onPress: onClose }}>
      {schemaError ? (
        <View style={s.group}>
          <Text accessibilityRole="alert" style={styles.meta}>
            필터를 불러오지 못했어요
          </Text>
          <Button variant="outline" title="다시 시도" onPress={retrySchema} />
        </View>
      ) : null}
      <View style={s.group}>
        <Field label="종류" value={filters.kind ? kindLabel(filters.kind) : '모든 종류'} onPress={() => pick('종류', [{ label: '모든 종류', value: '' }, ...(schema?.kinds ?? []).map((k) => ({ label: kindLabel(k), value: k }))], (kind) => set({ kind }))} />
        <Field label="영역" value={filters.area || '모든 영역'} onPress={() => pick('영역', [{ label: '모든 영역', value: '' }, ...(schema?.areas ?? []).map((a) => ({ label: a, value: a }))], (area) => set({ area }))} />
        <Field
          label="상태"
          value={filters.status ? statusLabel(filters.status) : '모든 상태'}
          onPress={() => pick('상태', [{ label: '모든 상태', value: '' }, ...(schema?.statuses ?? []).map((v) => ({ label: statusLabel(v), value: v }))], (status) => set({ status: status as DocStatus | '' }))}
        />
        <View style={s.switchRow}>
          <Text style={styles.text}>AI 초안 포함</Text>
          <Switch accessibilityLabel="AI 초안 포함" value={filters.includeAi} onValueChange={(includeAi) => set({ includeAi })} />
        </View>
      </View>
      {schema?.props?.length ? (
        <View style={s.group}>
          <Text accessibilityRole="header" style={styles.strong}>
            속성 조건
          </Text>
          <Field label="속성" value={filters.propKey || '없음'} onPress={() => pick('속성', [{ label: '없음', value: '' }, ...schema.props.map((p) => ({ label: p.key, value: p.key }))], (propKey) => set({ propKey, propValue: '' }))} />
          {filters.propKey ? (
            <Field label="조건" value={PROP_OPS[filters.propOp]} onPress={() => pick('조건', Object.entries(PROP_OPS).map(([value, label]) => ({ label, value })), (op) => set({ propOp: op as PropOp }))} />
          ) : null}
          {filters.propKey && filters.propOp !== 'exists' && filters.propOp !== 'missing' ? (
            <TextInput
              accessibilityLabel="속성 필터 값"
              placeholder="값"
              value={filters.propValue}
              onChangeText={(propValue) => set({ propValue })}
              keyboardType={propType === 'number' ? 'numbers-and-punctuation' : 'default'}
              autoCapitalize="none"
              style={styles.input}
            />
          ) : null}
          {issue ? <Text style={styles.meta}>{issue}</Text> : null}
          <Field
            label="정렬"
            value={filters.sort === 'updated' ? '최근 수정' : filters.sort.startsWith('-') ? `${filters.sort.slice(6)} 내림차순` : `${filters.sort.slice(5)} 오름차순`}
            onPress={() =>
              pick('정렬', [{ label: '최근 수정', value: 'updated' }, ...schema.props.flatMap((p) => [{ label: `${p.key} 오름차순`, value: `prop:${p.key}` }, { label: `${p.key} 내림차순`, value: `-prop:${p.key}` }])], (sort) => set({ sort }))
            }
          />
        </View>
      ) : null}
      {showColumns && schema?.props?.length ? (
        <View style={s.group}>
          <Text accessibilityRole="header" style={styles.strong}>
            목록에 보일 속성
          </Text>
          <View style={s.chips}>
            {schema.props.map((p) => (
              <Chip key={p.key} label={p.key} selected={columns.includes(p.key)} onPress={() => setColumns(columns.includes(p.key) ? columns.filter((k) => k !== p.key) : [...columns, p.key])} />
            ))}
          </View>
        </View>
      ) : null}
      {tags.length ? (
        <View style={s.group}>
          <Text accessibilityRole="header" style={styles.strong}>
            태그
          </Text>
          <View style={s.chips}>
            {shown.map(({ tag, count }) => (
              <Chip key={tag} label={`${tag} ${count}`} selected={filters.tags.includes(tag)} onPress={() => set({ tags: filters.tags.includes(tag) ? filters.tags.filter((t) => t !== tag) : [...filters.tags, tag] })} />
            ))}
          </View>
          {tags.length > TAG_PREVIEW ? <Button variant="plain" title={allTags ? '접기' : `태그 ${tags.length - TAG_PREVIEW}개 더`} onPress={() => setAllTags((v) => !v)} /> : null}
        </View>
      ) : null}
    </Sheet>
  )
}
const s = StyleSheet.create({
  group: { gap: space.md },
  field: { gap: space.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: space.target },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
})
