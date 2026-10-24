vi.mock('@/services/api',()=>({default:{}}))
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRenderer, h, reactive, ref, nextTick } from 'vue'
import { useSnippetDraft } from './useSnippetDraft'
import { toSnippetFormData } from '@/services/snippet.service'
const auth = reactive({user:{id:700,tenantId:1}})
vi.mock('@/stores/auth',()=>({useAuthStore:()=>auth}))
const renderer = createRenderer({
  createElement:()=>({}), createText:()=>({}), createComment:()=>({}), insert:()=>{},
  remove:()=>{}, setText:()=>{}, setElementText:()=>{}, parentNode:()=>null,
  nextSibling:()=>null, patchProp:()=>{},
})
function mount() {
  let state!: ReturnType<typeof useSnippetDraft> & { form: ReturnType<typeof ref<ReturnType<typeof toSnippetFormData>>>; open: ReturnType<typeof ref<boolean>>; editId: ReturnType<typeof ref<number | null>> }
  const app = renderer.createApp({setup(){
    const form=ref(toSnippetFormData()),open=ref(false),editId=ref<number|null>(null)
    const guard=useSnippetDraft(form,open,editId,'test',()=> 'Discard?')
    state={form,open,editId,...guard}
    return ()=>h('div')
  }})
  app.mount({})
  return {state,app}
}
afterEach(()=>vi.unstubAllGlobals())
describe('transient snippet drafts',()=>{
  it('protects reload and restores an unmounted panel without storage writes',()=>{
    const target = new EventTarget()
    Object.assign(target,{confirm:vi.fn(()=>false)})
    vi.stubGlobal('window',target)
    const first=mount()
    first.state.open.value=true
    first.state.form.value.name='Unsaved'
    const event=new Event('beforeunload',{cancelable:true})
    Object.defineProperty(event,'returnValue',{value:'',writable:true})
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(first.state.canDiscard()).toBe(false)
    first.app.unmount()
    const second=mount()
    expect(second.state.restored.value).toBe(true)
    expect(second.state.form.value.name).toBe('Unsaved')
    second.state.open.value=false
    second.app.unmount()
    const third=mount()
    expect(third.state.open.value).toBe(false)
    third.app.unmount()
  })
  it('does not restore an explicitly discarded draft', () => {
    vi.stubGlobal('window',Object.assign(new EventTarget(),{confirm:()=>true}))
    const first=mount()
    first.state.open.value=true
    first.state.form.value.name='Discarded'
    expect(first.state.canDiscard()).toBe(true)
    first.app.unmount()
    const next=mount()
    expect(next.state.open.value).toBe(false)
    next.app.unmount()
  })
  it('isolates tenants and clears the old context',async()=>{
    vi.stubGlobal('window',Object.assign(new EventTarget(),{confirm:()=>true}))
    const first=mount()
    first.state.open.value=true
    first.state.form.value.name='Tenant one'
    auth.user={id:700,tenantId:2};await nextTick()
    expect(first.state.open.value).toBe(false)
    first.app.unmount()
    const second=mount()
    expect(second.state.open.value).toBe(false)
    second.app.unmount()
  })
})
