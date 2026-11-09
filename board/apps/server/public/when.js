/* 자연어 날짜 — "내일 3시 계약서", "금요일 저녁", "다음주 월 10:30", "11/24", "3일 뒤", "2시간 후"
   W.parse(text, now?) -> {at:'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM', title, spans:[[s,e]]} | null
   W.short(v, now?)    -> 리스트용 짧은 라벨 ("15:00", "내일 10:00", "토 10:00", "11/24")
   W.long(v, now?)     -> 확인용 라벨 ("내일 (토) 오후 3:00", "11월 24일 (화)")
   W.quick(now?)       -> 빠른 선택 칩 [{k,label,sub,at}] */
(function () {
  const WD = '일월화수목금토';
  const P2 = n => String(n).padStart(2, '0');
  const day0 = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x };
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x };
  const isoD = d => `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`;
  const isoDT = d => `${isoD(d)}T${P2(d.getHours())}:${P2(d.getMinutes())}`;
  const monIdx = d => (d.getDay() + 6) % 7; // 월=0 … 일=6
  const H = '[가-힣]';
  const SUF = '(?:에|까지|쯤|부터|중에?|은|는)?';
  const END = `(?!${H})`;
  const NB = `(?<!${H})`;
  const re = s => new RegExp(s);
  const futureYear = (now, m, d) => { let x = new Date(now.getFullYear(), m - 1, d); if (x < day0(now)) x = new Date(now.getFullYear() + 1, m - 1, d); return x };

  // 날짜(하루 단위). 앞에 있을수록 우선
  const DATE_RULES = [
    [re(`(?<![가-힣\\d])(\\d{1,3})\\s*(일|주|개월|달)\\s*(?:뒤|후)(?:에)?${END}`), (m, n) => {
      const k = +m[1]; if (m[2] === '일') return add(day0(n), k); if (m[2] === '주') return add(day0(n), 7 * k);
      const x = day0(n); x.setMonth(x.getMonth() + k); return x }],
    [re(`(?<!\\d)(\\d{4})[-.](\\d{1,2})[-.](\\d{1,2})(?!\\d)`), m => new Date(+m[1], m[2] - 1, +m[3])],
    [re(`(?<!\\d)(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${SUF}${END}`), (m, n) => futureYear(n, +m[1], +m[2])],
    [re(`(?<![\\d/])(\\d{1,2})/(\\d{1,2})(?![\\d/])${SUF}`), (m, n) => +m[1] <= 12 && +m[2] <= 31 ? futureYear(n, +m[1], +m[2]) : null],
    [re(`${NB}(오늘|내일|낼|모레|글피)${SUF}${END}`), (m, n) => add(day0(n), { 오늘: 0, 내일: 1, 낼: 1, 모레: 2, 글피: 3 }[m[1]])],
    [re(`${NB}(이번|다음|담|다다음)\\s*주\\s*([월화수목금토일])(?:요일)?${SUF}${END}`), (m, n) => {
      const w = { 이번: 0, 다음: 7, 담: 7, 다다음: 14 }[m[1]]; return add(day0(n), ((WD.indexOf(m[2]) + 6) % 7) - monIdx(n) + w) }],
    [re(`${NB}([월화수목금토일])요일${SUF}${END}`), (m, n) => {
      const t = (WD.indexOf(m[1]) + 6) % 7; return add(day0(n), ((t - monIdx(n) + 7) % 7) || 7) }],
    [re(`${NB}(?:(이번|다음|담)\\s*)?주말${SUF}${END}`), (m, n) => {
      const base = Math.max(0, 5 - monIdx(n)); return add(day0(n), base + (m[1] === '다음' || m[1] === '담' ? 7 : 0)) }],
    [re(`${NB}(다음|담)\\s*주${SUF}${END}`), (m, n) => add(day0(n), 7 - monIdx(n))],
  ];
  const MER = '(오전|오후|아침|낮|저녁|밤|새벽)';
  const hour = (mer, h, korean) => {
    if (mer === '오후' || mer === '저녁' || mer === '밤' || mer === '낮') return h < 12 ? h + 12 : h;
    if (mer === '오전' || mer === '아침' || mer === '새벽') return h === 12 ? 0 : h;
    if (korean && h >= 1 && h <= 6) return h + 12; // "3시" = 오후 3시가 자연스러움
    return h;
  };
  const TIME_RULES = [
    [re(`(?<![가-힣\\d])(?:${MER}\\s*)?(\\d{1,2})\\s*시(?:\\s*(반|(\\d{1,2})\\s*분))?${SUF}${END}`), m => [hour(m[1], +m[2], true), m[3] === '반' ? 30 : +(m[4] || 0)]],
    [re(`(?<![\\d:])(?:${MER}\\s*)?(\\d{1,2}):(\\d{2})(?![\\d:])${SUF}`), m => [hour(m[1], +m[2], false), +m[3]]],
    [re(`${NB}(정오)${SUF}${END}`), () => [12, 0]],
    [re(`${NB}(아침|점심|저녁|밤)${SUF}${END}`), m => [{ 아침: 9, 점심: 12, 저녁: 19, 밤: 21 }[m[1]], 0]],
  ];
  const REL_TIME = re(`(?<![가-힣\\d])(\\d{1,3})\\s*(시간|분)\\s*(?:뒤|후)(?:에)?${END}`);

  function parse(text, now = new Date()) {
    if (!text) return null;
    const spans = []; let day = null, hm = null, abs = null;
    const r = REL_TIME.exec(text);
    if (r) { abs = new Date(now.getTime() + (+r[1]) * (r[2] === '시간' ? 36e5 : 6e4)); spans.push([r.index, r.index + r[0].length]) }
    if (!abs) {
      for (const [rx, fn] of DATE_RULES) { const m = rx.exec(text); if (!m) continue; const d = fn(m, now); if (!d || isNaN(d)) continue; day = d; spans.push([m.index, m.index + m[0].length]); break }
      for (const [rx, fn] of TIME_RULES) {
        const m = rx.exec(text); if (!m) continue;
        if (spans.some(([s, e]) => m.index < e && s < m.index + m[0].length)) continue;
        const [h, mi] = fn(m); if (h > 23 || mi > 59) continue; hm = [h, mi]; spans.push([m.index, m.index + m[0].length]); break
      }
    }
    if (!abs && !day && !hm) return null;
    let at;
    if (abs) at = isoDT(abs);
    else if (hm) { let d = new Date(day || day0(now)); d.setHours(hm[0], hm[1], 0, 0); if (!day && d < now) d = add(d, 1); at = isoDT(d) }
    else at = isoD(day);
    let title = text; [...spans].sort((a, b) => b[0] - a[0]).forEach(([s, e]) => { title = title.slice(0, s) + ' ' + title.slice(e) });
    title = title.replace(/\s+/g, ' ').trim();
    return { at, title: title || text.trim(), spans };
  }

  const toDate = v => new Date(v.length > 10 ? v : v + 'T00:00');
  const daysFrom = (d, now) => Math.round((day0(d) - day0(now)) / 864e5);
  const hm24 = d => `${P2(d.getHours())}:${P2(d.getMinutes())}`;
  const hmKo = d => { const h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${P2(d.getMinutes())}` };

  function short(v, now = new Date()) {
    if (!v) return '';
    const d = toDate(v), n = daysFrom(d, now), t = v.length > 10 ? hm24(d) : '';
    const j = (a, b) => b ? `${a} ${b}` : a;
    if (n < -1) return `${-n}일 지남`;
    if (n === -1) return j('어제', t);
    if (n === 0) return t || '오늘';
    if (n === 1) return j('내일', t);
    if (n <= 6) return j(WD[d.getDay()], t);
    if (d.getFullYear() !== now.getFullYear()) return j(`${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}/${d.getDate()}`, t);
    return j(`${d.getMonth() + 1}/${d.getDate()}`, t);
  }

  function long(v, now = new Date()) {
    if (!v) return '';
    const d = toDate(v), n = daysFrom(d, now), wd = `(${WD[d.getDay()]})`;
    const rel = { '-1': '어제', 0: '오늘', 1: '내일', 2: '모레' }[n];
    const md = `${d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일`;
    const head = rel ? `${rel} ${wd}` : `${md} ${wd}`;
    return v.length > 10 ? `${head} ${hmKo(d)}` : head;
  }

  function quick(now = new Date()) {
    const t0 = day0(now), mi = monIdx(now);
    const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return isoDT(x) };
    const out = [];
    if (now.getHours() < 18) out.push({ k: 'eve', label: '오늘 저녁', at: at(t0, 19) });
    out.push({ k: 'tmr', label: '내일', at: at(add(t0, 1), 9) });
    if (mi < 4) out.push({ k: 'wkd', label: '주말', at: at(add(t0, 5 - mi), 10) });
    out.push({ k: 'nwk', label: '다음 주', at: at(add(t0, 7 - mi), 9) });
    return out.map(o => ({ ...o, sub: short(o.at, now) }));
  }

  window.W = { parse, short, long, quick };
})();
