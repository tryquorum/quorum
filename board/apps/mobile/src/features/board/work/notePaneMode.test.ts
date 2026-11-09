import { describe, expect, test } from 'bun:test'
import type { NoteSource } from '@direction-board/contracts'
import { notePaneMode } from './notePaneMode'

const src = (p: Partial<NoteSource>): NoteSource => ({ ref: 'item:b:1', html: '<p>x</p>', md: 'x', version: 3, personEdited: true, markdownEditable: true, ...p })

describe('노트 갈래 편집 길(코디네이터 지시 2 · B1)', () => {
  test('서버가 markdownEditable false 라고 하면 편집 길을 숨기고 이유를 보여요', () => {
    // 예: 웹에서 단어 안 굵게(<p>foo<strong>bar</strong>baz</p>)처럼 iOS md 로 지킬 수 없는 서식
    expect(notePaneMode({ noteVersioning: true, hasNote: true, source: src({ markdownEditable: false }) })).toEqual({ kind: 'readonly', reason: expect.stringContaining('웹에서 고쳐') })
  })
  test('필드가 없는 옛 서버 응답도 막아요', () => {
    expect(notePaneMode({ noteVersioning: true, hasNote: true, source: src({ markdownEditable: undefined }) }).kind).toBe('readonly')
  })
  test('버전 보호가 없는 서버면 노트가 있어도 없어도 읽기만', () => {
    expect(notePaneMode({ noteVersioning: undefined, hasNote: true, source: src({}) }).kind).toBe('readonly')
    expect(notePaneMode({ noteVersioning: false, hasNote: false }).kind).toBe('readonly')
  })
  test('편집 정보를 못 읽으면 읽기만(다시 시도)', () => {
    expect(notePaneMode({ noteVersioning: true, hasNote: true, sourceError: 'error' })).toEqual({ kind: 'readonly', reason: '노트 편집 정보를 불러오지 못했어요', retry: true })
  })
  test('노트가 없으면 시작, 편집 허락이면 편집', () => {
    expect(notePaneMode({ noteVersioning: true, hasNote: false })).toEqual({ kind: 'start' })
    expect(notePaneMode({ noteVersioning: true, hasNote: true, source: src({}) })).toEqual({ kind: 'edit' })
  })
})
