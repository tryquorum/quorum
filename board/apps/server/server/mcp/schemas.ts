import { z } from "zod"

const kind = z.enum(["todo", "goal", "signal", "run", "doc"])
const status = z.enum(["open", "done", "archived"])
const tagBy = z.enum(["auto", "person", "agent", "body"])
const strings = z.array(z.string())
const ref = z.string().min(1)
const propType = z.enum(["text", "number", "date", "datetime", "checkbox", "url", "select", "list"])
const propValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
const docProp = z.object({ key: z.string(), type: propType, value: propValue })
const propOp = z.enum(["eq", "neq", "exists", "missing", "gt", "gte", "lt", "lte", "contains"])

export const actionDescription = [
  "task: 필수 do, title, note(10자 이상); 선택 remindAt, area, tags(문자열 배열), type(\"goal\" 이면 목표, due YYYY-MM-DD), link, label, why, space(personal 또는 board_schema spaces 의 id·이름; 빼면 link 한 일의 공간, 없으면 개인).",
  "decide: 사용자가 골라야 하는 것을 결정 칸 사건으로. 필수 do, title(질문 한 줄); 선택 body(선택지·장단점·추천), link(관련 ref), space. 같은 공간의 같은 질문은 같은 사건을 갱신하고, 이미 결정한 같은 질문은 거절.",
  "done: 필수 do, ref; 선택 why.",
  "update: 필수 do, ref; 선택 title, remindAt, done, why, space(할 일·목표를 그 공간으로 옮기기).",
  "note: 필수 do, ref, md.",
  "doc: 필수 do, title, md; 선택 tags, area, link, parent. parent 생략은 전체에서 제목 합치기, null은 맨 위, ref는 해당 부모 아래에서만 합치기.",
  "move: 필수 do, ref, parent(ref 또는 null); 선택 before 또는 after.",
  "tag: 필수 do, ref; 선택 add, remove.",
  "meta: 필수 do, ref; 선택 title, area(이름 또는 null), status(open|done), due(YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM 또는 null), expectedVersion. 사건·대화는 status 만.",
  "props: 필수 do, ref; 선택 set({키: 값}), types({키: text|number|date|datetime|checkbox|url|select|list}), remove([키]), expectedVersion. 같은 키는 판 전체에서 한 타입.",
  "추가 필드는 허용하며 실제 유효성 검사는 연산 계층에서 합니다.",
].join(" ")

export const inputs = {
  board_search: z.strictObject({ q: z.string().optional(), kinds: z.array(kind).optional(), tags: strings.optional(), area: z.string().optional(), status: status.optional(), since: z.number().optional(), space: z.string().optional().describe("personal 또는 board_schema spaces 의 id. 할 일·목표·사건만 그 공간 것, 문서·대화는 개인"), parent:z.string().nullable().optional(), sort: z.union([z.enum(["relevance", "updated", "tree"]), z.string().regex(/^-?prop:.+$/)]).optional().describe("relevance | updated | tree(parent 필요) | prop:<키> | -prop:<키>"), drafts: z.enum(["include", "exclude", "only"]).optional(), props: z.array(z.strictObject({ key: z.string(), op: propOp, value: z.union([z.string(), z.number(), z.boolean()]).optional() })).max(20).optional().describe("속성 조건(AND). exists·missing 은 value 없이"), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().optional() }),
  board_fetch: z.strictObject({ ref, view: z.enum(["markdown", "outline", "meta", "section"]).optional(), section: z.string().optional(), maxChars: z.number().int().min(1).max(20000).optional(), offset: z.number().int().nonnegative().optional() }),
  board_related: z.strictObject({ ref, direction: z.enum(["out", "in", "both"]).optional(), depth: z.union([z.literal(1), z.literal(2)]).optional(), limit: z.number().int().positive().optional() }),
  board_schema: z.strictObject({}),
  board_act: z.strictObject({ actions: z.array(z.record(z.string(), z.unknown()).describe(actionDescription)).min(1).describe(actionDescription) }),
  board_write: z.strictObject({ ref, mode: z.enum(["append", "replace", "patch"]), md: z.string().optional(), edits: z.array(z.union([z.strictObject({ heading: z.string().optional(), op: z.enum(["append", "replace"]), md: z.string() }), z.strictObject({ oldStr: z.string(), newStr: z.string() })])).optional(), expectedVersion: z.number().int().optional(), idempotencyKey: z.string().optional(), onceKey: z.string().min(1).max(200).optional().describe("같은 (ref, 키)는 한 번만 적용해요(예: run:<실행 id>). 다시 오면 버전 검사 전에 applied 0·duplicate true") }),
  board_archive: z.strictObject({ ref, archived: z.boolean() }),
}

const goalProgress = z.object({ done: z.number(), total: z.number() })

export const outputs = {
  board_search: z.object({ results: z.array(z.object({ ref: z.string(), kind, title: z.string(), snippet: z.string(), tags: z.array(z.object({ tag: z.string(), by: tagBy })), personEdited: z.boolean(), area: z.string().nullable(), status, due: z.string().nullable(), props: z.array(docProp), updatedAt: z.number(), path: z.string().nullable(), excerpt: z.string().optional(), cover: z.string().nullable().optional(), progress: goalProgress.optional(),parent:z.string().nullable().optional(),children:z.number().int().nonnegative().optional(), space: z.string().optional() })), total: z.number(), nextCursor: z.string().optional(), hint: z.string().optional() }),
  board_fetch: z.object({ ref: z.string(), kind, title: z.string(), version: z.number(), frontmatter: z.record(z.string(), z.unknown()), markdown: z.string(), outline: z.array(z.object({ level: z.number(), title: z.string(), path: z.string() })).optional(), ancestors:z.array(z.object({ref:z.string(),title:z.string()})).optional(),truncated: z.boolean(), nextOffset: z.number().optional(), links: z.object({ out: z.number(), in: z.number() }) }),
  board_related: z.object({ edges: z.array(z.object({ label: z.string(), direction: z.enum(["out", "in"]), node: z.object({ ref: z.string(), kind, title: z.string(), status }) })), truncated: z.boolean() }),
  board_schema: z.object({ kinds: z.array(kind), statuses: z.array(status), areas: strings, tags: z.array(z.object({ tag: z.string(), count: z.number() })), props: z.array(z.object({ key: z.string(), type: propType, count: z.number(), options: strings.optional() })), linkLabels: strings, fields: strings, spaces: z.array(z.object({ id: z.string(), name: z.string() })).optional() }),
  board_act: z.object({ results: z.array(z.looseObject({ ok: z.boolean(), do: z.string(), ref: z.string().optional(), error: z.string().optional(), existing: z.boolean().optional() })), guidance: z.string().optional() }),
  board_write: z.object({ ref: z.string(), version: z.number(), applied: z.number(), suggested: z.boolean().optional(), warnings: strings, duplicate: z.boolean().optional() }),
  board_archive: z.object({ ref: z.string(), status }),
}

export const errorOutput = z.object({ error: z.string(), status: z.number().optional(), current: z.object({ version: z.number(), md: z.string(), truncated: z.boolean() }).optional(), guidance: z.string() })

export type ToolName = keyof typeof inputs
