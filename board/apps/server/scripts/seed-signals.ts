// 샘플 사건 넣기: 벤토 4칸이 어떻게 보이는지 확인용. 전부 sample:true 라서 화면에서 한 번에 지울 수 있다.
// 실행: bun run seed
const BASE = `http://127.0.0.1:${process.env.PORT || 3070}`;
const H = { authorization: `Bearer ${process.env.AGENT_TOKEN}`, "content-type": "application/json" };
const day = (n: number, h = 23, m = 59) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };

const signals = [
  // 오픈소스 (GitHub)
  { source: "github", agent: "codex", kind: "error", fixed: true, title: "opencodex CI lint 실패 → 고쳐서 다시 초록", area: "오픈소스", task: "ocx:ci-lint", ref: "s:ocx-lint" },
  { source: "github", agent: "claude", kind: "error", ai_fixable: true, title: "GOAT e2e 테스트가 macOS에서 타임아웃", body: "러너 epyc-2에서 3번 연속. 재현 후 대기 시간 조정 시도 중", area: "오픈소스", task: "goat:e2e-macos", ref: "s:goat-e2e" },
  { source: "github", agent: "claude", kind: "progress", title: "opencodex 다음 릴리스 노트 쓰는 중", area: "오픈소스", task: "ocx:release-notes", ref: "s:ocx-notes" },
  { source: "github", agent: "codex", kind: "question", title: "Windows 설치 서명 경고 이슈: 정식 인증서 나올 때까지 어떻게 안내할지", area: "오픈소스", ref: "s:ocx-sign" },
  { source: "github", agent: "codex", kind: "done", review: true, title: "README 스폰서 섹션 고친 PR 열었어요", area: "오픈소스", ref: "s:ocx-readme" },
  { source: "github", agent: "codex", kind: "error", fixed: true, title: "npm 배포 토큰 만료 → 새 토큰으로 다시 배포", area: "오픈소스", ref: "s:npm-token" },
  // 학교
  { source: "lms", agent: "aside", kind: "deadline", title: "이번 주 퀴즈 마감", due: day(1), area: "학교", ref: "s:quiz" },
  { source: "lms", agent: "aside", kind: "deadline", title: "팀 프로젝트 최종 제출", due: day(18), area: "학교", ref: "s:team" },
  { source: "lms", agent: "aside", kind: "auth", title: "LMS 로그인이 풀려서 다시 로그인했어요", area: "학교", ref: "s:lms-auth" },
  // 스폰서 / YC
  { source: "gmail", agent: "aside", kind: "error", risk: ["money"], title: "스폰서 입금 금액이 계약서와 달라요", body: "계약 400 USDT, 입금 380 USDT (수수료 차감 추정)", area: "스폰서", ref: "s:usdt" },
  { source: "gmail", agent: "aside", kind: "approval", title: "YC Office Hour 답장 초안: 보내도 될까요?", area: "YC", ref: "s:yc-oh" },
  { source: "gmail", agent: "aside", kind: "auth", human_step: true, title: "개인 Gmail 로그인에 휴대폰 승인이 필요해요", area: "스폰서", ref: "s:gmail-2fa" },
  // X
  { source: "x", agent: "aside", kind: "done", review: true, title: "X 멘션 12개 정리, 답할 만한 것 2개 초안", area: "X", ref: "s:x-mentions" },
  // NeuralArcade 슬랙
  { source: "slack", agent: "뉴", kind: "question", title: "스크럼 요약 형식 바꿔도 되냐고 물어봄", area: "NeuralArcade", ref: "s:scrum" },
  { source: "slack", agent: "뉴", kind: "done", title: "아침 스크럼 스레드 2곳 올림", area: "NeuralArcade", ref: "s:scrum-post" },
  // 생활 (개인, 이 맥 밖으로 안 나감)
  { source: "kakao", agent: "aside", kind: "deadline", private: true, title: "토요일 저녁 약속", due: day(1, 19, 0), area: "생활", ref: "s:date" },
  { source: "calendar", agent: "aside", kind: "deadline", title: "도쿄 출발 비행기", due: day(8, 8, 45), area: "생활", ref: "s:tokyo" },
].map((s) => ({ ...s, sample: true }));

const r = await fetch(`${BASE}/api/signals`, { method: "POST", headers: H, body: JSON.stringify({ signals }) });
const out = (await r.json()) as any;
if (!r.ok) throw new Error(JSON.stringify(out));
const lanes: Record<string, number> = {};
for (const s of out.signals) lanes[s.lane] = (lanes[s.lane] || 0) + 1;
console.log("signals:", out.signals.length, lanes);

const collectors: [string, boolean, string, number][] = [
  ["github", true, "opencodex, goat-si/goat", 10],
  ["lms", true, "다시 로그인함", 60],
  ["gmail", false, "개인 Gmail: 휴대폰 승인 대기", 15],
  ["x", true, "", 30],
  ["slack", true, "NeuralArcade", 10],
  ["kakao", true, "이 맥에서만", 30],
  ["calendar", true, "미리알림·캘린더", 15],
];
for (const [name, ok, note, every_min] of collectors) {
  await fetch(`${BASE}/api/collectors/${name}`, { method: "POST", headers: H, body: JSON.stringify({ ok, note, every_min, sample: true }) });
}
console.log("collectors:", collectors.length);
