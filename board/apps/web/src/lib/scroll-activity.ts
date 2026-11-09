// 스크롤하는 동안만 그 영역의 스크롤 막대를 진하게 보이려고 data-scrolling 을 잠깐 붙여요(index.css).
// 이벤트를 받은 요소에만 붙이고, 요소마다 타이머는 하나예요. 조용해지고 idleMs 가 지나면 떼요.

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) }

export function createScrollActivity<E extends object>(mark: (el: E, on: boolean) => void, idleMs = 700, timers: Timers = realTimers) {
  const pending = new WeakMap<E, unknown>()
  return (el: E) => {
    const prev = pending.get(el)
    if (prev === undefined) mark(el, true)
    else timers.clear(prev)
    pending.set(el, timers.set(() => { pending.delete(el); mark(el, false) }, idleMs))
  }
}

/** 문서 전체에서 스크롤을 들어요(캡처·passive). 돌려준 함수로 떼요 */
export function trackScrollActivity(doc: Document = document): () => void {
  const touch = createScrollActivity<Element>((el, on) => { if (on) el.setAttribute("data-scrolling", ""); else el.removeAttribute("data-scrolling") })
  const onScroll = (event: Event) => {
    const el = event.target instanceof Element ? event.target : doc.scrollingElement
    if (el) touch(el)
  }
  doc.addEventListener("scroll", onScroll, { capture: true, passive: true })
  return () => doc.removeEventListener("scroll", onScroll, { capture: true })
}
