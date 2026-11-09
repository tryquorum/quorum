import React from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, space, styles } from './theme'

/**
 * 아래에서 올라오는 시트(iOS pageSheet). RN Modal 은 allowSwipeDismissal 과 onRequestClose 가 함께 있어야
 * 끌어내려 닫혀요. 머리: 왼쪽 닫기, 가운데 제목, 오른쪽 주 동작(있으면). 안의 입력은 키보드만큼 스크롤 여백을 받아요.
 */
export function Sheet({
  visible,
  title,
  onClose,
  action,
  children,
}: {
  visible: boolean
  title: string
  onClose: () => void
  action?: { label: string; onPress: () => void; disabled?: boolean }
  children: React.ReactNode
}) {
  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" allowSwipeDismissal onRequestClose={onClose}>
      <View style={styles.page}>
        <View style={s.head}>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onClose} style={s.side}>
            <Text style={s.close}>닫기</Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.strong, s.title]}>
            {title}
          </Text>
          <View style={[s.side, s.right]}>
            {action ? (
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!action.disabled }} disabled={action.disabled} hitSlop={10} onPress={action.onPress}>
                <Text style={[s.action, action.disabled && { opacity: 0.4 }]}>{action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <ScrollView
          contentContainerStyle={[styles.content, s.content]}
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.gutter, paddingTop: space.lg, paddingBottom: space.sm, gap: space.sm },
  side: { minWidth: 64, minHeight: space.target, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center' },
  close: { color: colors.ink, fontSize: 17 },
  action: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  content: { paddingBottom: 48 },
})
