import { expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DocRecord } from '@direction-board/contracts/docs'
import { createVaultSink } from './index'

const doc:DocRecord={owner:'alice',ref:'doc:1',kind:'doc',title:'문서',area:null,status:'open',source:null,tags:[],links:[],props:[],due:null,md:'본문',version:1,personEdited:false,createdAt:1,updatedAt:2}
test('hierarchy mirror uses parent folders and preserves legacy reserved properties', async () => {
  const root=await mkdtemp('/tmp/hierarchy-vault-'), sink=createVaultSink(root)
  const parent=await sink.upsert({...doc,ref:'doc:parent',title:'Parent'})
  const folder=parent.path.slice('문서/'.length,-3)
  const child=await sink.upsert({...doc,ref:'doc:child',parent:'doc:parent',folders:[folder],props:[{key:'parent',type:'text',value:'old'},{key:'Parent',type:'text',value:'older'}]})
  expect(child.path.startsWith(`문서/${folder}/`)).toBe(true)
  const text=await readFile(join(root,child.path),'utf8')
  const front=Bun.YAML.parse(text.split('---')[1]) as Record<string,unknown>
  expect(front).toMatchObject({parent:'doc:parent','parent (속성)':'old','Parent (속성)':'older'})
  await createVaultSink(root).upsert({...doc,ref:'doc:child',parent:'doc:parent',folders:[folder]})
})

test('mirror caps folders and rejects an overlong absolute root before writing', async () => {
  const root=await mkdtemp('/tmp/hierarchy-vault-'), sink=createVaultSink(root)
  const folders=['a','b','c','d','e']
  const {path}=await sink.upsert({...doc,folders})
  expect(path.split('/').slice(1,-1)).toEqual(folders.slice(0,4))
  const longFolders=['a','b','c','d'].map(c=>c.repeat(240))
  const shortened=await sink.upsert({...doc,ref:'doc:long',folders:longFolders})
  expect(shortened.path.split('/').slice(1,-1)).toEqual(longFolders.slice(0,3))
  const longRoot='/tmp/'+('x'.repeat(1000))
  await expect(createVaultSink(longRoot).upsert(doc)).rejects.toThrow('1000 bytes')
})
