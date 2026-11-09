import { readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export const root = resolve(import.meta.dirname, '../..')
export const baselinePath = resolve(import.meta.dirname, 'code-budgets.json')
export const maxLines = 600
export type Budget = { lines?: number; nonNull?: number; asAny?: number }
export type Baseline = Record<string, Budget>

/** 한 파일의 새 기준선. 기준선은 줄어들기만 해요: 실제 값이 낮아지면 그 값으로 내려가고, 늘면 over 로 거부해요. */
export function nextBudget(file: string, counts: Required<Budget>, old: Budget | undefined, init: boolean): { budget: Budget; over: string[] } {
  const budget: Budget = {}
  const over: string[] = []
  for (const kind of ['lines', 'nonNull', 'asAny'] as const) {
    const minimum = kind === 'lines' ? maxLines : 0
    const oldLimit = Math.max(minimum, old?.[kind] ?? 0)
    if (counts[kind] <= minimum) continue
    if (!init && counts[kind] > oldLimit) over.push(`${file}: ${kind} ${counts[kind]} > ${oldLimit}`)
    budget[kind] = init ? counts[kind] : Math.min(counts[kind], oldLimit)
  }
  return { budget, over }
}
export const isTest = (file: string) => /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:test|tests|__tests__)\/)/u.test(file)
export const repoPath = (file: string) => relative(root, file).split(sep).join('/')
export const countLines = (text: string) => text === '' ? 0 : text.split('\n').length - Number(text.endsWith('\n'))
export const readBaseline = (): Baseline => JSON.parse(readFileSync(baselinePath, 'utf8'))
export function assertionKind(node: { type: string; typeAnnotation?: any }): 'nonNull' | 'asAny' | undefined {
  if (node.type === 'TSNonNullExpression') return 'nonNull'
  if (node.type !== 'TSAsExpression' && node.type !== 'TSTypeAssertion') return
  let type = node.typeAnnotation
  while (type?.type === 'TSParenthesizedType') type = type.typeAnnotation
  if (type?.type === 'TSAnyKeyword') return 'asAny'
}
