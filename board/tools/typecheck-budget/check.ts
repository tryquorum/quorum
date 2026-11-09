import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const baselinePath = join(import.meta.dirname, 'server-baseline.json')
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--init' && arg !== '--update') || args.length > 1) {
  console.error('Usage: bun tools/typecheck-budget/check.ts [--init|--update]')
  process.exit(1)
}
const init = args.includes('--init')
const update = args.includes('--update')
if (init && existsSync(baselinePath)) throw new Error('기준선이 이미 있어요')
if (!init && !existsSync(baselinePath)) throw new Error('기준선이 없어요. --init으로 만드세요')

const result = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.server.json', '--pretty', 'false'], { cwd: root, encoding: 'utf8' })
const output = result.stdout + result.stderr
if (result.error || result.signal || (result.status !== 0 && result.status !== 2)) {
  console.error(output || result.error?.message || `tsc failed: ${result.signal ?? result.status}`)
  process.exit(1)
}
const counts: Record<string, number> = {}
for (const line of output.split(/\r?\n/)) {
  if (!line.trim()) continue
  const match = /^(.+?)\(\d+,\d+\): error TS\d+:/.exec(line)
  if (match) counts[match[1]] = (counts[match[1]] ?? 0) + 1
  else if (!/^\s/.test(line)) {
    console.error(`파일을 식별할 수 없는 tsc 출력: ${line}`)
    process.exit(1)
  }
}
if (result.status !== 0 && Object.keys(counts).length === 0) throw new Error('tsc 오류를 분석하지 못했어요')
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
if (init) {
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`서버 타입 오류 기준선: ${Object.keys(sorted).length}개 파일`)
  process.exit(0)
}
const baseline: Record<string, number> = JSON.parse(readFileSync(baselinePath, 'utf8'))
let increased = false
let reduced = false
for (const file of new Set([...Object.keys(baseline), ...Object.keys(counts)])) {
  const before = baseline[file] ?? 0, current = counts[file] ?? 0
  if (current > before) { console.error(`${file}: 오류 ${current}개 > 기준선 ${before}개`); increased = true }
  if (current < before) { console.log(`${file}: 오류 ${before} → ${current}개. 기준선을 줄이세요 (--update).`); reduced = true }
}
if (increased) process.exit(1)
if (update && reduced) writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n')
console.log('서버 타입 오류가 기준선 이내예요')
