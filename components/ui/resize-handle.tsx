import type { ComponentProps } from 'react';
/** Pointer and keyboard handlers belong to the grid; every resize grip shares this appearance. */
export function ResizeHandle({
  axis = 'x',
  ...props
}: ComponentProps<'span'> & { axis?: 'x' | 'y' }) {
  return (
    <span
      {...props}
      data-slot="resize-handle"
      data-axis={axis}
      className="ui-resize-handle"
    />
  );
}
