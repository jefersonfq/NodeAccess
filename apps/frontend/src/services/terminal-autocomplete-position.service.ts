export interface TerminalAutocompleteAnchor {
  left: number
  top: number
  cellHeight: number
}

export interface TerminalAutocompletePositionInput {
  anchor: TerminalAutocompleteAnchor
  containerWidth: number
  containerHeight: number
  popupWidth: number
  popupHeight: number
  gap?: number
  edge?: number
}

export function positionTerminalAutocomplete(input: TerminalAutocompletePositionInput) {
  const gap = input.gap ?? 6
  const edge = input.edge ?? 8
  const width = Math.min(input.popupWidth, Math.max(0, input.containerWidth - edge * 2))
  const height = Math.min(input.popupHeight, Math.max(0, input.containerHeight - edge * 2))
  const maxLeft = Math.max(edge, input.containerWidth - width - edge)
  const left = Math.min(Math.max(edge, input.anchor.left), maxLeft)
  const above = input.anchor.top - height - gap
  const below = input.anchor.top + gap
  const top = above >= edge
    ? above
    : Math.min(Math.max(edge, below), Math.max(edge, input.containerHeight - height - edge))
  return { left, top, width, placement: above >= edge ? 'above' as const : 'below' as const }
}
