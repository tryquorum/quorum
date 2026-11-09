import { docPath, Entry, fold, hash, INDEX, indexes, INTENT, key, Ledger, LEDGER, TAGS } from "./model"
import { Storage } from "./storage"

type Intent = { version: 1; owner: string; old: string; oldHash: string; next: string; nextHash: string; contents: Record<string, string>; restore?: string[] }
const digest = /^[a-f0-9]{64}$/
const validHash = (v: unknown): v is string => typeof v === "string" && digest.test(v)
function ledger(raw: string): Ledger {
  const l = JSON.parse(raw) as Ledger
  if (l?.version !== 1 || !Number.isSafeInteger(l.generation) || l.generation < 0 || !Array.isArray(l.entries) || !l.indexes || !(l.indexes.index === null || validHash(l.indexes.index)) || !(l.indexes.tags === null || validHash(l.indexes.tags)) || (l.indexes.index === null) !== (l.indexes.tags === null) || (l.generation === 0 && (l.entries.length !== 0 || l.indexes.index !== null)) || (l.generation > 0 && l.indexes.index === null)) throw new Error("invalid vault ledger")
  const keys = new Set<string>(), paths = new Set<string>()
  for (const e of l.entries) {
    if (!e || typeof e.owner !== "string" || typeof e.ref !== "string" || typeof e.title !== "string" || !Array.isArray(e.tags) || !e.tags.every(t => typeof t === "string") || !Number.isFinite(e.updated) || !validHash(e.hash) || typeof e.path !== "string" || !["todo", "goal", "signal", "run", "doc"].includes(e.kind) || e.path !== docPath(e)) throw new Error("invalid vault entry")
    const k = key(e.owner, e.ref), p = fold(e.path)
    if (keys.has(k) || paths.has(p)) throw new Error("duplicate vault entry")
    keys.add(k); paths.add(p)
  }
  return l
}
function files(l: Ledger): Map<string, string> {
  const result = new Map(l.entries.map(e => [e.path, e.hash]))
  if (l.indexes.index !== null) { result.set(INDEX, l.indexes.index); result.set(TAGS, l.indexes.tags!) }
  return result
}
export async function verifyManaged(store: Storage, entry: Entry): Promise<boolean> {
  const content = await store.read(entry.path)
  if (content === null) return false
  if (hash(content) !== entry.hash) throw new Error(`vault file changed: ${entry.path}`)
  return true
}
export async function verifyIndexes(store: Storage, l: Ledger): Promise<string[]> {
  const missing: string[] = []
  for (const [path, expected] of [[INDEX, l.indexes.index], [TAGS, l.indexes.tags]] as const) {
    const content = await store.read(path)
    if (content === null) { if (expected !== null) missing.push(path); continue }
    if (hash(content) !== expected) throw new Error(`vault file changed: ${path}`)
  }
  return missing
}
export async function validateRebuild(store: Storage, l: Ledger, owner: string, replacements: Entry[]): Promise<string[]> {
  const eligible = new Set(replacements.map(e => key(e.owner, e.ref) + "\0" + e.path))
  const missing: string[] = []
  for (const e of l.entries.filter(e => e.owner === owner)) {
    const content = await store.read(e.path)
    if (content === null && eligible.has(key(e.owner, e.ref) + "\0" + e.path)) missing.push(e.path)
    else if (content !== null && hash(content) !== e.hash) throw new Error(`vault file changed: ${e.path}`)
  }
  await verifyIndexes(store, l)
  return missing
}
function validateIntent(raw: string): { intent: Intent; old: Ledger; next: Ledger } {
  const i = JSON.parse(raw) as Intent
  if (i?.version !== 1 || typeof i.owner !== "string" || typeof i.old !== "string" || typeof i.next !== "string" || !validHash(i.oldHash) || !validHash(i.nextHash) || hash(i.old) !== i.oldHash || hash(i.next) !== i.nextHash || !i.contents || typeof i.contents !== "object" || Array.isArray(i.contents)) throw new Error("invalid vault intent")
  const old = ledger(i.old), next = ledger(i.next)
  if (next.generation !== old.generation + 1) throw new Error("invalid vault generation")
  const other = (l: Ledger) => l.entries.filter(e => e.owner !== i.owner).sort((a,b) => key(a.owner,a.ref).localeCompare(key(b.owner,b.ref)))
  if (JSON.stringify(other(old)) !== JSON.stringify(other(next))) throw new Error("intent changes another owner")
  const before = files(old), after = files(next)
  const oldOwners = new Map(old.entries.map(e => [e.path, key(e.owner,e.ref)]))
  for (const e of next.entries) if (oldOwners.has(e.path) && oldOwners.get(e.path) !== key(e.owner,e.ref)) throw new Error("intent changes file owner")
  const expected = new Set([...after].filter(([p,h]) => before.get(p) !== h).map(([p]) => p))
  if (i.restore !== undefined && (!Array.isArray(i.restore) || !i.restore.every(p => typeof p === "string") || new Set(i.restore).size !== i.restore.length)) throw new Error("invalid intent restore list")
  for (const path of i.restore ?? []) {
    if (path === INDEX || path === TAGS) {
      if (!before.has(path) || !after.has(path)) throw new Error("invalid index restore")
      expected.add(path)
      continue
    }
    const prior = old.entries.find(e => e.path === path && e.owner === i.owner)
    const replacement = next.entries.find(e => e.path === path && e.owner === i.owner)
    if (!prior || !replacement || key(prior.owner,prior.ref) !== key(replacement.owner,replacement.ref)) throw new Error("invalid restore ownership")
    expected.add(path)
  }
  if (Object.keys(i.contents).length !== expected.size) throw new Error("invalid intent contents")
  const rendered = indexes(next.entries)
  for (const [path, content] of Object.entries(i.contents)) {
    if (!expected.has(path) || typeof content !== "string" || hash(content) !== after.get(path)) throw new Error("invalid intent file")
    if ((path === INDEX && content !== rendered.index) || (path === TAGS && content !== rendered.tags)) throw new Error("invalid intent index")
  }
  return { intent: i, old, next }
}
async function validateDisk(store: Storage, old: Ledger, next: Ledger, owner: string, completed = false): Promise<void> {
  const owned = (l: Ledger) => ({ ...l, entries: l.entries.filter(e => e.owner === owner) })
  const before = files(owned(old)), after = files(owned(next))
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const content = await store.read(path), actual = content === null ? null : hash(content)
    const a = before.get(path) ?? null, b = after.get(path) ?? null
    if (actual !== null && (completed ? actual !== b : actual !== a && actual !== b)) throw new Error(`vault file changed or destination occupied: ${path}`)
  }
}
async function applyIntent(store: Storage, intent: Intent, old: Ledger, next: Ledger, recovery: boolean): Promise<void> {
  if (recovery) await validateDisk(store, old, next, intent.owner)
  const before = files(old), after = files(next)
  for (const [path, content] of Object.entries(intent.contents)) {
    const current = await store.read(path)
    const currentHash = current === null ? null : hash(current)
    if (currentHash === after.get(path)) continue
    if (currentHash !== null && currentHash !== (before.get(path) ?? null)) throw new Error(`vault file changed: ${path}`)
    await store.write(path, content, currentHash === null, currentHash === null ? undefined : before.get(path))
  }
  for (const [path, oldHash] of before) if (!after.has(path)) {
    const current = await store.read(path)
    if (current !== null) { if (hash(current) !== oldHash) throw new Error(`vault file changed: ${path}`); await store.remove(path, oldHash) }
  }
  await store.write(LEDGER, intent.next)
  await store.remove(INTENT)
}
export async function load(store: Storage): Promise<{ raw: string; ledger: Ledger }> {
  let raw = await store.read(LEDGER)
  const pending = await store.read(INTENT)
  if (raw === null) {
    if (pending !== null || await store.read(INDEX) !== null || await store.read(TAGS) !== null) throw new Error("unmanaged vault metadata")
    raw = JSON.stringify({ version: 1, generation: 0, entries: [], indexes: { index: null, tags: null } } satisfies Ledger)
    ledger(raw)
    await store.write(LEDGER, raw, true)
  }
  ledger(raw)
  if (pending !== null) {
    const { intent, old, next } = validateIntent(pending)
    if (raw === intent.old && hash(raw) === intent.oldHash) {
      await applyIntent(store, intent, old, next, true)
      raw = intent.next
    } else if (raw === intent.next && hash(raw) === intent.nextHash) {
      await validateDisk(store, old, next, intent.owner, true)
      const generated = indexes(next.entries)
      const recoverable = { ...intent.contents }
      if (hash(generated.index) === next.indexes.index) recoverable[INDEX] = generated.index
      if (hash(generated.tags) === next.indexes.tags) recoverable[TAGS] = generated.tags
      for (const [path, content] of Object.entries(recoverable)) {
        if (await store.read(path) === null) await store.write(path, content, true)
      }
      await store.remove(INTENT)
    } else throw new Error("intent does not match ledger")
  }
  const parsed = ledger(raw)
  return { raw, ledger: parsed }
}
export async function commit(store: Storage, raw: string, old: Ledger, owner: string, entries: Entry[], docs: Map<string,string>, restore: string[] = []): Promise<void> {
  const rendered = indexes(entries)
  const next: Ledger = { version: 1, generation: old.generation + 1, entries, indexes: { index: hash(rendered.index), tags: hash(rendered.tags) } }
  const nextRaw = JSON.stringify(next)
  const before = files(old), after = files(next)
  restore = [...new Set([...restore, ...await verifyIndexes(store, old)])]
  const contents: Record<string,string> = Object.create(null)
  for (const [path, digest] of after) if (before.get(path) !== digest || restore.includes(path)) {
    const content = path === INDEX ? rendered.index : path === TAGS ? rendered.tags : docs.get(path)
    if (content === undefined) throw new Error(`missing document content: ${path}`)
    contents[path] = content
  }
  const intent: Intent = { version: 1, owner, old: raw, oldHash: hash(raw), next: nextRaw, nextHash: hash(nextRaw), contents, ...(restore.length ? { restore } : {}) }
  const serialized = JSON.stringify(intent)
  validateIntent(serialized)
  // Normal operations check only changed files and indexes; rebuild already checked the whole ledger.
  const checked = new Set([INDEX, TAGS, ...restore, ...[...before].filter(([path, h]) => after.get(path) !== h).map(([path]) => path)])
  for (const path of checked) {
    const content = await store.read(path)
    if (content !== null && hash(content) !== (before.get(path) ?? null)) throw new Error(`vault file changed: ${path}`)
  }
  for (const path of after.keys()) if (!before.has(path)) {
    await store.target(path, false, true)
    if (await store.read(path) !== null) throw new Error(`unmanaged destination: ${path}`)
  }
  await store.write(INTENT, serialized, true)
  await applyIntent(store, intent, old, next, false)
}
