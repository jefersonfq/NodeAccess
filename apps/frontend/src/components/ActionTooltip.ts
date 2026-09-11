import { cloneVNode, defineComponent, h, ref } from 'vue'
import { NTooltip } from 'naive-ui'

// Keep the trigger DOM and listeners; dismiss on activation until pointer exit.
export default defineComponent({
  name: 'ActionTooltip',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const visible = ref(false)
    const dismissed = ref(false)
    const dismiss = () => { dismissed.value = true; visible.value = false }
    const leave = () => { dismissed.value = false; visible.value = false }
    return () => h(NTooltip, {
      ...attrs,
      show: !dismissed.value && visible.value,
      'onUpdate:show': (show: boolean) => { visible.value = show },
    }, {
      ...slots,
      trigger: () => slots.trigger?.().map(node => cloneVNode(node, {
        onPointerdownCapture: dismiss,
        onClickCapture: dismiss,
        onMouseleave: leave,
        onBlurCapture: leave,
        onKeydownCapture: (event: KeyboardEvent) => {
          if (['Enter', ' ', 'Escape'].includes(event.key)) dismiss()
        },
      })),
    })
  },
})
