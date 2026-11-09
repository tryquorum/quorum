import { expect, test } from 'bun:test'
import { docProps } from './docProps'

test('서버 문서의 마감과 사용자 속성을 표시해요', () => {
  expect(
    docProps({
      due: '2026-11-07',
      props: [
        { key: '목록', type: 'list', value: ['하나', '둘'] },
        { key: '숫자', type: 'number', value: 0 },
        { key: '날짜', type: 'date', value: '2026-11-07' },
        { key: '시각', type: 'datetime', value: '2026-11-07T14:30' },
        { key: '체크', type: 'checkbox', value: false },
        { key: '비어있음', type: 'text', value: '' },
        { key: '없음', type: 'text', value: null },
        { key: '빈 목록', type: 'list', value: [] },
      ],
    }),
  ).toEqual([
    `마감: ${new Date('2026-11-07T00:00:00').toLocaleDateString('ko-KR')}`,
    '목록: 하나, 둘',
    '숫자: 0',
    `날짜: ${new Date('2026-11-07T00:00:00').toLocaleDateString('ko-KR')}`,
    `시각: ${new Date('2026-11-07T14:30').toLocaleString('ko-KR')}`,
    '체크: false',
  ])
})
