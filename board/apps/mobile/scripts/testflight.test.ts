import { expect, test } from 'bun:test'
import { apiKeyArgs, archiveProblems, exportOptionsPlist, iosCleanBlocker, parseOptions } from './testflight-lib'

test('스크립트가 만들지 않은 ios 폴더는 prebuild --clean 전에 멈춰요', () => {
  expect(iosCleanBlocker(false, false)).toBeNull()
  expect(iosCleanBlocker(true, true)).toBeNull()
  expect(iosCleanBlocker(true, false)).toContain('이 스크립트가 만든 폴더가 아니에요')
})
test('빌드 옵션을 검사해요', () => {
  expect(parseOptions(['--export-only', '--build-number', '123', '--dry-run'], 0)).toEqual({
    mode: 'export',
    buildNumber: '123',
    dryRun: true,
  })
  expect(parseOptions([], 120000).buildNumber).toBe('2')
  expect(() => parseOptions(['--build-number', '0'])).toThrow()
  expect(() => parseOptions(['--simulator', '--export-only'])).toThrow()
  expect(() => parseOptions(['--unknown'])).toThrow()
})
test('아카이브의 앱과 Expo 설정을 검증해요', () => {
  const facts = {
    apps: [{ bundleId: 'com.lidgeai.direction', version: '123' }],
    embedded: { name: '방향판', ios: { bundleIdentifier: 'com.lidgeai.direction' } },
    extensions: 0,
  }
  expect(archiveProblems(facts, '123')).toEqual([])
  expect(archiveProblems({ ...facts, apps: [] }, '123').length).toBeGreaterThan(0)
  expect(archiveProblems({ ...facts, extensions: 1 }, '123')).toContain('unexpected app extensions')
  expect(archiveProblems({ ...facts, embedded: null }, '123').length).toBeGreaterThan(0)
  expect(archiveProblems(facts, '124')).toContain('incorrect app build number')
})
test('서명 키와 내보내기 옵션을 검사해요', () => {
  expect(apiKeyArgs({}, process.cwd())).toEqual([])
  expect(() => apiKeyArgs({ ASC_KEY_ID: 'x' }, process.cwd())).toThrow()
  expect(() =>
    apiKeyArgs({ ASC_KEY_PATH: import.meta.path, ASC_KEY_ID: 'id', ASC_ISSUER_ID: 'issuer' }, process.cwd()),
  ).toThrow('outside the repository')
  expect(exportOptionsPlist('U9ATA49N28', 'export')).toContain(
    '<key>manageAppVersionAndBuildNumber</key><false/>',
  )
  expect(exportOptionsPlist('U9ATA49N28', 'export')).toContain('<string>export</string>')
  expect(exportOptionsPlist('U9ATA49N28', 'upload')).toContain('<string>upload</string>')
})
