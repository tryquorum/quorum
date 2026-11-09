// 문서가 바뀌었다는 알림(웹 docs:changed 이벤트 대신). 이 앱의 쓰기가 끝나면 알리고, 목록·트리·폴더·문서 페이지가 다시 읽어요.
type Listener = () => void
const listeners = new Set<Listener>()
export function onDocsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function docsChanged() {
  for (const l of Array.from(listeners)) l()
}
