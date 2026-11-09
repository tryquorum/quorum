import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// iOS 에서는 왼쪽 세로 장식선(왼쪽 테두리·표시선·타임라인 줄)을 쓰지 않아요. 위계는 여백·글자 무게·바탕으로
// (docs/internals/mobile-ia.md "왼쪽 선과 위계"). 좁은 View 로 세운 선은 이 시험이 못 보니 리뷰에서 봐요.
const src = join(import.meta.dir, '..')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })

test('모바일 화면은 왼쪽 테두리 스타일을 쓰지 않아요', () => {
  const found = files(src).flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, i) => (/\bborder(?:Left|Start)(?:Width|Color|Style)?\b/.test(line) ? [`${relative(src, path)}:${i + 1}`] : [])),
  )
  expect(found).toEqual([])
})
