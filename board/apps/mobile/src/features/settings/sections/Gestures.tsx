import React from 'react'
import { Text } from 'react-native'
import { Section } from '../../../ui/Section'
import { styles } from '../../../ui/theme'
import { SettingRow } from '../parts'

const GESTURES: [string, string][] = [
  ['당겨서 새로고침', '목록·상세를 아래로 당기면 다시 불러와요'],
  ['왼쪽으로 밀기', '할 일 끝냄·다시 열기처럼 되돌릴 수 있는 한 동작. 결과에 되돌리기 알림이 떠요'],
  ['길게 누르기', '그 줄의 모든 동작(되돌리기 어려운 것은 확인 뒤), 답 복사·공유'],
  ['왼쪽 가장자리에서 밀기', '뒤로'],
  ['시트 끌어내리기', '닫기'],
  ['탭을 다시 누르기', '그 탭 맨 처음 화면으로'],
]

/** 웹 단축키 자리. 앱에는 키보드 단축키가 없어서 쓰는 제스처를 적어요 */
export function GesturesSection() {
  return (
    <>
      <Section>
        <SettingRow id="gesture-list" label="제스처" info="화면마다 같은 손짓이 같은 일을 해요" />
        {GESTURES.map(([name, what]) => (
          <SettingRow key={name} id={`gesture-${name}`} label={name} info={what} />
        ))}
      </Section>
      <Text style={styles.meta}>키보드 단축키(⌘K 검색 등)는 웹의 설정 › 단축키에 있어요. 앱에서는 검색 탭이 ⌘K 자리예요.</Text>
    </>
  )
}
