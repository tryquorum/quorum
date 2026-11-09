export const APP_NAME = "방향판"
export function setTitle(view?: string | null, unread = 0): void {
  document.title = unread > 0 ? `(${unread}) ${APP_NAME}` : view ? `${view} · ${APP_NAME}` : APP_NAME
}
