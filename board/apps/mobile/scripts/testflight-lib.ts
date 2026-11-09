import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
export type Options = { mode: 'upload' | 'export' | 'simulator'; buildNumber: string; dryRun: boolean }
export function parseOptions(args: string[], now = Date.now()): Options {
  let mode: Options['mode'] = 'upload',
    dryRun = false,
    buildNumber = String(Math.floor(now / 60000)),
    chosen = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--build-number') {
      buildNumber = args[++i] || ''
      if (!/^[1-9]\d*$/.test(buildNumber)) throw new Error('--build-number must be a positive integer')
    } else if (arg === '--dry-run') dryRun = true
    else if (arg === '--simulator' || arg === '--export-only') {
      if (chosen) throw new Error('Choose one build mode')
      chosen = true
      mode = arg === '--simulator' ? 'simulator' : 'export'
    } else throw new Error(`Unknown argument ${arg}`)
  }
  return { mode, dryRun, buildNumber }
}
export function apiKeyArgs(
  env: Record<string, string | undefined>,
  repoRoot: string,
  otherRoots: string[] = [],
): string[] {
  const path = env.ASC_KEY_PATH?.trim(),
    id = env.ASC_KEY_ID?.trim(),
    issuer = env.ASC_ISSUER_ID?.trim()
  if (!path && !id && !issuer) return []
  if (!path || !id || !issuer)
    throw new Error('Set all of ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID, or none')
  if (!isAbsolute(path) || !existsSync(path))
    throw new Error('ASC_KEY_PATH must be an existing absolute path outside the repository')
  const key = realpathSync(path)
  for (const candidate of [repoRoot, ...otherRoots]) {
    const rel = relative(realpathSync(candidate), key)
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)))
      throw new Error('ASC_KEY_PATH must be outside the repository')
  }
  return ['-authenticationKeyPath', key, '-authenticationKeyID', id, '-authenticationKeyIssuerID', issuer]
}
export function exportOptionsPlist(teamId: string, destination: 'export' | 'upload'): string {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('Invalid Apple team ID')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>destination</key><string>${destination}</string><key>teamID</key><string>${teamId}</string><key>signingStyle</key><string>automatic</string><key>manageAppVersionAndBuildNumber</key><false/><key>uploadSymbols</key><true/></dict></plist>\n`
}
export type ArchiveFacts = {
  apps: { bundleId: string | null; version: string | null }[]
  embedded: { name?: unknown; ios?: { bundleIdentifier?: unknown } } | null
  extensions: number
}
export function archiveProblems(facts: ArchiveFacts, buildNumber: string): string[] {
  const errors: string[] = []
  if (facts.apps.length !== 1) errors.push('archive must contain exactly one app')
  if (facts.apps[0]?.bundleId !== 'com.lidgeai.direction') errors.push('incorrect app bundle id')
  if (facts.apps[0]?.version !== buildNumber) errors.push('incorrect app build number')
  if (facts.extensions) errors.push('unexpected app extensions')
  if (facts.embedded?.name !== '방향판') errors.push('incorrect or missing embedded Expo name')
  if (facts.embedded?.ios?.bundleIdentifier !== 'com.lidgeai.direction')
    errors.push('incorrect or missing embedded Expo bundle id')
  return errors
}
export const outputPath = (mobileRoot: string, buildNumber: string) =>
  resolve(mobileRoot, '.testflight', buildNumber)

/** prebuild --clean 이 지워도 되는 ios/ 인지: 이 스크립트가 만든 폴더에만 표시 파일을 남겨요. */
export const PREBUILD_MARKER = '.direction-prebuild'
export function iosCleanBlocker(iosExists: boolean, hasMarker: boolean): string | null {
  if (!iosExists || hasMarker) return null
  return 'apps/mobile/ios 가 이 스크립트가 만든 폴더가 아니에요(표시 파일 없음). prebuild --clean 이 지우기 전에 내용을 확인하고, 필요 없으면 직접 옮기거나 지운 뒤 다시 실행하세요. 고칠 것은 app.config.ts·config plugin 에 두세요.'
}
