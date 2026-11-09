import React, { useState } from 'react'
import { Text, TextInput, useColorScheme } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { SFSymbol } from 'expo-symbols'
import { SymbolView } from 'expo-symbols'
import { searchSettings, type SettingsSectionId } from '@direction-board/contracts/settings-registry'
import type { StackParams } from '../../navigation/routes'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { Section } from '../../ui/Section'
import { schemeColors, styles } from '../../ui/theme'
import { OpsChip } from './OpsChip'
import { MOBILE_ITEMS, MOBILE_SECTIONS, mobileSectionTitle } from './registry'

export const SECTION_ICON: Record<SettingsSectionId, SFSymbol> = {
  general: 'slider.horizontal.3',
  account: 'person.crop.circle',
  ai: 'cpu',
  ops: 'checklist',
  connections: 'powerplug',
  shortcuts: 'hand.tap',
  data: 'cylinder',
  about: 'info.circle',
}

/** 설정 루트(웹 설정창 섹션 목록): 운영 순회 칩, 설정 찾기, 섹션 8개. 섹션은 SettingsSection 으로 쌓여요 */
export function Settings() {
  const navigation = useNavigation<NativeStackNavigationProp<StackParams>>()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [q, setQ] = useState('')
  const hits = searchSettings(q, 8, MOBILE_ITEMS, MOBILE_SECTIONS)
  return (
    <Screen keyboard>
      <TextInput
        accessibilityLabel="설정 찾기"
        placeholder="설정 찾기"
        placeholderTextColor={c.muted}
        clearButtonMode="while-editing"
        autoCorrect={false}
        value={q}
        onChangeText={setQ}
        style={styles.input}
      />
      {q.trim() ? (
        hits.length ? (
          <Section title="찾은 설정">
            {hits.map((i) => (
              <Row key={i.id} title={i.title} meta={mobileSectionTitle(i.section)} onPress={() => navigation.push('SettingsSection', { section: i.section, item: i.id })} chevron />
            ))}
          </Section>
        ) : (
          <Text style={styles.meta}>맞는 설정이 없어요</Text>
        )
      ) : (
        <>
          <Section title="운영 순회">
            <OpsChip />
          </Section>
          <Section>
            {MOBILE_SECTIONS.map((sec) => (
              <Row
                key={sec.id}
                title={sec.title}
                leading={<SymbolView name={SECTION_ICON[sec.id]} size={20} tintColor={c.ink} />}
                onPress={() => navigation.push('SettingsSection', { section: sec.id })}
                chevron
              />
            ))}
          </Section>
        </>
      )}
    </Screen>
  )
}
