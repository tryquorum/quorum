import React, { useLayoutEffect, useRef, useState } from 'react'
import { RefreshControl, ScrollView, type ScrollViewInstance } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { SettingsInfo } from '@direction-board/contracts'
import { api } from '../../api/client'
import { refreshOps } from '../../api/ops'
import { useQuery } from '../../api/query'
import type { StackParams } from '../../navigation/routes'
import { useServer } from '../../server'
import { useBottomInset } from '../../ui/insets'
import { Loaded } from '../../ui/StateView'
import { styles } from '../../ui/theme'
import { HighlightContext } from './parts'
import { mobileSectionTitle } from './registry'
import { AccountSection } from './sections/Account'
import { AiSection } from './sections/Ai'
import { ConnectionsSection } from './sections/Connections'
import { AboutSection, DataSection } from './sections/Data'
import { GeneralSection } from './sections/General'
import { GesturesSection } from './sections/Gestures'
import { OpsSection } from './sections/Ops'

/** 설정 섹션 하나. item 이 있으면(검색에서 고름) 그 줄로 스크롤하고 2초 강조해요 */
export function SettingsSection({ route, navigation }: NativeStackScreenProps<StackParams, 'SettingsSection'>) {
  const { section, item } = route.params
  const { origin } = useServer()
  const info = useQuery<SettingsInfo>('settings', () => api.settings(origin))
  const scroller = useRef<ScrollViewInstance>(null)
  const bottom = useBottomInset()
  const [refreshing, setRefreshing] = useState(false)
  useLayoutEffect(() => navigation.setOptions({ title: mobileSectionTitle(section) }), [navigation, section])
  const needsInfo = section === 'account' || section === 'connections' || section === 'data' || section === 'about'
  const body = () => {
    if (section === 'general') return <GeneralSection />
    if (section === 'ai') return <AiSection />
    if (section === 'ops') return <OpsSection />
    if (section === 'shortcuts') return <GesturesSection />
    return (
      <Loaded query={info}>
        {(data) =>
          section === 'account' ? <AccountSection info={data} /> : section === 'connections' ? <ConnectionsSection info={data} /> : section === 'data' ? <DataSection info={data} /> : <AboutSection info={data} />
        }
      </Loaded>
    )
  }
  const refresh = () => Promise.all([info.refresh(), section === 'ops' ? refreshOps() : null])
  return (
    <HighlightContext.Provider value={{ item: item ?? null, scroller }}>
      <ScrollView
        ref={scroller}
        style={styles.page}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: bottom + 24 }]}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          needsInfo || section === 'ops' ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                void refresh().finally(() => setRefreshing(false))
              }}
            />
          ) : undefined
        }
      >
        {body()}
      </ScrollView>
    </HighlightContext.Provider>
  )
}
