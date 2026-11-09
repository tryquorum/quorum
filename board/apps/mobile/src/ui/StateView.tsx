import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { ApiError, errorMessage } from '../api/client'
import { connectionHelp } from '../api/connectionHelp'
import type { Query } from '../api/query'
import { useAuth } from '../auth'
import { useServer } from '../server'
import { Button } from './Button'
import { colors, space, styles } from './theme'

/** 요청이 Access 로그인을 요구할 때만 로그인 단추와 결과를 보여요 */
export function LoginPrompt({ error }: { error: unknown }) {
  const auth = useAuth()
  if (!(error instanceof ApiError && error.loginRequired)) return null
  return (
    <>
      <Button title={auth.busy ? '로그인 중' : '로그인'} disabled={auth.busy} onPress={() => void auth.login()} />
      {auth.message ? <Text style={styles.meta}>{auth.message}</Text> : null}
    </>
  )
}

export function Loading({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <View style={s.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator />
      <Text style={styles.meta}>{label}</Text>
    </View>
  )
}

/** 보여 줄 내용이 없는 실패: 이유 한 줄 + 지금 주소 + 다시 시도, 주소가 틀렸을 수 있으면 설정으로(GAP-27) */
export function ErrorCard({ error, retry }: { error: unknown; retry: () => void }) {
  const { origin } = useServer()
  const navigation = useNavigation<{ navigate: (name: 'Settings') => void }>()
  const help = connectionHelp(error, origin)
  return (
    <View style={[styles.group, s.card]} accessibilityRole="alert">
      <Text style={styles.text}>{help.reason}</Text>
      <Text style={styles.meta}>연결 주소: {help.address}</Text>
      <LoginPrompt error={error} />
      <Button title="다시 시도" variant={help.loginFirst ? 'outline' : 'primary'} onPress={retry} />
      {help.offerSettings ? <Button title="설정에서 주소 바꾸기" variant="outline" onPress={() => navigation.navigate('Settings')} /> : null}
    </View>
  )
}

/** 이전 내용을 보여 줄 수 있는 실패: 일을 막지 않는 한 줄(웹 data-state 와 같음) */
export function StaleNotice({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityHint="다시 불러와요" onPress={retry} style={s.stale}>
      <Text style={styles.meta}>
        마지막으로 불러온 내용이에요 · {errorMessage(error)} · <Text style={s.retry}>다시</Text>
      </Text>
    </Pressable>
  )
}

/** 빈 상태: 왜 비었는지 한 줄 + 다음 동작 하나 */
export function Empty({ title, body, action }: { title: string; body?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={s.empty}>
      <Text style={styles.strong}>{title}</Text>
      {body ? <Text style={[styles.meta, s.centerText]}>{body}</Text> : null}
      {action ? <Button title={action.label} variant="outline" onPress={action.onPress} /> : null}
    </View>
  )
}

/** 쿼리 하나의 로딩·오류·이전 내용 처리를 한곳에서. 데이터가 있으면 children 을 그려요 */
export function Loaded<T>({ query, children }: { query: Query<T>; children: (data: T) => React.ReactNode }) {
  if (query.data === undefined) {
    if (query.status === 'error') return <ErrorCard error={query.error} retry={() => void query.refresh()} />
    return <Loading />
  }
  return (
    <>
      {query.status === 'error' ? <StaleNotice error={query.error} retry={() => void query.refresh()} /> : null}
      {children(query.data)}
    </>
  )
}

const s = StyleSheet.create({
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  card: { padding: space.lg, gap: space.md },
  stale: { paddingHorizontal: space.xs },
  retry: { color: colors.ink, fontWeight: '600', textDecorationLine: 'underline' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl, paddingHorizontal: space.lg },
  centerText: { textAlign: 'center' },
})
