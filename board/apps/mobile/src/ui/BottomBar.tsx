import React, { useEffect, useRef } from 'react'
import { Animated, Keyboard, StyleSheet, View } from 'react-native'
import { colors, space } from './theme'
import { useBottomInset } from './insets'

/**
 * 화면 아래에 붙는 입력·동작 줄(AI 입력, 일 상세의 끝냄 등). 평소에는 필(또는 안전 영역) 위에, 키보드가 올라오면
 * 키보드 바로 위에 붙어요. 높이를 onHeight 로 알려 주면 Screen 이 그만큼 본문 끝을 비워요.
 */
export function BottomBar({ children, onHeight }: { children: React.ReactNode; onHeight?: (height: number) => void }) {
  const resting = useBottomInset()
  const bottom = useRef(new Animated.Value(resting)).current
  const keyboard = useRef(0)
  useEffect(() => {
    if (!keyboard.current) bottom.setValue(resting)
  }, [bottom, resting])
  useEffect(() => {
    const move = (to: number, duration: number) => Animated.timing(bottom, { toValue: to, duration, useNativeDriver: false }).start()
    const subs = [
      Keyboard.addListener('keyboardWillShow', (e) => {
        keyboard.current = e.endCoordinates.height
        move(e.endCoordinates.height, e.duration || 250)
      }),
      Keyboard.addListener('keyboardWillHide', (e) => {
        keyboard.current = 0
        move(restingRef.current, e.duration || 250)
      }),
    ]
    return () => subs.forEach((sub) => sub.remove())
  }, [bottom])
  const restingRef = useRef(resting)
  restingRef.current = resting
  return (
    <Animated.View style={[s.bar, { bottom }]} onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}>
      <View style={s.inner}>{children}</View>
    </Animated.View>
  )
}
const s = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, backgroundColor: colors.page },
  inner: { paddingHorizontal: space.gutter, paddingVertical: space.sm },
})
