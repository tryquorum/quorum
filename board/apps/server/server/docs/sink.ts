import type { Database } from 'bun:sqlite'
import type { DocRecord, VaultSink } from '@direction-board/contracts/docs'
import { getDocRecord } from './index.ts'

/**
 * 거울(VaultSink) 연결. 모든 거울 작업은 owner 별 한 줄 큐에서 차례로 돈다.
 * doc_mirror_state 는 거울에 실제로 들어갔다고 확인된 문서 서명이다: 보내기에 성공한 뒤에만 쓰고,
 * 실패하면 '!retry' 로 남겨 다음 refresh 가 다시 보낸다. 보낼지 말지는 작업이 큐에서 돌 때의 커밋된 DB 로 정한다.
 * sink 를 붙이면 owner 마다 rebuild 가 성공할 때까지 기록을 믿지 않는다(needsRebuild): 개별 작업은 건너뛰고
 * refresh 가 실패한 rebuild 를 다시 시도한다.
 */
type State = { sink: VaultSink; queues: Map<string, Promise<void>>; needsRebuild: Set<string>; rebuilding: Set<string> }
const states = new WeakMap<Database, State>()
const RETRY = '!retry'
export function hasVaultSink(db: Database): boolean { return states.has(db) }

const recordSig = (doc:DocRecord) => new Bun.CryptoHasher('sha256').update(JSON.stringify(doc)).digest('hex')

/** 같은 연결에서 호출자 트랜잭션이 열려 있으면 커밋되지 않은 내용을 읽게 된다. 끝날 때까지 기다린다 */
async function committed(db: Database): Promise<void> {
  while (db.inTransaction) await new Promise(resolve => setTimeout(resolve, 5))
}

function enqueue(state: State, owner: string, work: () => Promise<void>): Promise<void> {
  const previous = state.queues.get(owner) || Promise.resolve()
  const operation = previous.catch(() => {}).then(work)
  state.queues.set(owner, operation)
  operation.catch(() => console.error('[docs] vault sink operation failed'))
  return operation
}

export function setVaultSink(db: Database, sink?: VaultSink): void {
  if (!sink) { states.delete(db); return }
  const state: State = {sink, queues:states.get(db)?.queues || new Map(), needsRebuild:new Set(), rebuilding:new Set()}
  states.set(db,state)
  const owners = db.query('SELECT owner FROM doc_index UNION SELECT owner FROM doc_mirror_state ORDER BY owner').all() as {owner:string}[]
  for (const {owner} of owners) { state.needsRebuild.add(owner); void rebuildVault(db,owner).catch(() => {}) }
}

/** 거울 전체 재구축. 성공하면 owner 의 거울 기록을 보낸 문서들로 바꾼다 */
export function rebuildVault(db: Database, owner: string): Promise<void> {
  const state = states.get(db)
  if (!state) return Promise.resolve()
  state.rebuilding.add(owner)
  return enqueue(state, owner, async () => {
    try {
      if (states.get(db) !== state) return
      if (db.inTransaction) await committed(db)
      const refs = db.query('SELECT ref FROM doc_index WHERE owner=? ORDER BY ref').all(owner) as {ref:string}[]
      const docs = refs.map(({ref}) => getDocRecord(db,owner,ref)).filter((doc): doc is DocRecord => doc !== null)
      try { await state.sink.rebuild(owner,docs) } catch (error) { state.needsRebuild.add(owner); throw error }
      if (states.get(db) !== state) return
      if (db.inTransaction) await committed(db)
      db.transaction(() => {
        db.query('DELETE FROM doc_mirror_state WHERE owner=?').run(owner)
        const insert = db.query('INSERT INTO doc_mirror_state(owner,ref,sig,links) VALUES (?,?,?,?)')
        for (const doc of docs) insert.run(owner,doc.ref,recordSig(doc),JSON.stringify(doc.links))
      })()
      state.needsRebuild.delete(owner)
    } finally { state.rebuilding.delete(owner) }
  })
}

/** refresh 에서 부른다: 실패해 남은 rebuild 를 다시 시도한다. 시도했으면 true */
export function retryVaultRebuild(db: Database, owner: string): boolean {
  const state = states.get(db)
  if (!state || !state.needsRebuild.has(owner) || state.rebuilding.has(owner)) return false
  void rebuildVault(db,owner).catch(() => {})
  return true
}

function markRetry(db: Database, owner: string, ref: string, links: string): void {
  try { db.query('INSERT INTO doc_mirror_state(owner,ref,sig,links) VALUES (?,?,?,?) ON CONFLICT(owner,ref) DO UPDATE SET sig=excluded.sig').run(owner,ref,RETRY,links) }
  catch { console.error('[docs] could not mark mirror retry') }
}

/** 커밋 뒤 큐에 거울 맞추기를 넣는다. 큐에서 돌 때 지금 문서와 확인된 기록을 비교해 다를 때만 보낸다 */
export function queueMirrorSync(db: Database, owner: string, refs: string[]): void {
  const state = states.get(db)
  if (!state || !refs.length) return
  void enqueue(state, owner, async () => {
    if (states.get(db) !== state || state.needsRebuild.has(owner)) return
    for (const ref of refs) {
      if (db.inTransaction) await committed(db)
      if (states.get(db) !== state) return
      const doc = getDocRecord(db,owner,ref)
      const row = db.query('SELECT sig FROM doc_mirror_state WHERE owner=? AND ref=?').get(owner,ref) as {sig:string}|null
      if (doc) {
        const sig = recordSig(doc), links = JSON.stringify(doc.links)
        if (row?.sig === sig) continue
        let path: string
        try { ({path} = await state.sink.upsert(doc)) } catch { console.error('[docs] vault upsert failed; will retry'); markRetry(db,owner,ref,links); continue }
        if (states.get(db) !== state) return
        if (db.inTransaction) await committed(db)
        db.query('INSERT INTO doc_mirror_state(owner,ref,sig,links) VALUES (?,?,?,?) ON CONFLICT(owner,ref) DO UPDATE SET sig=excluded.sig,links=excluded.links').run(owner,ref,sig,links)
        // 거울 경로를 색인에 남긴다(같은 버전일 때만: 그 사이 새 버전이 생겼으면 그 작업이 다시 남긴다)
        if (typeof path === 'string' && path) db.query('UPDATE doc_index SET mirror_path=? WHERE owner=? AND ref=? AND version=? AND folders=?').run(path,owner,ref,doc.version,JSON.stringify(doc.folders || []))
      } else if (row) {
        try { await state.sink.remove(owner,ref) } catch { console.error('[docs] vault remove failed; will retry'); markRetry(db,owner,ref,'[]'); continue }
        if (states.get(db) !== state) return
        if (db.inTransaction) await committed(db)
        db.query('DELETE FROM doc_mirror_state WHERE owner=? AND ref=?').run(owner,ref)
        db.query('UPDATE doc_index SET mirror_path=NULL WHERE owner=? AND ref=?').run(owner,ref)
      }
    }
  }).catch(() => {})
}
