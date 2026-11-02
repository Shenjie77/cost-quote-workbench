/** Shared controls own appearance. Call sites may only arrange geometry and alignment. */
export function layoutClassName(value?: unknown): string {
  return (typeof value === 'string' ? value : '')
    .split(/\s+/)
    .filter((token) => {
      const base = token.split(':').at(-1) ?? '';
      return /^(?:!?-?(?:w-|min-w-|max-w-|h-|min-h-|max-h-|size-|m[trblxyse]?-|gap(?:-[xy])?-|space-[xy]-|grid(?:-|$)|col-|row-|flex(?:-|$)|basis-|grow|shrink|order-|items-|justify-|self-|place-|content-|overflow-|overscroll-|top-|bottom-|left-|right-|inset-|z-|translate-|table-|whitespace-|break-|text-(?:left|right|center|start|end)|align-|truncate$|sr-only$|not-sr-only$|hidden$|block$|inline|absolute$|relative$|fixed$|sticky$|static$|isolate$|pointer-events-|resize|select-|group$|calculation-page-editor$|financial-numeral$))/.test(
        base,
      );
    })
    .join(' ');
}

/** Inputs must fit resized grid columns; their height and minimum width belong to the control contract. */
export function fieldLayoutClassName(value?: unknown): string {
  return layoutClassName(value)
    .split(/\s+/)
    .filter(
      (token) =>
        !/^(?:min-w-|h-|min-h-|size-)/.test(token.split(':').at(-1) ?? ''),
    )
    .join(' ');
}

/** Atomic control geometry cannot override its internal size or state contract. */
export function controlLayoutClassName(value?: unknown): string {
  return fieldLayoutClassName(value)
    .split(/\s+/)
    .filter((token) => !/^(?:gap|space-)/.test(token.split(':').at(-1) ?? ''))
    .join(' ');
}
