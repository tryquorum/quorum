// 일 속성 시트의 순수 검사(웹 document-metadata.tsx 와 같은 규칙)
import { RESERVED_PROP_KEYS, type DocProp, type PropType, type PropValue } from '@direction-board/contracts'

/** 웹 document-metadata.tsx parseValue 와 같은 변환 */
export function parseProp(type: PropType, value: string): PropValue {
  if (type === 'checkbox') return value === '' ? null : value === 'true'
  if (type === 'number') {
    if (!value.trim()) return null
    const n = Number(value)
    if (!Number.isFinite(n)) throw new Error('올바른 숫자를 입력해 주세요.')
    return n
  }
  if (type === 'list') return value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
  if (type !== 'text' && value === '') return null
  return value
}
/** 새 속성 이름 검사(웹 add() 와 같음): 1~40자, 예약어 아님, 30개까지, 같은 이름 없음 */
export function propKeyIssue(key: string, props: DocProp[]): string | null {
  const k = key.normalize('NFC').trim()
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _\-./]{0,39}$/u.test(k) || (RESERVED_PROP_KEYS as readonly string[]).some((r) => r.toLowerCase() === k.toLowerCase())) return '속성 이름은 1~40자의 문자·숫자·공백·_-./만 쓸 수 있고 기본 속성 이름은 쓸 수 없어요.'
  if (props.length >= 30) return '사용자 속성은 30개까지예요.'
  if (props.some((p) => p.key === k)) return '이미 있는 속성이에요.'
  return null
}
