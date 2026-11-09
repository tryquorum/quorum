import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repoPath } from '../codeBudget.ts'

// 기존 위반 횟수만 남겨요. 줄인 횟수는 다시 늘리지 않아요.
const backlogs: Record<string, Record<string, number>> = JSON.parse(readFileSync(resolve(import.meta.dirname, '../backlogs.json'), 'utf8'))
export function limitFor(rule: string, filename: string): number {
  return backlogs[rule]?.[repoPath(filename)] ?? 0
}
