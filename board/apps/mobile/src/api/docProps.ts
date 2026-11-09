import type { DocProp } from '@direction-board/contracts'

function dateValue(value: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return value.includes('T') ? date.toLocaleString('ko-KR') : date.toLocaleDateString('ko-KR')
}

export function docProps(frontmatter: Record<string, unknown>): string[] {
  const result: string[] = []
  if (typeof frontmatter.due === 'string' && frontmatter.due.trim())
    result.push(`마감: ${dateValue(frontmatter.due)}`)
  const props = Array.isArray(frontmatter.props) ? (frontmatter.props as DocProp[]) : []
  for (const { key, type, value } of props) {
    if (value === null || (typeof value === 'string' && !value.trim())) continue
    const display = Array.isArray(value)
      ? value.filter((item) => item.trim()).join(', ')
      : typeof value === 'string' && (type === 'date' || type === 'datetime')
        ? dateValue(value)
        : String(value)
    if (display) result.push(`${key}: ${display}`)
  }
  return result
}
