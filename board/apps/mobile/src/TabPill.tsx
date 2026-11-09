import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Keyboard, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { CommonActions, useTheme } from '@react-navigation/native'
import { BlurView } from 'expo-blur'
import { SymbolView } from 'expo-symbols'
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect'
import { color, glass, motion, text } from '@direction-board/design-tokens'

const HEIGHT = 64
const RADIUS = HEIGHT / 2

export function TabPill({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const palette = glass[scheme]
  const { colors } = useTheme()
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext)
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible())
  // 설정을 읽기 전에도 움직이지 않아 동작 줄이기 사용자의 첫 전환을 지켜요.
  const [reduceMotion, setReduceMotion] = useState(true)
  const [width, setWidth] = useState(0)
  const selection = useRef(new Animated.Value(state.index)).current
  const visibility = useRef(new Animated.Value(keyboardVisible ? 0 : 1)).current
  const bottom = Math.max(insets.bottom - 8, 12)
  // 필은 탭 루트에서만 보여요(ADR-0010): 지금 탭의 쌓기가 루트보다 깊으면 숨겨요. 중첩 state 가 아직 없으면 루트로 봐요
  const focused = state.routes[state.index]
  const stacked = typeof focused.state?.index === 'number' && focused.state.index > 0
  const hidden = stacked || StyleSheet.flatten(descriptors[focused.key].options.tabBarStyle)?.display === 'none'
  const itemWidth = width / state.routes.length

  useLayoutEffect(() => {
    onHeightChange?.(hidden ? insets.bottom : bottom + HEIGHT)
  }, [onHeightChange, hidden, insets.bottom, bottom])

  useEffect(() => {
    let active = true
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      active = false
      setReduceMotion(enabled)
    })
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled)
    }, (error: unknown) => {
      console.warn('동작 줄이기 설정을 읽지 못했어요', error)
    })
    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    // will 로 미리 숨기고, did 로 한 번 더 맞춰요: Keyboard.isVisible() 은 did 이벤트에서만 바뀌어서
    // willShow 와 didShow 사이에 필이 마운트되면 시작값이 틀릴 수 있어요
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true)),
      Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true)),
      Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false)),
      Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false)),
    ]
    setKeyboardVisible(Keyboard.isVisible())
    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      selection.stopAnimation()
      selection.setValue(state.index)
      return
    }
    const animation = Animated.spring(selection, { toValue: state.index, useNativeDriver: true })
    animation.start()
    return () => animation.stop()
  }, [reduceMotion, selection, state.index])

  useEffect(() => {
    const animation = Animated.timing(visibility, {
      toValue: keyboardVisible ? 0 : 1,
      duration: reduceMotion ? 0 : motion.base,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [keyboardVisible, reduceMotion, visibility])

  if (hidden) return null

  const content = (
    // tabbar 특성은 탭 항목을 바로 담은 줄에 줘요: 유리·그림자 층이 접근성 트리에서 이름 없는 항목으로 끼지 않게
    <View accessibilityRole="tabbar" style={styles.items} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.selected, {
            width: itemWidth,
            backgroundColor: palette.selected,
            transform: [{ translateX: Animated.multiply(selection, itemWidth) }],
          }]}
        />
      )}
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]
        const focused = state.index === index
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name)
        const tint = focused ? (options.tabBarActiveTintColor ?? colors.primary) : (options.tabBarInactiveTintColor ?? color[scheme]['muted-foreground'])
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityLabel={`${label}, 탭 ${state.routes.length}개 중 ${index + 1}번째`}
            accessibilityState={{ selected: focused }}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress', target: route.key, canPreventDefault: true,
                data: { behavior: {
                  scrollToTop: focused && options.tabBarRepeatedPressBehavior?.scrollToTop !== false,
                  popToTop: focused && options.tabBarRepeatedPressBehavior?.popToTop !== false,
                } },
              })
              if (!focused && !event.defaultPrevented) {
                navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key })
              }
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            style={styles.item}
          >
            {options.tabBarIcon?.({ focused, color: tint, size: 24 })}
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.label, { color: tint, fontWeight: focused ? '700' : '400' }]}>{label}</Text>
          </Pressable>
        )
      })}
    </View>
  )

  return (
    <Animated.View
      pointerEvents={keyboardVisible ? 'none' : 'box-none'}
      accessibilityElementsHidden={keyboardVisible}
      importantForAccessibility={keyboardVisible ? 'no-hide-descendants' : 'auto'}
      style={[styles.position, {
        left: 16 + insets.left, right: 16 + insets.right, bottom,
        opacity: visibility, transform: [{ translateY: visibility.interpolate({ inputRange: [0, 1], outputRange: [HEIGHT + bottom, 0] }) }],
      }]}
    >
      {/* 레인 1: 필 옆 + 원 단추(빠른 추가 상세 시트). 탭 루트에서만 보여요(쌓인 화면은 머리 ⋯ 의 빠른 추가) */}
      <View style={styles.row}>
      <View style={[styles.shadow, { shadowColor: palette.shadow, shadowOpacity: palette.shadowOpacity }]}>
        {Platform.OS === 'ios' && isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" colorScheme={scheme} style={styles.surface}>{content}</GlassView>
        ) : (
          <View style={[styles.surface, styles.border, { borderColor: color[scheme].border }]}>
            <BlurView pointerEvents="none" intensity={80} tint={scheme === 'dark' ? 'dark' : 'default'} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.fallback }]} />
            {content}
          </View>
        )}
      </View>
      <View style={[styles.shadow, styles.plusShadow, { shadowColor: palette.shadow, shadowOpacity: palette.shadowOpacity }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="빠른 추가" accessibilityHint="할 일·목표를 자세히 추가하는 시트를 열어요" onPress={() => navigation.navigate('QuickAdd' as never)} style={styles.plusPress}>
          {Platform.OS === 'ios' && isGlassEffectAPIAvailable() ? (
          <GlassView glassEffectStyle="regular" colorScheme={scheme} style={styles.plus}><SymbolView name="plus" size={24} tintColor={colors.text} /></GlassView>
        ) : (
          <View style={[styles.plus, styles.border, { borderColor: color[scheme].border }]}>
            <BlurView pointerEvents="none" intensity={80} tint={scheme === 'dark' ? 'dark' : 'default'} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.fallback }]} />
            <SymbolView name="plus" size={24} tintColor={colors.text} />
          </View>
        )}
        </Pressable>
      </View>
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  position: { position: 'absolute', alignItems: 'center' },
  row: { width: '100%', maxWidth: 520 + HEIGHT + 8, flexDirection: 'row', gap: 8 },
  shadow: { flex: 1, height: HEIGHT, borderRadius: RADIUS, shadowRadius: 28, shadowOffset: { width: 0, height: 14 } },
  plusShadow: { flex: 0, width: HEIGHT },
  plusPress: { flex: 1 },
  plus: { flex: 1, borderRadius: RADIUS, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  // 안쪽 4pt 여백: 첫·끝 탭의 선택 캡슐(반지름 28)이 필의 둥근 끝(반지름 32) 안에 들어가요
  surface: { flex: 1, borderRadius: RADIUS, overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 4 },
  border: { borderWidth: StyleSheet.hairlineWidth },
  items: { height: 56, flexDirection: 'row', alignItems: 'center' },
  selected: { position: 'absolute', height: 56, borderRadius: 28 },
  item: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: text['2xs'][0], lineHeight: text['2xs'][1] },
})
