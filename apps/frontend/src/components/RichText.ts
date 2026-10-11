import { computed, defineComponent, h, type PropType, type VNode, type VNodeChild } from 'vue'

// Only the semantic markup used by repository manual pages and localized guides.
const tags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'b', 'strong', 'em', 'i', 's', 'del', 'code', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'blockquote', 'br', 'hr', 'a', 'span', 'div', 'kbd'])

function safeHref(value: string): string | undefined {
  const href = value.trim()
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return undefined
  try {
    const url = new URL(href, 'https://nodeaccess.invalid/')
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : undefined
  } catch {
    return undefined
  }
}

function renderNode(node: Node): VNodeChild {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof Element)) return null
  const tag = node.localName.toLowerCase()
  if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !tags.has(tag)) return null
  const props: Record<string, string> = {}
  for (const attribute of ['id', 'title']) {
    const value = node.getAttribute(attribute)
    if (value !== null) props[attribute] = value
  }
  if (tag === 'a') {
    const href = safeHref(node.getAttribute('href') ?? '')
    if (href !== undefined) props.href = href
    if (node.getAttribute('target') === '_blank') {
      props.target = '_blank'
      props.rel = 'noopener noreferrer'
    }
  }
  if (tag === 'th' || tag === 'td') {
    for (const attribute of ['colspan', 'rowspan']) {
      const value = node.getAttribute(attribute)
      if (value && /^\d{1,3}$/.test(value)) props[attribute] = value
    }
    const scope = node.getAttribute('scope')
    if (scope && ['row', 'col', 'rowgroup', 'colgroup'].includes(scope)) props.scope = scope
  }
  return h(tag, props, Array.from(node.childNodes, renderNode))
}

export function richTextChildren(html: string): VNodeChild[] {
  // SSR/limited environments show escaped source instead of accepting raw markup.
  if (typeof DOMParser === 'undefined') return [html]
  const document = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(document.body.childNodes, renderNode)
}

export default defineComponent({
  name: 'RichText',
  props: {
    html: { type: String, required: true },
    tag: { type: String as PropType<'span' | 'article'>, default: 'span' },
  },
  setup(props): () => VNode {
    const children = computed(() => richTextChildren(props.html))
    return (): VNode => h(props.tag === 'article' ? 'article' : 'span', {}, children.value)
  },
})
