import type { Me } from "@direction-board/contracts"
import type { SettingsListener } from "@direction-board/contracts/settings"

/** 로컬에는 로그아웃이 없고, 공개 접속은 인증 방식에 맞는 경로를 써요. */
export function logoutKind(listener: SettingsListener | undefined, auth: Me["auth"]): "google" | "access" | null {
  if (!listener || listener === "local") return null
  return auth === "google" ? "google" : "access"
}
