import { createI18n } from 'vue-i18n'
import pt from '../locales/pt-BR.json'
import en from '../locales/en.json'
import { describe,it,expect,vi } from 'vitest'
import { MacroSchema, validateSnippetCommand, MACRO_PREFIX } from '@nodeaccess/shared'
import { deserializeSnippetCommand,serializeSnippetForm,toSnippetFormData,executionActions,snippetFormError,snippetCopyText,getSnippetExecutionSecretAliases } from './snippet.service'
vi.mock('./api', () => ({ default: {} }))
describe('versioned macros and legacy compatibility',()=>{
  it.each(['pwd','#!nodeaccess:sequence\n{"steps":["pwd","whoami"]}','#!nodeaccess:expect-send\n{"steps":[{"expect":"ready","send":"pwd"}]}'])('round-trips legacy %s', command=>{
    const snippet={...toSnippetFormData(),id:1,name:'test',command,description:null,scope:'PERSONAL' as const,groupId:null,group:null,createdAt:'',updatedAt:'',createdBy:{id:1,name:'test'}}
    expect(serializeSnippetForm(toSnippetFormData(snippet)).command).toBe(command)
    expect(executionActions(deserializeSnippetCommand(command)).length).toBeGreaterThan(0)
  })
  it('round-trips versioned actions and retains secrets as references',()=>{
    const form={...toSnippetFormData(),name:'macro',kind:'MACRO' as const,actions:MacroSchema.parse({version:1,steps:[{type:'send',text:'{{secret:operational}}',enter:true},{type:'wait',pattern:'ready',mode:'regex',caseSensitive:false,timeoutMs:1500}]}).steps}
    const dto=serializeSnippetForm(form)
    expect(dto.command.startsWith(MACRO_PREFIX)).toBe(true)
    expect(deserializeSnippetCommand(dto.command).actions).toEqual(form.actions)
    expect(getSnippetExecutionSecretAliases(deserializeSnippetCommand(dto.command))).toEqual(['operational'])
  })
  it('rejects incomplete legacy lines instead of dropping them on save',()=>{
    expect(snippetFormError({...toSnippetFormData(),name:'test',kind:'EXPECT_SEND',expectSendText:'ready => pwd\nbroken line'})).toBe('snippets.macro.invalidSteps')
  })
  it.each(['#!nodeaccess:future\n{}','#!nodeaccess:sequence\n{"steps":[]}','#!nodeaccess:expect-send\n{"steps":[{"expect":"","send":"pwd"}]}','#!nodeaccess:macro-v1\n{"version":2,"steps":[]}'])('rejects malformed/reserved payload %s',command=>{
    expect(validateSnippetCommand(command)).toBe(false)
    expect(deserializeSnippetCommand(command).invalid).toBe(true)
    expect(executionActions(deserializeSnippetCommand(command))).toEqual([])
  })
  it('does not alter secret placeholders when copying',()=>{
    expect(snippetCopyText({command:'echo {{secret:alias}}'} as never)).toBe('echo {{secret:alias}}')
  })
  it('rejects oversized macros and invalid action fields',()=>{
    expect(MacroSchema.safeParse({version:1,steps:Array.from({length:201},()=>({type:'send',text:'pwd',enter:true}))}).success).toBe(false)
    expect(MacroSchema.safeParse({version:1,steps:[{type:'wait',pattern:'x',mode:'regex',caseSensitive:false,timeoutMs:0}]}).success).toBe(false)
  })
})

describe('expect-send localized form',()=>{
  it.each(['pt-BR','en'])('renders the Vault placeholder without compiling it as interpolation: %s',locale=>{
    const i18n=createI18n({legacy:false,locale,messages:{'pt-BR':pt,en}})
    const text=i18n.global.t('snippets.expectSendPlaceholder',{secretReference:'{{secret:alias}}'})
    expect(text).toContain('Password: => {{secret:alias}}')
  })
})
