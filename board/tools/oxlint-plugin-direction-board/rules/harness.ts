import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Oxlint 자체를 실행해 파서와 플러그인 연결까지 확인해요.
export function lint(rule: string, file: string, source: string, budgets?: { backlog?: number; lines?: number; rawStyle?: Record<string, string[]> }) {
  const temp = mkdtempSync(budgets ? resolve(import.meta.dirname, '../../../.lint-test-') : join(tmpdir(), 'direction-board-oxlint-'))
  try {
    let plugin = resolve(import.meta.dirname, '../index.ts')
    if (budgets) {
      const pluginDir = join(temp, 'tools/oxlint-plugin-direction-board')
      cpSync(resolve(import.meta.dirname, '..'), pluginDir, { recursive: true })
      writeFileSync(join(pluginDir, 'backlogs.json'), JSON.stringify({ [rule]: { [file]: budgets.backlog ?? 0 } }))
      writeFileSync(join(pluginDir, 'code-budgets.json'), JSON.stringify({ [file]: { lines: budgets.lines ?? 0 } }))
      writeFileSync(join(pluginDir, 'raw-style-baseline.json'), JSON.stringify(budgets.rawStyle ?? {}))
      plugin = join(pluginDir, 'index.ts')
    }
    const path = join(temp, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
    const config = join(temp, 'config.json')
    writeFileSync(config, JSON.stringify({
      jsPlugins: [{ name: 'direction-board', specifier: plugin }],
      categories: { correctness: 'off' },
      rules: { [`direction-board/${rule}`]: 'error' },
    }))
    const result = Bun.spawnSync(['node', resolve(import.meta.dirname, '../../../node_modules/oxlint/bin/oxlint'), '--config', config, path], { stdout: 'pipe', stderr: 'pipe' })
    return { status: result.exitCode, output: result.stdout.toString() + result.stderr.toString() }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}
