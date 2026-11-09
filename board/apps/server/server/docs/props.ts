import type { Database } from 'bun:sqlite'
import { DocsError, RESERVED_PROP_KEYS, type DocProp, type PropType, type PropValue, type PropsInput } from '@direction-board/contracts/docs'
import { withDocsTx } from './storage.ts'
import { docProps, getDocRecord, refreshChanged, reindexRef } from './index.ts'
import { conflictOf } from './document.ts'

export const PROP_TYPES:readonly PropType[] = ['text','number','date','datetime','checkbox','url','select','list']
/** 키: 1~40자, 글자·숫자로 시작, 글자·숫자·공백·_-./ 만(REST props=key:op:value 와 YAML 키에 안전) */
const KEY = /^[\p{L}\p{N}][\p{L}\p{N} _\-./]{0,39}$/u
const reserved = new Set(RESERVED_PROP_KEYS.map(k=>k.toLowerCase()))
export const PROP_LIMITS = { perDoc:30, perWrite:50, text:500, url:1000, option:60, listItems:20, docJson:4000 }
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/

export function validDate(value:string):boolean {
  const m = value.match(DATE) || value.match(DATETIME)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1],+m[2]-1,+m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2]-1 && d.getUTCDate() === +m[3]
}
export const isDate = (v:string) => DATE.test(v) && validDate(v)
export const isDateTime = (v:string) => DATETIME.test(v) && validDate(v)

export function normalizeKey(raw:unknown):string {
  if (typeof raw !== 'string') throw new DocsError(400,'Property keys must be strings')
  const key = raw.normalize('NFC').trim()
  if (!KEY.test(key)) throw new DocsError(400,`Invalid property key "${key.slice(0,40)}": use 1-40 letters, digits, spaces or _-./, starting with a letter or digit`)
  return key
}

/** 과거에 쓰던 parent 만 새 예약어에서도 읽거나 지울 수 있다. */
export function readableKey(raw:unknown):string {
  const key=normalizeKey(raw)
  if(key.toLowerCase()!=='parent' && reserved.has(key.toLowerCase())) throw new DocsError(400,`"${key}" is basic metadata; change it with meta instead of props`)
  return key
}

function writableKey(raw:unknown):string {
  const key=normalizeKey(raw)
  if (reserved.has(key.toLowerCase())) throw new DocsError(400,`"${key}" is basic metadata; change it with meta instead of props`)
  return key
}

export function inferType(value:PropValue):PropType {
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'string') {
    if (isDate(value)) return 'date'
    if (isDateTime(value)) return 'datetime'
    if (/^https?:\/\/\S+$/i.test(value)) return 'url'
  }
  return 'text'
}

function line(value:unknown, max:number, key:string, what:string):string {
  if (typeof value !== 'string') throw new DocsError(400,`"${key}" must be ${what}`)
  const s = value.trim()
  if (!s || /[\r\n]/.test(s) || s.length > max) throw new DocsError(400,`"${key}" must be ${what} (one line, 1-${max} characters)`)
  return s
}

/** 값을 타입에 맞게 검사·정리한다. null 은 '값 없는 속성'(노션의 빈 칸)으로 남는다 */
export function coerceValue(key:string, type:PropType, value:unknown):PropValue {
  if (value === null) return null
  switch (type) {
    case 'text': {
      if (typeof value !== 'string' || value.length > PROP_LIMITS.text) throw new DocsError(400,`"${key}" is text: send a string up to ${PROP_LIMITS.text} characters`)
      return value
    }
    case 'number': {
      const n = typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new DocsError(400,`"${key}" is number: send a finite number`)
      return n
    }
    case 'date': if (typeof value !== 'string' || !isDate(value)) throw new DocsError(400,`"${key}" is date: send YYYY-MM-DD`); return value
    case 'datetime': if (typeof value !== 'string' || !isDateTime(value)) throw new DocsError(400,`"${key}" is datetime: send YYYY-MM-DDTHH:MM`); return value
    case 'checkbox': if (typeof value !== 'boolean') throw new DocsError(400,`"${key}" is checkbox: send true or false`); return value
    case 'url': {
      const s = line(value,PROP_LIMITS.url,key,'an http(s) or mailto URL')
      let ok = false
      try { ok = ['http:','https:','mailto:'].includes(new URL(s).protocol) } catch {}
      if (!ok) throw new DocsError(400,`"${key}" is url: send an http(s) or mailto URL`)
      return s
    }
    case 'select': return line(value,PROP_LIMITS.option,key,'one option')
    case 'list': {
      if (!Array.isArray(value) || value.length > PROP_LIMITS.listItems) throw new DocsError(400,`"${key}" is list: send up to ${PROP_LIMITS.listItems} strings`)
      return [...new Set(value.map(v=>line(v,PROP_LIMITS.option,key,'a list of strings')))]
    }
  }
}

function typeOf(db:Database, owner:string, key:string):PropType|null {
  return (db.query('SELECT type FROM doc_prop_types WHERE owner=? AND key=?').get(owner,key) as {type:PropType}|null)?.type ?? null
}

function plainObject(value:unknown):value is Record<string,unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

/** 사용자 속성 고치기. 바뀌면 문서 version 을 올리고 색인·거울에 반영한다 */
export function setDocProps(db:Database, owner:string, input:PropsInput, by:'person'|'agent'):{ref:string;version:number;props:DocProp[]} {
  if (!input || typeof input.ref !== 'string' || !input.ref) throw new DocsError(400,'Provide ref')
  if ((input.set !== undefined && !plainObject(input.set)) || (input.types !== undefined && !plainObject(input.types)) || (input.remove !== undefined && (!Array.isArray(input.remove) || !input.remove.every(k=>typeof k === 'string')))) throw new DocsError(400,'Provide set as an object, types as an object and remove as a list of keys')
  if (input.expectedVersion !== undefined && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)) throw new DocsError(400,'expectedVersion must be a non-negative integer')
  const set = new Map<string,unknown>()
  for (const [raw,value] of Object.entries(input.set || {})) { const key = writableKey(raw); if (set.has(key)) throw new DocsError(400,`Property "${key}" appears twice`); set.set(key,value) }
  const types = new Map<string,PropType>()
  for (const [raw,type] of Object.entries(input.types || {})) {
    const key = writableKey(raw)
    if (!set.has(key)) throw new DocsError(400,`types names "${key}" but set does not`)
    if (!PROP_TYPES.includes(type as PropType)) throw new DocsError(400,`Choose a property type: ${PROP_TYPES.join(', ')}`)
    types.set(key,type as PropType)
  }
  const remove = new Set((input.remove || []).map(readableKey))
  for (const key of remove) if (set.has(key)) throw new DocsError(400,`"${key}" is both set and removed`)
  if (!set.size && !remove.size) throw new DocsError(400,'Provide set or remove')
  if (set.size > PROP_LIMITS.perWrite) throw new DocsError(400,`Set at most ${PROP_LIMITS.perWrite} properties at once`)
  refreshChanged(db,owner)
  return withDocsTx(db,()=>{
    const doc = getDocRecord(db,owner,input.ref)
    if (!doc) throw new DocsError(404,'Document not found')
    if (input.expectedVersion !== undefined && input.expectedVersion !== doc.version) throw new DocsError(409,'Document changed; fetch the current version',conflictOf(doc.version,doc.md))
    const current = new Map(doc.props.map(p=>[p.key,p]))
    const writes:{key:string;type:PropType;value:PropValue;newType:boolean}[] = []
    for (const [key,raw] of set) {
      const fixed = typeOf(db,owner,key)
      const wanted = types.get(key)
      if (fixed && wanted && wanted !== fixed) throw new DocsError(400,`"${key}" is already a ${fixed} property; use that type or another key`)
      const type = fixed || wanted || inferType(raw as PropValue)
      writes.push({key,type,value:coerceValue(key,type,raw),newType:!fixed})
    }
    const now = Date.now()
    let changed = false
    for (const w of writes) {
      const before = current.get(w.key)
      if (before && JSON.stringify(before.value) === JSON.stringify(w.value)) continue
      if (w.newType) db.query('INSERT OR IGNORE INTO doc_prop_types(owner,key,type) VALUES (?,?,?)').run(owner,w.key,w.type)
      db.query('INSERT INTO doc_props(owner,ref,key,value,by,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner,ref,key) DO UPDATE SET value=excluded.value,by=excluded.by,updated_at=excluded.updated_at').run(owner,input.ref,w.key,JSON.stringify(w.value),by,now)
      changed = true
    }
    for (const key of remove) {
      if (!current.has(key)) continue
      db.query('DELETE FROM doc_props WHERE owner=? AND ref=? AND key=?').run(owner,input.ref,key)
      // 이 키를 쓰는 문서가 더 없으면 타입도 풀어 다시 정할 수 있게 한다
      if (!db.query('SELECT 1 FROM doc_props WHERE owner=? AND key=?').get(owner,key)) db.query('DELETE FROM doc_prop_types WHERE owner=? AND key=?').run(owner,key)
      changed = true
    }
    const props = docProps(db,owner,input.ref)
    if (!changed) return {ref:input.ref,version:doc.version,props}
    if (props.length > PROP_LIMITS.perDoc) throw new DocsError(400,`A document can have at most ${PROP_LIMITS.perDoc} properties`)
    if (JSON.stringify(props).length > PROP_LIMITS.docJson) throw new DocsError(400,`Properties of one document must stay under ${PROP_LIMITS.docJson} characters of JSON`)
    db.query('UPDATE work_notes SET version=version+1,updated_at=? WHERE owner=? AND ref=?').run(now,owner,input.ref)
    reindexRef(db,owner,input.ref)
    const version = (db.query('SELECT version FROM work_notes WHERE owner=? AND ref=?').get(owner,input.ref) as {version:number}).version
    return {ref:input.ref,version,props}
  })
}
