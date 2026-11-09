import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { SettingsInfo } from '@direction-board/contracts'
import { tokenClaims } from '../../../api/session'
import { useAuth } from '../../../auth'
import { useServer } from '../../../server'
import { Button } from '../../../ui/Button'
import { Section } from '../../../ui/Section'
import { space, styles } from '../../../ui/theme'
import { SettingRow } from '../parts'

/** 계정: 로그인 계정·접속 경로(서버가 본 것), 이 기기의 Access 로그인·로그아웃 */
export function AccountSection({ info }: { info: SettingsInfo }) {
  const auth = useAuth()
  const { origin } = useServer()
  const claims = auth.session ? tokenClaims(auth.session.token) : null
  const until = claims ? new Date(claims.exp * 1000).toLocaleString('ko-KR') : null
  return (
    <>
      <Section title="서버가 본 계정">
        <SettingRow id="account-email" label="로그인 계정" info={info.me.email} />
        <SettingRow id="access-path" label="접속 경로" info={info.listener === 'local' ? '이 Mac (로컬) · 로그인 없이 맥 주인' : '공개 주소 (Cloudflare Access)'} />
      </Section>
      <Section title="이 기기">
        <SettingRow id="access-login" label="Cloudflare Access 로그인" stack>
          <Text style={styles.text}>
            {auth.session
              ? `${claims?.email ?? '알 수 없는 계정'}으로 로그인했어요 · ${until ?? '알 수 없음'}까지${auth.session.origin !== origin ? `\n지금 주소가 아닌 ${auth.session.origin}의 로그인이에요` : ''}`
              : '로그인하면 이 기기에 Access 로그인을 저장하고 요청마다 함께 보내요.'}
          </Text>
          <View style={s.buttons}>
            <Button variant="outline" title={auth.busy ? '로그인 중' : auth.session ? '다시 로그인' : '로그인'} disabled={auth.busy} onPress={() => void auth.login()} />
          </View>
          {auth.message ? <Text style={styles.meta}>{auth.message}</Text> : null}
        </SettingRow>
        <SettingRow id="logout" label="로그아웃" info={auth.session ? '이 기기의 앱 로그인만 지워요' : info.listener === 'local' ? '로컬 접속은 로그아웃이 없어요' : '로그인하지 않았어요'}>
          {auth.session ? <Button variant="plain" title="로그아웃" disabled={auth.busy} onPress={() => void auth.logout()} /> : null}
        </SettingRow>
      </Section>
    </>
  )
}
const s = StyleSheet.create({ buttons: { gap: space.sm } })
