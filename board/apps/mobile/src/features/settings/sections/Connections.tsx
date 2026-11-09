import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native'
import type { McpCheck, McpToken, McpTokenCreated, SettingsInfo } from '@direction-board/contracts'
import { AGENTS, CF_ID_ENV, CF_SECRET_ENV, snippetsFor, TOKEN_ENV, type AgentId, type Target } from '@direction-board/contracts/mcp-snippets'
import { ago } from '@direction-board/contracts/run-labels'
import { errorMessage } from '../../../api/client'
import { connectionsApi } from '../../../api/connections'
import { useScope } from '../../../api/query'
import { useIsFocused } from '@react-navigation/native'
import { useServer } from '../../../server'
import { Button } from '../../../ui/Button'
import { Section } from '../../../ui/Section'
import { colors, schemeColors, space, styles } from '../../../ui/theme'
import { CodeBlock, CopyButton, Segmented, SettingRow } from '../parts'
import { useWriteScope } from '../../../api/scope'

const MARK: Record<AgentId, string> = { claude: 'Cc', codex: 'Cx', cursor: 'Cu', goat: 'Gt', aside: 'As', other: '··' }

/** 설정 › 연결(웹 ConnectionsSection): 에이전트 카드, 이 Mac/원격, 붙여 넣을 조각 복사, 연결 토큰, 연결 확인 */
export function ConnectionsSection({ info }: { info: SettingsInfo }) {
  const [target, setTarget] = useState<Target>('local')
  const [agent, setAgent] = useState<AgentId>('claude')
  const url = target === 'local' ? info.mcp.localUrl : info.mcp.publicUrl
  const snippets = snippetsFor(agent, target, url, info.mcp.localOpen)
  const needsToken = target === 'remote' || !info.mcp.localOpen
  return (
    <>
      <Section title="에이전트 연결(MCP)">
        <SettingRow id="mcp-agents" label="에이전트" info="고르면 그 에이전트에 붙여 넣을 조각이 나와요. 붙이면 에이전트가 방향판의 일·문서를 찾고 읽고 고칠 수 있어요" stack>
          <View accessibilityRole="radiogroup" accessibilityLabel="에이전트" style={s.grid}>
            {AGENTS.map((a) => {
              const on = agent === a.id
              return (
                <Pressable key={a.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${a.name}, ${a.hint}`} onPress={() => setAgent(a.id)} style={[s.card, on && s.cardOn]}>
                  <View style={[s.mark, on && s.markOn]}>
                    <Text style={[s.markText, on && s.markTextOn]}>{MARK[a.id]}</Text>
                  </View>
                  <View style={s.flex}>
                    <Text style={[styles.text, on && s.bold]} numberOfLines={1}>{a.name}</Text>
                    <Text style={[styles.small, on && s.hintOn]} numberOfLines={1}>{a.hint}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        </SettingRow>
        <SettingRow
          id="mcp-url"
          label="어디서 붙나요"
          info={target === 'local' ? (info.mcp.localOpen ? '같은 Mac 의 에이전트용. 루프백에서 인증 없이 열려 있어요' : '같은 Mac 의 에이전트용. 연결 토큰이 필요해요') : '다른 기기의 에이전트용 공개 주소. Cloudflare Access 서비스 토큰 두 헤더도 필요해요'}
          stack
        >
          <Segmented label="연결 위치" value={target} onChange={setTarget} options={[{ value: 'local', label: '이 Mac' }, { value: 'remote', label: '원격' }]} />
          <View style={s.url}>
            <Text selectable style={[styles.small, s.mono, s.flex]} numberOfLines={1}>{url}</Text>
            <CopyButton text={url} label="MCP 주소 복사" />
          </View>
          {info.mcp.readonly ? <Text style={styles.meta}>이 서버는 읽기 전용 MCP 예요(쓰기 도구 숨김).</Text> : null}
          {snippets.map((sn) => <CodeBlock key={sn.label} label={sn.label} code={sn.code} />)}
          {needsToken ? (
            <Text style={styles.meta}>
              조각에는 토큰 원문 대신 환경변수 이름만 있어요(연결 토큰은 아래에서 만들어요): {TOKEN_ENV}{target === 'remote' ? `, ${CF_ID_ENV}, ${CF_SECRET_ENV}` : ''}.
            </Text>
          ) : null}
        </SettingRow>
      </Section>
      <Section title="토큰과 확인">
        <TokensRow info={info} />
        <CheckRow info={info} />
      </Section>
    </>
  )
}

/** 연결 토큰: 에이전트마다 하나. 원문은 만들 때 한 번만 화면에 있고(상태에만), 떠나거나 폐기하면 지워요 */
function TokensRow({ info }: { info: SettingsInfo }) {
  const { origin } = useServer()
  const scope = useWriteScope()
  const { generation, isCurrent } = useScope()
  const c = schemeColors(useColorScheme() === 'dark' ? 'dark' : 'light')
  const allowed = info.macOwner && !info.me.agent
  const [tokens, setTokens] = useState<McpToken[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<McpTokenCreated | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const load = useCallback(async () => {
    const g = generation
    try {
      const r = await connectionsApi.tokens(origin)
      if (!isCurrent(g)) return
      setTokens(r.tokens)
      setLoadError(null)
    } catch (e) {
      if (isCurrent(g)) setLoadError(e)
    }
  }, [origin, generation, isCurrent])
  // 서버·계정이 바뀌면 원문과 목록을 비워요
  useEffect(() => {
    setCreated(null)
    setTokens(null)
    if (allowed) void load()
  }, [allowed, load])
  // 원문은 이 화면이 보이는 동안만: 다른 화면으로 가면 지워요. 늦게 온 만들기 응답도 범위·화면을 확인하고 받아요
  const focused = useIsFocused()
  const live = useRef(true)
  live.current = focused
  useEffect(() => {
    if (!focused) setCreated(null)
  }, [focused])
  const create = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    const g = generation
    try {
      const made = await connectionsApi.create(scope, name.trim())
      if (!isCurrent(g)) return
      Keyboard.dismiss()
      if (live.current) setCreated(made)
      setName('')
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const revoke = (t: McpToken) =>
    Alert.alert(`"${t.name}" 토큰을 폐기할까요?`, '그 토큰을 쓰는 에이전트는 바로 끊겨요. 되돌릴 수 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '폐기',
        style: 'destructive',
        onPress: () =>
          void connectionsApi.revoke(scope, t.id).then(
            () => {
              if (created?.token.id === t.id) setCreated(null)
              void load()
            },
            (e: unknown) => setError(errorMessage(e)),
          ),
      },
    ])
  const active = tokens?.filter((t) => t.revokedAt === null) ?? []
  const revoked = tokens?.filter((t) => t.revokedAt !== null) ?? []
  return (
    <SettingRow id="mcp-tokens" label="연결 토큰" info="에이전트마다 하나씩 만들고, 그 에이전트를 끊을 때 폐기해요. 원문은 만들 때 한 번만 보여요" stack>
      {!allowed ? (
        <Text style={styles.meta}>맥 주인만 토큰을 만들고 폐기할 수 있어요</Text>
      ) : (
        <>
          <View style={s.form}>
            <TextInput
              accessibilityLabel="토큰 이름"
              placeholder="이름 (예: 노트북 Codex)"
              placeholderTextColor={c.muted}
              maxLength={40}
              value={name}
              onChangeText={setName}
              returnKeyType="done"
              onSubmitEditing={() => void create()}
              style={[styles.input, s.flex]}
            />
            <Button title={busy ? '만드는 중' : '만들기'} disabled={!name.trim() || busy} onPress={() => void create()} />
          </View>
          {error ? <Text accessibilityRole="alert" style={[styles.meta, s.error]}>{error}</Text> : null}
          {created ? (
            <View accessibilityRole="alert" style={s.secret}>
              <Text style={styles.strong}>"{created.token.name}" 토큰은 지금만 보여요. 복사해 두세요</Text>
              <CodeBlock label="셸에 넣기" code={`export ${TOKEN_ENV}=${created.secret}`} />
              <Button variant="outline" title="다 복사했어요" onPress={() => setCreated(null)} />
            </View>
          ) : null}
          {loadError ? (
            <View style={s.form}>
              <Text style={[styles.meta, s.flex]}>목록을 불러오지 못했어요 · {errorMessage(loadError)}</Text>
              <Button variant="plain" title="다시" onPress={() => void load()} />
            </View>
          ) : tokens === null ? (
            <Text style={styles.meta}>불러오는 중이에요</Text>
          ) : !active.length ? (
            <Text style={styles.meta}>아직 만든 토큰이 없어요</Text>
          ) : (
            active.map((t) => (
              <View key={t.id} style={s.token}>
                <View style={s.flex}>
                  <Text style={styles.strong} numberOfLines={1}>{t.name}</Text>
                  <Text style={styles.small}>{t.prefix}… · 만듦 {ago(t.createdAt)} · {t.lastUsedAt ? `마지막 사용 ${ago(t.lastUsedAt)}` : '아직 안 씀'}</Text>
                </View>
                <Button variant="plain" title="폐기" onPress={() => revoke(t)} />
              </View>
            ))
          )}
          {revoked.length ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: showRevoked }} onPress={() => setShowRevoked((v) => !v)} hitSlop={6}>
              <Text style={styles.meta}>폐기한 토큰 {revoked.length}개 {showRevoked ? '접기' : '보기'}</Text>
              {showRevoked ? revoked.map((t) => <Text key={t.id} style={styles.small}>{t.name} · {t.prefix}… · 폐기 {ago(t.revokedAt ?? t.createdAt)}</Text>) : null}
            </Pressable>
          ) : null}
        </>
      )}
    </SettingRow>
  )
}

/** 연결 확인: 서버가 이 Mac 의 /mcp 에 initialize → tools/list 를 보내 봐요(원격 경로는 확인하지 않아요) */
function CheckRow({ info }: { info: SettingsInfo }) {
  const scope = useWriteScope()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<McpCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await connectionsApi.check(scope))
    } catch (e) {
      setResult(null)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const status = busy ? '확인 중' : result ? (result.ok ? `도구 ${result.tools}개 · ${result.ms}ms · ${ago(result.checkedAt)}` : `${result.step} 실패: ${result.error}`) : error
  return (
    <SettingRow id="mcp-check" label="연결 확인" info={status ?? '이 Mac 의 /mcp 에 실제로 물어봐요'}>
      <Button variant="plain" title="확인" disabled={busy || !info.macOwner || info.me.agent} onPress={() => void run()} />
    </SettingRow>
  )
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.fill, borderRadius: 12, padding: space.md, minHeight: space.target + 12 },
  cardOn: { backgroundColor: colors.primary },
  mark: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  markOn: { backgroundColor: colors.onPrimary },
  markText: { fontFamily: 'Menlo', fontSize: 12, fontWeight: '700', color: colors.ink },
  markTextOn: { color: colors.primary },
  bold: { fontWeight: '700', color: colors.onPrimary },
  hintOn: { color: colors.onPrimary, opacity: 0.8 },
  flex: { flex: 1 },
  url: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.fill, borderRadius: 10, paddingLeft: space.md, paddingRight: space.xs, minHeight: 40 },
  mono: { fontFamily: 'Menlo' },
  form: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { color: colors.decide },
  secret: { backgroundColor: colors.fill, borderRadius: 12, padding: space.md, gap: space.sm },
  token: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: space.target },
})
