import type { Database } from "bun:sqlite"
import { reindexRef } from "../docs/index.ts"
import { withDocsTx } from "../docs/storage.ts"
import { mdToNoteHtml } from "../notes.ts"
import { htmlToMarkdown, htmlToMarkdownLenient } from "./html-to-markdown.ts"
import { normalizeNamedEntities } from "./index.ts"

export function backfillNoteMarkdown(db: Database, convert = htmlToMarkdown, lenient = htmlToMarkdownLenient): {changed:number; failed:number; skipped:number} {
  return withDocsTx(db, () => {
    const result = {changed:0, failed:0, skipped:0}
    if (db.query("SELECT 1 FROM doc_migrations WHERE name=?").get("note_md_from_html")) return result
    // 대상: md 가 text 로 채워졌고 에이전트가 쓰지 않은 노트. 에이전트 노트는 writeAgentNote 가 md 를 직접 저장했다.
    // 화면은 md 를 보낸 적이 없어 md=text 인 사람 노트는 text 로 채워진 것으로 본다(출처 칸이 없어 데이터로는 구분 불가).
    const rows = db.query("SELECT owner,ref,html,md FROM work_notes WHERE (by IS NULL OR by<>'agent') AND md=text").all() as {owner:string;ref:string;html:string;md:string}[]
    const update = db.query("UPDATE work_notes SET md=?,version=version+1 WHERE owner=? AND ref=?")
    for (const row of rows) {
      if (row.html === mdToNoteHtml(row.md)) continue
      let markdown: string
      try {
        markdown = convert(row.html)
        if (typeof markdown !== "string") throw new TypeError("Converter must return a string")
      } catch {
        try {
          markdown = lenient(normalizeNamedEntities(row.html))
          if (typeof markdown !== "string") throw new TypeError("Converter must return a string")
        } catch { result.failed++; continue }
      }
      if (!markdown || markdown === row.md) { result.skipped++; continue }
      update.run(markdown,row.owner,row.ref)
      reindexRef(db,row.owner,row.ref)
      result.changed++
    }
    db.query("INSERT INTO doc_migrations(name,applied_at) VALUES (?,?)").run("note_md_from_html",Date.now())
    return result
  })
}
