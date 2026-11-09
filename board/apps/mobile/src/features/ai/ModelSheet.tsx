import React, { useState } from 'react'
import { StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { effortLabel, findModel, pickEffort, searchModels, type ModelCatalog, type ModelChoice, type ModelInfo, type ProviderInfo } from '@direction-board/contracts/models'
import { Chip } from '../../ui/Chip'
import { Row } from '../../ui/Row'
import { Section } from '../../ui/Section'
import { Sheet } from '../../ui/Sheet'
import { ErrorCard, Loading } from '../../ui/StateView'
import { schemeColors, space, styles } from '../../ui/theme'

/** 모델·생각 수준 고르기 시트(웹 ModelPicker·EffortPicker). 만료된 제공자는 고를 수 없어요 */
export function ModelSheet({
  visible,
  onClose,
  cat,
  choice,
  onChange,
  title = '모델',
  loadError,
  onRetry,
}: {
  visible: boolean
  onClose: () => void
  cat: ModelCatalog | null
  choice: ModelChoice | null
  onChange: (c: ModelChoice) => void
  title?: string
  /** 모델 목록을 못 읽었으면(403·연결 끊김) 이유와 다시 시도 */
  loadError?: unknown
  onRetry?: () => void
}) {
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [q, setQ] = useState('')
  const current = findModel(cat, choice)
  const pick = (p: ProviderInfo, m: ModelInfo) => onChange({ provider: p.id, model: m.id, effort: pickEffort(m, choice?.effort) })
  const row = (p: ProviderInfo, m: ModelInfo) => {
    const selected = choice?.provider === p.id && choice?.model === m.id
    const ok = p.status === 'ok'
    return (
      <Row
        key={p.id + m.id}
        title={m.name}
        meta={ok ? (q ? p.label : undefined) : '만료됨'}
        onPress={ok ? () => pick(p, m) : undefined}
        trailing={selected ? <SymbolView name="checkmark" size={16} tintColor={c.ink} accessibilityLabel="고름" /> : null}
      />
    )
  }
  const close = () => {
    setQ('')
    onClose()
  }
  const hits = searchModels(cat, q)
  const efforts = current?.model.efforts ?? []
  return (
    <Sheet visible={visible} title={title} onClose={close} action={{ label: '완료', onPress: close }}>
      {!cat ? (
        loadError ? <ErrorCard error={loadError} retry={() => onRetry?.()} /> : <Loading label="모델 목록을 불러오는 중이에요" />
      ) : (
        <>
          <TextInput
            accessibilityLabel="모델 찾기"
            placeholder="모델 찾기"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            value={q}
            onChangeText={setQ}
            style={styles.input}
          />
          {efforts.length > 1 && choice ? (
            <View style={s.efforts}>
              <Text style={styles.meta}>생각 수준</Text>
              <View style={s.chips}>
                {efforts.map((e) => (
                  <Chip key={e} label={effortLabel(e)} selected={choice.effort === e} onPress={() => onChange({ ...choice, effort: e })} />
                ))}
              </View>
            </View>
          ) : null}
          {q.trim() ? (
            hits.length ? <Section title="찾은 모델">{hits.map((h) => row(h.provider, h.model))}</Section> : <Text style={styles.meta}>맞는 모델이 없어요</Text>
          ) : (
            cat.providers.map((p) => (
              <Section key={p.id} title={p.status === 'ok' ? p.label : `${p.label} · 만료됨`}>
                {p.models.map((m) => row(p, m))}
              </Section>
            ))
          )}
        </>
      )}
    </Sheet>
  )
}

/** 입력 줄 위의 모델·수준 칩. 누르면 시트 */
export function ModelChip({ cat, choice, onPress }: { cat: ModelCatalog | null; choice: ModelChoice | null; onPress: () => void }) {
  const found = findModel(cat, choice)
  const name = found?.model.name ?? choice?.model ?? '모델'
  const effort = choice && (found?.model.efforts.length ?? 0) > 1 ? ` · ${effortLabel(choice.effort)}` : ''
  return <Chip label={`${name}${effort}`} onPress={onPress} />
}
const s = StyleSheet.create({
  efforts: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
})
