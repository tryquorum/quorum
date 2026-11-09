import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { configureAuth } from './api/client'
import { AUTH_CALLBACK, encodeState, isExpired, loginUrl, readCallback, type AccessSession } from './api/session'
import { createSessionStore, type SessionState } from './api/sessionStore'

// Access 토큰은 비밀이라 Keychain 에 두고, 백업으로 다른 기기에 옮겨지지 않게 해요.
const KEY = 'access-session'
const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
const EXPIRED = '로그인이 만료됐어요. 다시 로그인해 주세요'

type Auth = SessionState & {
  busy: boolean
  message: string
  login: () => Promise<void>
  logout: () => Promise<void>
}
const AuthContext = createContext<Auth | null>(null)
export function useAuth(): Auth {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider 밖에서 useAuth 를 불렀어요')
  return value
}
function parseStored(value: string | null): AccessSession | null {
  if (!value) return null
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null) return null
  const { origin, token } = parsed as { origin?: unknown; token?: unknown }
  return typeof origin === 'string' && typeof token === 'string' ? { origin, token } : null
}

export function AuthProvider({ origin, children }: { origin: string; children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, warning: '' })
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const loggingIn = useRef(false)
  const [store] = useState(() =>
    createSessionStore(
      {
        save: (session) => SecureStore.setItemAsync(KEY, JSON.stringify(session), KEYCHAIN),
        remove: () => SecureStore.deleteItemAsync(KEY, KEYCHAIN),
      },
      setState,
    ),
  )
  useEffect(() => {
    configureAuth({
      session: store.current,
      expired: (session) => {
        if (store.expire(session)) setMessage(EXPIRED)
      },
    })
    SecureStore.getItemAsync(KEY, KEYCHAIN)
      .then(parseStored)
      .then(
        (stored) => {
          if (stored && isExpired(stored.token)) {
            setMessage(EXPIRED)
            void store.logout()
          } else store.restore(stored)
        },
        () => setMessage('저장된 로그인을 읽지 못했어요. 다시 로그인해 주세요'),
      )
      .finally(() => setReady(true))
    return () => configureAuth({ session: () => null, expired: () => {} })
  }, [store])
  const login = async () => {
    if (loggingIn.current) return
    if (!origin.startsWith('https://')) {
      setMessage('Cloudflare Access 로그인은 https 서버에서만 할 수 있어요')
      return
    }
    loggingIn.current = true
    setBusy(true)
    try {
      const state = encodeState(Crypto.getRandomBytes(32))
      const result = await WebBrowser.openAuthSessionAsync(loginUrl(origin, state), AUTH_CALLBACK)
      if (result.type !== 'success') {
        setMessage('로그인을 마치지 않았어요')
        return
      }
      const token = readCallback(result.url, state)
      if (isExpired(token)) throw new Error('받은 로그인이 이미 만료됐어요')
      setMessage('로그인했어요')
      // 저장에 실패하면 store 가 경고를 남기고, 이번 실행 동안은 메모리의 로그인을 써요
      await store.login({ origin, token })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '로그인하지 못했어요')
    } finally {
      loggingIn.current = false
      setBusy(false)
    }
  }
  const logout = async () => {
    setMessage('로그아웃했어요. Safari 의 Cloudflare Access 로그인은 남아 있어 다음 로그인은 바로 끝날 수 있어요')
    await store.logout()
  }
  if (!ready) return null
  return <AuthContext.Provider value={{ ...state, busy, message, login, logout }}>{children}</AuthContext.Provider>
}
