// 마지막 입력이 포인터였는지 기억해요. 앱이 화면을 옮기며 준 포커스를 포인터 사용자에겐 조용히 보여 줄 때 써요.
let pointer = false
let stop: (() => void) | null = null

/** 캡처 단계에서 pointerdown·keydown 을 들어요. 이미 듣고 있으면 그대로 두고, 돌려준 함수로 떼요(HMR·시험) */
export function trackInputModality(target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = document): () => void {
  if (stop) return stop
  const onPointer = () => { pointer = true }
  const onKey = () => { pointer = false }
  target.addEventListener("pointerdown", onPointer, true)
  target.addEventListener("keydown", onKey, true)
  stop = () => {
    target.removeEventListener("pointerdown", onPointer, true)
    target.removeEventListener("keydown", onKey, true)
    pointer = false
    stop = null
  }
  return stop
}

export const lastInputWasPointer = () => pointer
