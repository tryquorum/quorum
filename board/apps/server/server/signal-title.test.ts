import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initSignals, ingest } from './signals.ts'

test('a title a person changed survives the same signal being sent again', () => {
  const db = new Database(':memory:')
  initSignals(db)
  const first = ingest(db, 'a', { ref: 'ops:x', kind: 'info', source: 'gmail', title: '원래 제목' }, true)
  db.query("UPDATE signals SET title='내가 고친 제목', meta=json_set(coalesce(meta,'{}'),'$.titleBy','person') WHERE id=?").run(first.id)
  ingest(db, 'a', { ref: 'ops:x', kind: 'info', source: 'gmail', title: '순회가 다시 보낸 제목', body: '새 본문' }, true)
  const row = db.query('SELECT title, body, meta FROM signals WHERE id=?').get(first.id) as { title: string; body: string; meta: string }
  expect(row.title).toBe('내가 고친 제목')
  expect(row.body).toBe('새 본문')
  expect(JSON.parse(row.meta).titleBy).toBe('person')
  ingest(db, 'a', { ref: 'ops:y', kind: 'info', source: 'gmail', title: 'A' }, true)
  ingest(db, 'a', { ref: 'ops:y', kind: 'info', source: 'gmail', title: 'B' }, true)
  expect((db.query("SELECT title FROM signals WHERE ref='ops:y'").get() as { title: string }).title).toBe('B')
})

