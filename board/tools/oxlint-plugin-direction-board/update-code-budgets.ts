import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'oxc-parser'
import { assertionKind, baselinePath, countLines, isTest, nextBudget, readBaseline, root, type Budget } from './codeBudget.ts'

const init = process.argv.includes('--init')
const before = readBaseline()
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
  .filter(file => /\.[cm]?[jt]sx?$/u.test(file) && existsSync(join(root, file)) && !/(?:^|\/)(?:node_modules|dist)\//u.test(file)).sort()
const next: Record<string, Budget> = {}
const over: string[] = []
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8')
  const counts = { lines: countLines(text), nonNull: 0, asAny: 0 }
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    const kind = assertionKind(node)
    if (kind && !isTest(file)) counts[kind]++
    for (const [key, value] of Object.entries(node)) if (key !== 'parent') visit(value)
  }
  const parsed = parseSync(file, text)
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors.map(error => error.message).join('; ')}`)
  visit(parsed.program)
  const { budget: current, over: fileOver } = nextBudget(file, counts, before[file], init)
  over.push(...fileOver)
  if (Object.keys(current).length) next[file] = current
}
if (over.length) { console.error(over.join('\n')); process.exit(1) }
writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n')
console.log(`기준선 ${Object.keys(next).length}개 파일`)
