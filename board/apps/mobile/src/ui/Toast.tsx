import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { motion } from '@direction-board/design-tokens'
import { useScope } from '../api/query'
import { colors, space } from './theme'

// 토스트는 되돌릴 수 있는 결과나 화면 밖에서 끝난 일만(design-core.md). 필 위(키보드가 있으면 키보드 위)에 떠요.
type Toast = { id: number; message: string; action?: { label: string; onPress: () => void } }
type Show = (message: string, action?: Toast['action']) => void
const ToastContext = createContext<Show | null>(null)
export function useToast(): Show {
  const show = useContext(ToastContext)
  if (!show) throw new Error('ToastProvider 밖에서 useToast 를 불렀어요')
  return show
}

const PILL = 64
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  const [toast, setToast] = useState<Toast | null>(null)
  const [keyboard, setKeyboard] = useState(0)
  const opacity = useRef(new Animated.Value(0)).current
  const seq = useRef(0)
  // 서버나 로그인이 바뀌면 앞 범위의 알림과 되돌리기는 지워요
  const { generation } = useScope()
  useEffect(() => setToast(null), [generation])
  useEffect(() => {
    const subs = [
      Keyboard.addListener('keyboardWillShow', (e) => setKeyboard(e.endCoordinates.height)),
      Keyboard.addListener('keyboardWillHide', () => setKeyboard(0)),
    ]
    return () => subs.forEach((sub) => sub.remove())
  }, [])
  const show = useCallback<Show>((message, action) => {
    const id = ++seq.current
    setToast({ id, message, action })
    AccessibilityInfo.announceForAccessibility(message)
  }, [])
  useEffect(() => {
    if (!toast) return
    Animated.timing(opacity, { toValue: 1, duration: motion.fast, useNativeDriver: true }).start()
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: motion.base, useNativeDriver: true }).start(() => setToast((t) => (t?.id === toast.id ? null : t)))
    }, toast.action ? 5000 : 3000)
    return () => clearTimeout(timer)
  }, [toast, opacity])
  const bottom = keyboard ? keyboard + space.md : Math.max(insets.bottom - 8, 12) + PILL + space.md
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="box-none" style={[s.wrap, { bottom, opacity }]}>
          <View style={s.toast} accessibilityLiveRegion="polite">
            <Text style={s.text} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  toast.action?.onPress()
                  setToast(null)
                }}
              >
                <Text style={s.action}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  )
}
const s = StyleSheet.create({
  wrap: { position: 'absolute', left: space.gutter, right: space.gutter, alignItems: 'center' },
  toast: { maxWidth: 520, width: '100%', flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: space.lg, minHeight: space.target + 4 },
  text: { flex: 1, color: colors.onPrimary, fontSize: 15, paddingVertical: space.md },
  action: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
})
