/* 홈: 벤토 4칸 + 작은 칸 3개. 사건(signals)은 서버에서, 내 할 일·목표는 보드 데이터(S)에서 온다. */
(()=>{
const B=window.__db;if(!B)return;
const $=s=>document.querySelector(s),esc=B.esc;
const LS='db:home';
const st=(()=>{try{return JSON.parse(localStorage.getItem(LS))||{}}catch{return {}}})();
const saveSt=()=>{try{localStorage.setItem(LS,JSON.stringify(st))}catch{}};
const todayKey=()=>{const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`};
if(st.mainDay!==todayKey()){st.mainDay=todayKey();st.main=[];saveSt()}
if(st.focus===undefined)st.focus=true;

let data={signals:[],collectors:[],rules:[],stats:{interrupts_today:0}},failed=false,pollT=null;
const SRC={github:'GitHub',lms:'LMS',gmail:'Gmail',x:'X',slack:'Slack',kakao:'카톡',calendar:'캘린더',reminders:'미리알림',agent:'에이전트'};
const srcName=s=>SRC[s]||s;
function ago(ts){const s=Math.max(0,(Date.now()-ts)/1e3);if(s<60)return '방금';if(s<3600)return Math.floor(s/60)+'분 전';if(s<86400)return Math.floor(s/3600)+'시간 전';return Math.floor(s/86400)+'일 전'}
function dueTxt(ts){if(!ts)return '';const iso=new Date(ts);const p=n=>String(n).padStart(2,'0');const s=`${iso.getFullYear()}-${p(iso.getMonth()+1)}-${p(iso.getDate())}T${p(iso.getHours())}:${p(iso.getMinutes())}`;return window.W?W.short(s):iso.toLocaleString('ko-KR')}

async function load(){
  if(!B.remote()){failed=true;draw();return}
  try{data=await B.api('/api/signals');failed=false}catch{failed=true}
  draw();
}
async function patch(id,body){try{await B.api('/api/signals/'+id,{method:'PATCH',body:JSON.stringify(body)})}catch{B.toast('저장하지 못했어요')}load()}

/* ---- 보드 데이터에서 메인 일 후보 ---- */
function allItems(){const S=B.S();return Object.entries(S.items||{}).flatMap(([bid,arr])=>(arr||[]).map(it=>({it,bid})))}
function boardCands(){
  const end=new Date();end.setHours(23,59,59,999);const in2=Date.now()+2*864e5;
  return allItems().filter(({it})=>!it.done&&((it.type==='todo'&&it.remindAt&&new Date(it.remindAt)<=end)||(it.type==='goal'&&it.due&&new Date(it.due+'T23:59:00')<=in2)))
    .map(({it,bid})=>({key:'i:'+bid+':'+it.id,title:(it.text||'(제목 없음)').split('\n')[0],meta:it.type==='goal'?'목표 · '+B.dday(it.due).t:'미리알림 · '+B.whenLabel(it),done:false,item:it,bid}));
}
function sigCands(){return data.signals.filter(s=>s.lane==='main'&&s.status==='open').map(s=>({key:'s:'+s.id,title:s.title,meta:`${srcName(s.source)} · ${s.reason}${s.due?' · '+dueTxt(s.due):''}`,sig:s}))}
function resolveKey(k){
  if(k.startsWith('s:')){const s=data.signals.find(x=>x.id===k.slice(2));return s?{key:k,title:s.title,meta:`${srcName(s.source)}${s.due?' · '+dueTxt(s.due):''}`,done:s.status==='resolved',sig:s}:null}
  const [,bid,id]=k.split(':');const it=(B.S().items[bid]||[]).find(i=>i.id===id);return it?{key:k,title:(it.text||'(제목 없음)').split('\n')[0],meta:it.type==='goal'?'목표 · '+B.dday(it.due).t:'미리알림 · '+B.whenLabel(it),done:!!it.done,item:it,bid}:null;
}

/* ---- 그리기 ---- */
const ic={
  chk:on=>`<svg viewBox="0 0 16 16" width="16" height="16" class="hk${on?' on':''}"><circle cx="8" cy="8" r="6.75"/>${on?'<path d="M5.2 8.3l1.9 1.9 3.7-4"/>':''}</svg>`,
};
function row(s,acts){
  const t=s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`:esc(s.title);
  return `<div class="sg${s.lane==='now'?' now':''}" data-sig="${s.id}">
    <span class="src">${esc(srcName(s.source))}</span>
    <div class="sg-m"><div class="sg-t">${t}</div>${s.body?`<div class="sg-b">${esc(s.body)}</div>`:''}
      <div class="sg-r"><span class="why">${esc(s.reason||'')}</span>${s.agent?`<span>· ${esc(s.agent)}</span>`:''}<span>· ${ago(s.updated_at)}</span>${s.area?`<span class="ar">${esc(s.area)}</span>`:''}${s.private?'<span class="pv" title="이 맥 밖으로 안 나가요">개인</span>':''}${s.needs_ai?'<span class="ai">AI 판단 대기</span>':''}</div></div>
    <div class="sg-a">${acts}</div></div>`;
}
const btn=(act,label,cls='')=>`<button type="button" class="hb ${cls}" data-act="${act}">${label}</button>`;
function cell(id,title,count,body,extra='',cls=''){return `<section class="cell ${cls}" id="${id}"><div class="ch"><h3>${title}</h3>${count!==''?`<span class="cnt">${count}</span>`:''}<span class="sp"></span>${extra}</div><div class="cb">${body}</div></section>`}
const empty=t=>`<div class="hempty">${t}</div>`;

function draw(){
  const host=$('#home');if(!host||host.hidden)return;
  const sigs=data.signals;
  const open=l=>sigs.filter(s=>s.lane===l&&s.status==='open');
  const now=open('now'),decide=open('decide'),review=open('review');
  // running: 일(task)마다 최신 1개만
  const seen=new Set(),running=open('running').filter(s=>{const k=s.task||s.id;if(seen.has(k))return false;seen.add(k);return true});
  const autoDone=sigs.filter(s=>s.lane==='auto'&&Date.now()-s.updated_at<864e5);

  // 메인 일
  const mains=(st.main||[]).map(resolveKey).filter(Boolean);
  const mainLeft=mains.filter(m=>!m.done).length;
  const cands=[...boardCands(),...sigCands()].filter(c=>!(st.main||[]).includes(c.key)).sort((a,b)=>{const wa=a.item?B.whenOf(a.item):(a.sig&&a.sig.due?new Date(a.sig.due):null),wb=b.item?B.whenOf(b.item):(b.sig&&b.sig.due?new Date(b.sig.due):null);if(!!wa!==!!wb)return wa?-1:1;return (wa&&wb?wa-wb:0)});
  const mainBody=(mains.length?`<div class="mains">${mains.map((m,i)=>`<div class="mn${m.done?' done':''}" data-key="${esc(m.key)}"><button type="button" class="hk-b" data-act="main-done" aria-label="끝냄">${ic.chk(m.done)}</button><span class="no">${i+1}</span><div class="mn-m"><div class="mn-t">${esc(m.title)}</div><div class="mn-r">${esc(m.meta)}</div></div><button type="button" class="hb ghost" data-act="main-drop">빼기</button></div>`).join('')}</div>`:empty('오늘 꼭 끝낼 일을 3개까지 골라요. 이것만 끝내면 나머지는 몰아서 봐요.'))
    +(mains.length<3&&cands.length?`<div class="cands"><div class="lbl">후보 · 마감과 미리알림에서 골랐어요 <span class="soon">AI 추천은 다음 단계</span></div>${cands.slice(0,6).map(c=>`<div class="cd" data-key="${esc(c.key)}"><div class="mn-m"><div class="mn-t">${esc(c.title)}</div><div class="mn-r">${esc(c.meta)}</div></div><button type="button" class="hb" data-act="main-add">메인으로</button></div>`).join('')}</div>`:'');
  const mainExtra=`<button type="button" class="tgl${st.focus?' on':''}" data-act="focus" title="메인 일이 남아 있으면 결정 대기를 접어둬요"><i></i>집중 모드</button>`;

  // 결정 대기 (지금 끼어들 것은 항상 위에)
  const gate=st.focus&&mainLeft>0;
  const nowHTML=now.map(s=>row(s,btn('resolve','처리함','pri')+btn('mute','안 와도 돼'))).join('');
  const decHTML=gate&&decide.length?`<div class="gate"><div><b>${decide.length}건</b>이 기다리고 있어요</div><div class="g2">메인 일 ${mainLeft}개 끝나면 펼쳐드릴게요</div><button type="button" class="hb" data-act="peek">지금 볼래</button></div>`
    :decide.map(s=>row(s,btn('resolve','처리함')+btn('mute','안 와도 돼','ghost'))).join('');
  const decBody=(nowHTML?`<div class="nowbox"><div class="lbl red">지금 봐야 해요</div>${nowHTML}</div>`:'')+(decHTML||(!nowHTML?empty('기다리는 결정이 없어요'):''));

  // 하는 중
  const runBody=running.length?running.map(s=>row(s,'')).join(''):empty('지금 돌고 있는 에이전트 일이 없어요');
  // AI가 처리함 (+ 확인 필요)
  const autoBody=(review.length?`<div class="lbl">한 번 봐주면 좋아요</div>${review.map(s=>row(s,btn('resolve','확인함'))).join('')}`:'')
    +(autoDone.length?`<div class="lbl">알아서 끝냄 · 24시간</div>${autoDone.map(s=>row(s,btn('urgent','이건 알려줘','ghost'))).join('')}`:'')
    ||empty('아직 없어요');

  // 작은 칸
  const col=data.collectors.map(c=>{const stale=c.every_min&&Date.now()-c.last_seen>c.every_min*3*6e4;const bad=!c.ok||stale;return `<div class="col${bad?' bad':''}"><i></i><span class="cn">${esc(srcName(c.name))}</span><span class="cnote">${esc(bad&&stale&&c.ok?'소식 없음':c.note||'')}</span><span class="ct">${ago(c.last_seen)}</span></div>`}).join('')||empty('연결된 수집기가 없어요');
  const up=[...sigs.filter(s=>s.kind==='deadline'&&s.status==='open'&&s.lane==='info').map(s=>({t:s.title,d:s.due,src:srcName(s.source)})),
    ...allItems().filter(({it})=>it.type==='goal'&&!it.done&&it.due).map(({it})=>({t:(it.text||'목표').split('\n')[0],d:new Date(it.due+'T23:59:00').getTime(),src:'목표'}))]
    .filter(x=>x.d&&x.d>Date.now()-864e5).sort((a,b)=>a.d-b.d).slice(0,6);
  const upBody=up.length?up.map(x=>`<div class="up"><span class="ud">${esc(dueTxt(x.d))}</span><span class="ut">${esc(x.t)}</span><span class="us">${esc(x.src)}</span></div>`).join(''):empty('2주 안에 마감이 없어요');
  const n=data.stats.interrupts_today;
  const statBody=`<div class="big${n>3?' over':''}">${n}<span>번</span></div><div class="sub">오늘 나를 끼어들게 한 횟수 · 목표 3번 이하</div><div class="sub">내 분류 규칙 ${data.rules.length}개${data.rules.length?` <button type="button" class="hb ghost" data-act="rules">보기</button>`:''}</div>${st.showRules?`<div class="rules">${data.rules.map(r=>`<div class="rl"><span>${esc(r.note||'')}</span><button type="button" class="hb ghost" data-act="rule-del" data-rid="${r.id}">지우기</button></div>`).join('')}</div>`:''}`;

  const hasSample=sigs.some(s=>s.sample)||data.collectors.some(c=>c.sample);
  const d=new Date();
  host.innerHTML=`<div class="hwrap">
    <div class="htop"><div><div class="hd">${d.getMonth()+1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일</div><div class="hs">${failed?'로컬 서버에 연결되지 않았어요':`에이전트 ${running.length}개가 일하는 중 · 결정 ${decide.length+now.length}건 · 알아서 끝낸 일 ${autoDone.length}건${hasSample?' · 지금은 샘플 데이터예요':''}`}</div></div><span class="sp"></span>${hasSample?`<button type="button" class="hb ghost" data-act="clear-sample">샘플 지우기</button>`:''}</div>
    <div class="bento">
      ${cell('c-main','오늘 내 메인 일',mains.length?`${mains.length-mainLeft}/${mains.length}`:'',mainBody,mainExtra,'c-main')}
      ${cell('c-dec','내 결정 대기',now.length+decide.length||'',decBody,'','c-dec')}
      ${cell('c-run','에이전트가 하는 중',running.length||'',runBody,'','c-run')}
      ${cell('c-auto','AI가 알아서 처리한 것',autoDone.length+review.length||'',autoBody,'','c-auto')}
      ${cell('c-col','수집기',data.collectors.length||'',col,'','c-sm')}
      ${cell('c-up','다가오는 마감','',upBody,'','c-sm')}
      ${cell('c-stat','끼어들기','',statBody,'','c-sm')}
    </div></div>`;
}

document.addEventListener('click',async e=>{
  const host=$('#home');if(!host||!host.contains(e.target))return;
  const b=e.target.closest('[data-act]');if(!b)return;const act=b.dataset.act;
  const sid=b.closest('[data-sig]')?.dataset.sig;const key=b.closest('[data-key]')?.dataset.key;
  if(act==='resolve')return patch(sid,{status:'resolved'});
  if(act==='mute'){await patch(sid,{feedback:'mute'});B.toast('규칙을 만들었어요: 이런 건 앞으로 안 보내요');return}
  if(act==='urgent'){await patch(sid,{feedback:'urgent'});B.toast('규칙을 만들었어요: 이런 건 바로 알려줘요');return}
  if(act==='focus'){st.focus=!st.focus;saveSt();return draw()}
  if(act==='peek'){st.focus=false;saveSt();return draw()}
  if(act==='rules'){st.showRules=!st.showRules;saveSt();return draw()}
  if(act==='rule-del'){try{await B.api('/api/rules/'+b.dataset.rid,{method:'DELETE'})}catch{}return load()}
  if(act==='main-add'){st.main=[...(st.main||[]),key].slice(0,3);saveSt();return draw()}
  if(act==='main-drop'){st.main=(st.main||[]).filter(k=>k!==key);saveSt();return draw()}
  if(act==='main-done'){const m=resolveKey(key);if(!m)return;
    if(m.sig)return patch(m.sig.id,{status:m.done?'open':'resolved'});
    m.item.done=!m.item.done;B.save();B.render();return draw()}
  if(act==='clear-sample'){try{await B.api('/api/signals?sample=1',{method:'DELETE'})}catch{}B.toast('샘플을 지웠어요');return load()}
});

window.renderHome=()=>{draw()};
window.enterHome=()=>{load();clearInterval(pollT);pollT=setInterval(()=>{if(!$('#home').hidden&&!document.hidden)load()},15000)};
window.leaveHome=()=>{clearInterval(pollT)};
// 처음 열면 홈 (마지막 보기 기억)
const embed=document.documentElement.classList.contains('embed');
const first=embed?(new URLSearchParams(location.search).get('view')||'board'):(localStorage.getItem('db:view')||'home');
const tryStart=(n=0)=>{if(B.remote()||n>20){B.setView(first)}else setTimeout(()=>tryStart(n+1),150)};
tryStart();
})();
