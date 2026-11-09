import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { DEFAULT_ORIGIN } from './api/client'
import { QueryProvider } from './api/query'
import { AuthProvider } from './auth'
import { RootNavigator } from './navigation/RootNavigator'
import { ServerProvider } from './server'
import { readOrigin, writeOrigin } from './storage'
import { styles } from './ui/theme'
import { ToastProvider } from './ui/Toast'

export default function App() {
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    readOrigin()
      .then(
        (value) => {
          if (value) setOrigin(value)
        },
        () => setNotice('저장된 서버 주소를 읽지 못해 기본 주소를 써요'),
      )
      .finally(() => setReady(true))
  }, [])
  const save = async (value: string) => {
    await writeOrigin(value)
    setOrigin(value)
    setNotice('')
  }
  if (!ready)
    return (
      <View style={[styles.page, { justifyContent: 'center' }]}>
        <ActivityIndicator />
      </View>
    )
  return (
    <SafeAreaProvider>
      <ServerProvider value={{ origin, save, notice }}>
        <AuthProvider origin={origin}>
          <QueryProvider>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </QueryProvider>
        </AuthProvider>
      </ServerProvider>
    </SafeAreaProvider>
  )
}
