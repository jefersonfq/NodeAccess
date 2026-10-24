import {describe,it,expect} from 'vitest'
import {exportSnippets,parseSnippetImport} from './snippet-transfer'
describe('portable snippet files',()=>{
  it('exports only portable fields and preserves Vault references',()=>{
    const text=exportSnippets([{id:7,name:'test',command:'echo {{secret:alias}}',description:null,scope:'TEAM',groupId:3,createdBy:{id:99,name:'private'}} as never])
    const parsed=JSON.parse(text) as { snippets: Array<Record<string, unknown>> }
    expect(Object.keys(parsed.snippets[0]).sort()).toEqual(['command','description','name'])
    expect(parseSnippetImport(text)[0]?.command).toBe('echo {{secret:alias}}')
  })
  it.each(['{}','not json',JSON.stringify({format:'nodeaccess-snippets',version:2,snippets:[]}),JSON.stringify({format:'nodeaccess-snippets',version:1,snippets:[{name:'test',command:'#!nodeaccess:macro-v1\n{}',description:null}]})])('rejects invalid files %s',text=>{
    expect(()=>parseSnippetImport(text)).toThrow()
  })
  it('validates entire batch before import and limits size',()=>{
    expect(()=>parseSnippetImport(JSON.stringify({format:'nodeaccess-snippets',version:1,snippets:[{name:'ok',command:'pwd',description:null},{name:'',command:'pwd',description:null}]}))).toThrow()
    expect(()=>parseSnippetImport(' '.repeat(2000001))).toThrow()
  })
})
