// 문서 속성 값 변환·검사(웹 apps/web/src/components/document-metadata.tsx 와 docs-api.ts propertyFilterIssue 와 같은 규칙과 문구).
// 만들기 시트(020)와 문서 페이지 속성 편집(030), 목록 속성 필터가 같이 써요. 서버 원본 규칙은 apps/server/server/docs/props.ts.
import type { DocProp, PropType, PropValue } from '@direction-board/contracts'
import type { PropOp } from '../../api/docs'

export const PROP_TYPES: PropType[] = ['text', 'number', 'date', 'datetime', 'checkbox', 'url', 'select', 'list']
export const TYPE_LABEL: Record<PropType, string> = { text: '텍스트', number: '숫자', date: '날짜', datetime: '날짜와 시간', checkbox: '체크박스', url: 'URL', select: '선택', list: '목록' }
export const PROP_OPS: Record<PropOp, string> = { eq: '같음', neq: '같지 않음', exists: '값 있음', missing: '값 없음', gt: '초과', gte: '이상', lt: '미만', lte: '이하', contains: '포함' }
const RESERVED = new Set(['ref', 'kind', 'title', 'area', 'status', 'tags', 'links', 'version', 'created', 'updated', 'source', 'due', 'remindat', 'parent'])
export const MAX_PROPS = 30

/** 입력칸 글 → 저장할 값. 숫자가 아니면 던져요(웹 parseValue 와 같음) */
export function parseValue(type: PropType, value: string): PropValue {
  if (type === 'checkbox') return value === '' ? null : value === 'true'
  if (type === 'number') {
    if (!value.trim()) return null
    const n = Number(value)
    if (!Number.isFinite(n)) throw new Error('올바른 숫자를 입력해 주세요.')
    return n
  }
  if (type === 'list') return value.split('\n').map((x) => x.trim()).filter(Boolean)
  if (type !== 'text' && value === '') return null
  return value
}
/** 저장된 값 → 입력칸 글 */
export const valueText = (v: PropValue): string => (Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v))
/** 보여 줄 값(값 없음은 빈 글) */
export function displayValue(p: DocProp): string {
  if (p.type === 'checkbox') return p.value === null ? '' : p.value ? '예' : '아니요'
  if (Array.isArray(p.value)) return p.value.join(', ')
  if (p.value === null || p.value === undefined) return ''
  if (typeof p.value === 'string' && (p.type === 'date' || p.type === 'datetime')) return p.value.replace('T', ' ')
  return String(p.value)
}

/** 새 속성 이름 검사(웹 add 와 같은 문구). 문제가 없으면 null */
export function newKeyIssue(raw: string, existing: DocProp[], schemaType: PropType | undefined, type: PropType): string | null {
  const k = raw.normalize('NFC').trim()
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _\-./]{0,39}$/u.test(k) || RESERVED.has(k.toLowerCase())) return '속성 이름은 1~40자의 문자·숫자·공백·_-./만 사용할 수 있으며 기본 속성 이름은 쓸 수 없어요.'
  if (existing.length >= MAX_PROPS) return '사용자 속성은 문서당 30개까지 추가할 수 있어요.'
  if (existing.some((p) => p.key === k)) return '이미 있는 속성이에요.'
  if (schemaType && schemaType !== type) return `이 속성의 기존 타입은 ${TYPE_LABEL[schemaType]}이에요.`
  return null
}
/** 새 속성의 첫 값(웹과 같음) */
export const initialValue = (type: PropType): PropValue => (type === 'checkbox' ? false : type === 'list' ? [] : type === 'text' ? '' : null)

/** 속성 필터 검사(웹 propertyFilterIssue 와 같은 문구). 문제가 없으면 null */
export function propertyFilterIssue(type: PropType | undefined, op: PropOp, value: string): string | null {
  if (op === 'exists' || op === 'missing') return null
  if (!value.trim()) return '속성 조건 값을 입력해 주세요.'
  if (['gt', 'gte', 'lt', 'lte'].includes(op) && type && !['number', 'date', 'datetime'].includes(type)) return '이 조건은 숫자·날짜 속성에 사용할 수 있어요.'
  if (op === 'contains' && type && ['number', 'checkbox', 'date', 'datetime'].includes(type)) return '포함 조건은 텍스트·선택·목록 속성에 사용할 수 있어요.'
  if (type === 'number' && !Number.isFinite(Number(value))) return '올바른 숫자를 입력해 주세요.'
  if (type === 'checkbox' && value !== 'true' && value !== 'false') return '체크박스 값은 true 또는 false로 입력해 주세요.'
  return null
}

/** 날짜 입력 검사: 할 일은 YYYY-MM-DDTHH:MM 도, 그 밖은 YYYY-MM-DD 만(서버 meta.ts 와 같은 모양) */
export function dueIssue(value: string, withTime: boolean): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && validDate(value)) return null
  if (withTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && validDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14)) < 60) return null
  return withTime ? '날짜는 2026-11-07 또는 2026-11-07T09:30 처럼 써 주세요' : '날짜는 2026-11-07 처럼 써 주세요'
}
function validDate(v: string) {
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
/** 오늘·내일 빠른 날짜(기기 시간대) */
export function dayOffset(days: number, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
