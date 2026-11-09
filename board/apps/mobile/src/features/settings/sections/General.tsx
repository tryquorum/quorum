import React, { useEffect, useState } from 'react'
import { Text, TextInput, useColorScheme } from 'react-native'
import { api, errorMessage, normalizeOrigin } from '../../../api/client'
import { useServer } from '../../../server'
import { showActions } from '../../../ui/actions'
import { Button } from '../../../ui/Button'
import { Section } from '../../../ui/Section'
import { Sheet } from '../../../ui/Sheet'
import { schemeColors, styles } from '../../../ui/theme'
import { Segmented, SettingRow } from '../parts'
import { setPrefs, usePrefs } from '../prefs'
import { START_TABS, type ThemePref } from '../prefsModel'

const host = (origin: string) => {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/** 일반: 테마(밝게·어둡게·시스템), 시작 화면(다음 실행부터), 서버 주소 */
export function GeneralSection() {
  const prefs = usePrefs()
  const { origin, notice } = useServer()
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState(notice)
  const startLabel = START_TABS.find((t) => t.value === prefs.start)?.label ?? '홈'
  return (
    <>
      <Section title="화면">
        <SettingRow id="theme" label="테마" info="시스템은 기기 설정을 따라가요" stack>
          <Segmented<ThemePref>
            label="테마"
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            options={[{ value: 'light', label: '밝게' }, { value: 'dark', label: '어둡게' }, { value: 'system', label: '시스템' }]}
          />
        </SettingRow>
        <SettingRow id="start-view" label="시작 화면" info="앱을 새로 열 때 보일 탭이에요">
          <Button
            variant="plain"
            title={startLabel}
            onPress={() => showActions(START_TABS.map((t) => ({ label: t.label, onPress: () => setPrefs({ start: t.value }) })), '시작 화면')}
          />
        </SettingRow>
      </Section>
      <Section title="서버">
        <SettingRow id="server-origin" label="서버 주소" info={host(origin)}>
          <Button variant="plain" title="바꾸기" onPress={() => setEditing(true)} />
        </SettingRow>
      </Section>
      {message ? <Text accessibilityRole="alert" style={styles.meta}>{message}</Text> : null}
      <OriginSheet visible={editing} onClose={() => setEditing(false)} onSaved={setMessage} />
    </>
  )
}

/** 서버 주소 바꾸기 시트: 저장과 연결 확인(레인 0 설정 화면에서 옮김) */
function OriginSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const { origin, save } = useServer()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const [draft, setDraft] = useState(origin)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (visible) {
      setDraft(origin)
      setStatus('')
    }
  }, [visible, origin])
  const persist = async () => {
    try {
      await save(normalizeOrigin(draft))
      onSaved('서버 주소를 저장했어요')
      onClose()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '저장하지 못했어요')
    }
  }
  const check = async () => {
    setBusy(true)
    try {
      await api.state(normalizeOrigin(draft))
      setStatus('서버에 연결했어요')
    } catch (e) {
      setStatus(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet visible={visible} title="서버 주소" onClose={onClose} action={{ label: '저장', onPress: () => void persist(), disabled: !draft.trim() }}>
      <TextInput
        accessibilityLabel="서버 주소"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="done"
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => void persist()}
        placeholderTextColor={c.muted}
        style={styles.input}
      />
      <Text style={styles.meta}>https 주소면 Cloudflare Access 로 로그인할 수 있어요. 기본은 https://direction.lidgeai.com 이에요.</Text>
      <Button variant="outline" title={busy ? '확인 중' : '연결 확인'} disabled={busy} onPress={() => void check()} />
      {status ? <Text accessibilityRole="alert" style={styles.text}>{status}</Text> : null}
    </Sheet>
  )
}
