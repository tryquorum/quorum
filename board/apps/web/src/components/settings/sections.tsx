import { Keyboard, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { EffortPicker, ModelPicker, useCatalog, useChoice } from "@/components/model-picker"
import { useStored } from "@/hooks/use-data"
import { SHORTCUTS, formatKeys, isMac } from "@/lib/shortcuts"
import { useShortcutHelp } from "@/components/shortcut-dispatch"
import type { SettingsInfo } from "@direction-board/contracts/settings"
import { CopyButton, Group, Segmented, SettingRow } from "./parts"
import { SpacesRow } from "./members"
import { useSpaces } from "@/hooks/use-space"
import { logoutKind } from "@/lib/logout"

export const START_KEY = "db:start"
export const START_VIEWS = [
  { value: "home", label: "홈" },
  { value: "list", label: "전체 목록" },
  { value: "road", label: "로드맵" },
  { value: "docs", label: "문서" },
  { value: "board", label: "보드" },
] as const

export function GeneralSection() {
  const { theme, setTheme } = useTheme()
  const [start, setStart] = useStored<string>(START_KEY, "home")
  // 목록에 없는 옛 값(예: 지금은 설정으로 옮긴 "ops")은 실제로 열리는 홈으로 보여요
  const shown = START_VIEWS.some((v) => v.value === start) ? start : "home"
  return (
    <Group>
      <SettingRow id="theme" label="테마" info={<p>D 키로도 밝게·어둡게를 바꿔요. 시스템은 기기 설정을 따라가요.</p>}>
        <Segmented label="테마" value={theme} onChange={setTheme} options={[{ value: "light", label: "밝게" }, { value: "dark", label: "어둡게" }, { value: "system", label: "시스템" }]} />
      </SettingRow>
      <SettingRow id="start-view" label="시작 화면" info={<p>주소 없이 방향판을 열 때 보일 화면이에요. 링크로 연 화면은 그대로예요.</p>}>
        <select aria-label="시작 화면" value={shown} onChange={(e) => setStart(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {START_VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </SettingRow>
      <SpacesRow />
    </Group>
  )
}

export function AccountSection({ info }: { info: SettingsInfo }) {
  const local = info.listener === "local"
  const google = useSpaces().me?.auth === "google"
  const logout = logoutKind(info.listener, google ? "google" : "access")
  return (
    <Group>
      <SettingRow id="account-email" label="로그인 계정">
        <span className="truncate text-sm text-muted-foreground">{info.me.email}</span>
      </SettingRow>
      <SettingRow id="access-path" label="접속 경로" info={<p>{google ? "공개 주소에서 Google 계정으로 로그인했어요. 허용 목록은 관리자가 설정 › 멤버·접근에서 관리해요." : "이 Mac 로컬 주소로 열면 로그인 없이 맥 주인으로 들어와요. 공개 주소는 Cloudflare Access 로그인을 거쳐요."}</p>}>
        <span className="text-sm text-muted-foreground">{local ? "이 Mac (로컬)" : google ? "공개 주소 (Google 로그인)" : "공개 주소 (Cloudflare Access)"}</span>
      </SettingRow>
      <SettingRow id="logout" label="로그아웃">
        {!logout ? <span className="text-sm text-muted-foreground">로컬 접속은 로그아웃이 없어요</span>
          : logout === "google" ? <form method="post" action="/auth/logout"><Button type="submit" variant="outline" size="sm"><LogOut />로그아웃</Button></form>
          : <Button variant="outline" size="sm" asChild><a href="/cdn-cgi/access/logout"><LogOut />로그아웃</a></Button>}
      </SettingRow>
    </Group>
  )
}

export function AiSection() {
  const cat = useCatalog()
  const [choice, setChoice] = useChoice(cat)
  return (
    <Group>
      <SettingRow id="default-model" label="기본 모델" info={<p>AI에게 묻기·일 화면 대화가 처음 고르는 모델이에요. 명령창에서 바꾸면 여기도 같이 바뀌어요. 운영 순회 모델은 설정 › 운영 순회에서 따로 정해요.</p>}>
        {cat ? <ModelPicker cat={cat} choice={choice} onChange={setChoice} side="bottom" align="end" /> : <span className="text-sm text-muted-foreground">모델 목록을 불러오는 중이에요</span>}
      </SettingRow>
      <SettingRow id="default-effort" label="생각 수준">
        {cat && choice && <EffortPicker cat={cat} choice={choice} onChange={setChoice} side="bottom" align="end" />}
        {cat && choice && (cat.providers.find((p) => p.id === choice.provider)?.models.find((m) => m.id === choice.model)?.efforts.length ?? 0) <= 1 && <span className="text-sm text-muted-foreground">이 모델은 고를 수준이 없어요</span>}
      </SettingRow>
    </Group>
  )
}

/** 단축키 레지스트리(lib/shortcuts.ts, 읽기 전용)에서 만들어요. 예약만 된 키는 빼요 */
export function ShortcutsSection() {
  const openHelp = useShortcutHelp()
  const mac = typeof navigator !== "undefined" && isMac(navigator.platform)
  const shown = SHORTCUTS.filter((s) => s.owner !== "reserved")
  const groups = [...new Set(shown.map((s) => s.group))]
  return (
    <div data-setting="shortcut-list" tabIndex={-1} className="space-y-4 rounded-xl outline-none data-[highlight]:ring-2 data-[highlight]:ring-ring">
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={openHelp}><Keyboard />도움말 패널 (?)</Button></div>
      {groups.map((g) => (
        <section key={g} aria-label={g} className="rounded-xl border bg-card">
          <h2 className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{g}</h2>
          <ul className="divide-y">
            {shown.filter((s) => s.group === g).map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">{s.label}{s.note && <span className="block text-2xs text-muted-foreground">{s.note}</span>}</span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1" aria-label={formatKeys(s, mac).map((k) => k.join(s.sequence ? " 다음 " : "+")).join(" 또는 ")}>
                  {formatKeys(s, mac).map((combo, i) => (
                    <kbd key={i} className="num rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">{combo.join(s.sequence ? " " : mac ? "" : "+")}</kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function DataSection({ info }: { info: SettingsInfo }) {
  return (
    <Group>
      <SettingRow id="data-paths" label="DB·거울 위치" stack info={<p>SQLite 가 원본이고, 거울(vault)은 DB 내용을 밖에서 읽도록 만든 마크다운 사본이에요. 위치는 서버 환경변수(DB_PATH·VAULT_DIR)로 정하고 여기서는 읽기만 해요.</p>}>
        {info.paths ? (
          <dl className="grid gap-2 text-sm">
            {([["DB", info.paths.db], ["거울", info.paths.vault]] as const).map(([k, v]) => (
              <div key={k} className="flex min-w-0 items-center gap-2">
                <dt className="w-10 shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-xs" title={v}>{v}</dd>
                <CopyButton text={v} label={`${k} 경로 복사`} />
              </div>
            ))}
          </dl>
        ) : <span className="text-sm text-muted-foreground">맥 주인만 볼 수 있어요</span>}
      </SettingRow>
    </Group>
  )
}

export function AboutSection({ info }: { info: SettingsInfo }) {
  return (
    <Group>
      <SettingRow id="version" label="버전·커밋">
        <span className="num text-sm text-muted-foreground">{info.version}{info.commit ? ` · ${info.commit}` : ""}</span>
      </SettingRow>
    </Group>
  )
}
