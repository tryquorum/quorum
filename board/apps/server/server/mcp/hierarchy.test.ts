import { expect, test } from 'bun:test'
import { inputs, outputs } from './schemas'

test('hierarchy schemas accept parent, tree order, children and ancestors', () => {
  expect(inputs.board_search.safeParse({parent:null,sort:'tree'}).success).toBe(true)
  expect(inputs.board_search.safeParse({parent:'doc:1',extra:true}).success).toBe(false)
  const result={results:[{ref:'doc:1',kind:'doc',title:'one',snippet:'',tags:[],personEdited:false,area:null,status:'open',due:null,props:[],updatedAt:1,path:null,parent:null,children:2}],total:1}
  expect(outputs.board_search.parse(result).results[0]).toMatchObject({parent:null,children:2})
  expect(outputs.board_fetch.parse({ref:'doc:2',kind:'doc',title:'two',version:1,frontmatter:{},markdown:'',truncated:false,links:{out:0,in:0},ancestors:[{ref:'doc:1',title:'one'}]})).toHaveProperty('ancestors')
})
