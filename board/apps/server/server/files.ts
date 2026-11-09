// 파일: 노트에 붙인 이미지를 data/uploads 에 저장하고, AI 결과물에 적힌 로컬 이미지 경로를 보여준다.
// 로컬 경로는 이미지 확장자만, 허용한 폴더(Aside 세션, 임시 폴더, 업로드 폴더) 안에서만 읽는다. 루프백 서버면 홈 폴더 전체.
import { mkdirSync, realpathSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { extname, join, resolve } from "node:path"

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
const err = (status: number, message: string) => json({ error: message }, status)

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif" }
const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif" }
const MAX = 20 * 1024 * 1024
const NAME = /^[0-9a-f-]{36}\.(png|jpg|gif|webp|avif)$/
const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}
const inside = (p: string, root: string) => p === root || p.startsWith(root + "/")
const serve = (path: string, cache: string) => new Response(Bun.file(path), { headers: { "content-type": TYPES[extname(path).toLowerCase()], "cache-control": cache } })

export async function filesApi(req: Request, url: URL, parts: string[], dataDir: string, loopback: boolean): Promise<Response | null> {
  if (parts[1] !== "files") return null
  const up = join(dataDir, "uploads")
  const m = req.method

  // POST /api/files  (본문 = 이미지 바이트, content-type = image/*) -> { url }
  if (parts.length === 2 && m === "POST") {
    const ext = EXT[(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()]
    if (!ext) return err(415, "image/png|jpeg|gif|webp|avif only")
    const buf = await req.arrayBuffer()
    if (!buf.byteLength) return err(400, "empty body")
    if (buf.byteLength > MAX) return err(413, "max 20MB")
    mkdirSync(up, { recursive: true })
    const name = crypto.randomUUID() + ext
    await Bun.write(join(up, name), buf)
    return json({ url: `/api/files/${name}` }, 201)
  }
  if (m !== "GET" || parts.length !== 3) return null

  // GET /api/files/local?path=/Users/.../shot.png
  if (parts[2] === "local") {
    // 이 맥의 파일이므로 이 맥 주인(로컬 리스너 또는 공개로 들어온 본인)만 본다
    if (!loopback) return err(403, "local images are shown only to the Mac owner")
    const raw = url.searchParams.get("path") || ""
    const p = real(resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw))
    if (!p || !TYPES[extname(p).toLowerCase()]) return err(404, "image not found")
    const roots = [join(homedir(), ".aside"), tmpdir(), "/tmp", "/private/var/folders", up, ...(loopback ? [homedir()] : [])]
      .map(real)
      .filter((r): r is string => !!r)
    if (!roots.some((r) => inside(p, r))) return err(403, "path not allowed")
    return serve(p, "private, max-age=3600")
  }

  // GET /api/files/<uuid>.<ext>
  if (!NAME.test(parts[2])) return err(404, "file not found")
  const f = join(up, parts[2])
  if (!(await Bun.file(f).exists())) return err(404, "file not found")
  return serve(f, "private, max-age=31536000, immutable")
}
