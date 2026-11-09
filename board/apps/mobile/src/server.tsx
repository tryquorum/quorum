import React, { createContext, useContext } from 'react'

// 지금 서버 주소와 바꾸기. 화면은 props 대신 이 문맥에서 읽어요(레인 0).
type Server = { origin: string; save: (value: string) => Promise<void>; notice: string }
const ServerContext = createContext<Server | null>(null)
export function ServerProvider({ value, children }: { value: Server; children: React.ReactNode }) {
  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
}
export function useServer(): Server {
  const value = useContext(ServerContext)
  if (!value) throw new Error('ServerProvider 밖에서 useServer 를 불렀어요')
  return value
}
