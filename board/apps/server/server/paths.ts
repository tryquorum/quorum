import { dirname, join } from "node:path"

/**
 * 서버가 읽고 쓰는 경로의 기본값. 서버는 apps/server 에 있지만 실제 데이터(data/)와 웹 빌드는 저장소 루트
 * 기준이라, 파일 위치(import.meta.dir)로 바로 잡으면 빈 DB 를 새로 열게 돼요. 환경변수가 있으면 그것이 우선.
 */
export function serverPaths(env: Record<string, string | undefined>, serverDir: string) {
  const repoRoot = join(serverDir, "..", "..")
  const dbPath = env.DB_PATH || join(repoRoot, "data", "board.db")
  return {
    repoRoot,
    dbPath,
    publicDir: env.PUBLIC_DIR || join(serverDir, "public"),
    webDir: env.WEB_DIR || join(repoRoot, "apps", "web", "dist"),
    goatProjectDir: env.GOAT_PROJECT_DIR || repoRoot,
    vaultDir: env.VAULT_DIR || join(dirname(dbPath), "vault"),
  }
}
