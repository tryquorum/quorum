# 메타데이터 계약

[계약 결정 `eaa8607`](docs-layer.md)과 [타입](../../packages/contracts/src/docs.ts)은 기본 메타와 사용자 속성을 구분해요. `ref`, `kind`, `title`, `area`, `status`, `tags`, `links`, `version`, `created`, `updated`, `source`, `due`, `remindAt`은 사용자 속성 이름으로 쓸 수 없어요. 같은 소유자 판에서 같은 속성 키의 타입은 하나예요. 사용자 속성은 거울 frontmatter에도 들어가요.

할 일·목표·독립 문서의 기본 메타는 원본과 함께 바꾸고, 사건·대화는 상태만 바꿔요. 원본이 없는 보관 문서의 메타 수정은 거절해요. 버전 충돌은 덮어쓰지 않고 409로 돌려줘요. 편집기 원문은 HTML과 마크다운, 버전을 함께 돌려주므로 변환된 거울을 편집 원본으로 취급하지 마세요.
