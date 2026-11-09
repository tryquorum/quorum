import { describe, expect, test } from "bun:test"
import { join, relative, resolve, sep } from "node:path"
import { serverPaths } from "./paths.ts"

describe("서버 기본 경로(이동 뒤 실제 데이터 위치 유지)", () => {
  const serverDir = resolve(import.meta.dir, "..")
  const repoRoot = resolve(serverDir, "..", "..")

  test("환경변수가 없으면 DB·거울·웹 빌드는 저장소 루트, 옛 화면은 서버 옆", () => {
    // 경로를 열지 않고 위치만 비교해요(실제 data/ 는 건드리지 않음).
    const p = serverPaths({}, serverDir)
    expect(relative(repoRoot, p.dbPath).split(sep)).toEqual(["data", "board.db"])
    expect(relative(repoRoot, p.vaultDir).split(sep)).toEqual(["data", "vault"])
    expect(resolve(p.webDir)).toBe(join(repoRoot, "apps", "web", "dist"))
    expect(resolve(p.goatProjectDir)).toBe(repoRoot)
    expect(p.publicDir).toBe(join(serverDir, "public"))
  })

  test("환경변수가 있으면 그대로 쓰고 거울은 DB 옆을 따라가요", () => {
    const p = serverPaths({ DB_PATH: "/tmp/x/board.db", WEB_DIR: "/w", PUBLIC_DIR: "/p", GOAT_PROJECT_DIR: "/g" }, serverDir)
    expect(p).toMatchObject({ dbPath: "/tmp/x/board.db", vaultDir: "/tmp/x/vault", webDir: "/w", publicDir: "/p", goatProjectDir: "/g" })
    expect(serverPaths({ VAULT_DIR: "/v" }, serverDir).vaultDir).toBe("/v")
  })
})
