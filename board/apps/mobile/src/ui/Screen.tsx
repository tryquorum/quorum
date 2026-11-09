import React, { useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useAuth } from '../auth'
import { BottomBar } from './BottomBar'
import { useBottomInset } from './insets'
import { styles } from './theme'

/**
 * 탭 루트와 상세의 공용 스크롤 화면. 큰 제목은 네이티브 머리가 그려요(첫 자식이 ScrollView 여야 접혀요).
 * 아래 여백 = 필 높이(숨으면 안전 영역) + 24pt, 아래 줄이 있으면 그 높이 + 필 높이 + 12pt. 키보드는 스크롤 여백으로 받아요.
 */
export function Screen({
  children,
  onRefresh,
  bottomBar,
  keyboard = false,
  scrollRef,
}: {
  children: React.ReactNode
  /** 당겨서 새로고침. 서버 데이터를 보이는 화면은 모두 줘요 */
  onRefresh?: () => Promise<unknown>
  bottomBar?: React.ReactNode
  /**
   * 스크롤 안에 입력칸이 있는 화면만 켜요. 켜면 키보드만큼 스크롤 여백을 받아 입력칸이 보여요.
   * 입력이 아래 줄(bottomBar)이나 시트에 있는 화면에서 켜면 다른 곳의 키보드에도 스크롤이 밀린 채 남아요
   */
  keyboard?: boolean
  /** 화면 안 특정 자리로 스크롤해야 할 때(문서 개요) */
  scrollRef?: React.Ref<React.ComponentRef<typeof ScrollView>>
}) {
  const { warning } = useAuth()
  const bottom = useBottomInset()
  const [bar, setBar] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const pad = bottomBar ? bar + bottom + 12 : bottom + 24
  return (
    <View style={styles.page}>
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: pad }]}
        scrollIndicatorInsets={{ bottom: pad - 12 }}
        automaticallyAdjustKeyboardInsets={keyboard}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                void onRefresh().finally(() => setRefreshing(false))
              }}
            />
          ) : undefined
        }
      >
        {warning ? (
          <Text accessibilityRole="alert" style={styles.meta}>
            {warning}
          </Text>
        ) : null}
        {children}
      </ScrollView>
      {bottomBar ? <BottomBar onHeight={setBar}>{bottomBar}</BottomBar> : null}
    </View>
  )
}
