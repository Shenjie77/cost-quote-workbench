'use client';

import * as React from 'react';

import { FieldSurfaceProvider } from './field-surface';
import { attachColumnResizing } from '@/lib/table-column-widths';
import { cn } from '@/lib/utils';
import { layoutClassName } from '@/lib/ui-layout';

/** Wrap semantic data in a keyboard-scrollable grid without changing row behavior. */
function Table({
  className,
  containerClassName,
  ref,
  ...props
}: React.ComponentProps<'table'> & { containerClassName?: string }) {
  const tableRef = React.useRef<HTMLTableElement | null>(null);
  React.useEffect(() => {
    if (tableRef.current) return attachColumnResizing(tableRef.current);
  }, [props.children]);
  return (
    <FieldSurfaceProvider value="grid">
      <div
        data-slot="table-container"
        className={cn(
          'wb-table-scroll relative min-w-0 w-full focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2',
          layoutClassName(containerClassName),
        )}
        tabIndex={0}
        role="region"
        aria-label={props['aria-label'] || 'Scrollable data table'}
      >
        <table
          ref={(node) => {
            tableRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          data-slot="table"
          className={cn('ui-table', layoutClassName(className))}
          {...props}
        />
      </div>
    </FieldSurfaceProvider>
  );
}

/** Provide a shared shaded header for all financial and catalog grids. */
function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('ui-table-header', layoutClassName(className))}
      {...props}
    />
  );
}

/** Group data rows and avoid duplicating the enclosing bottom border. */
function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', layoutClassName(className))}
      {...props}
    />
  );
}

/** Separate totals from editable data rows. */
function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('ui-table-footer', layoutClassName(className))}
      {...props}
    />
  );
}

/** Highlight hover, selection, and expanded states without shifting cells. */
function TableRow({
  className,
  tone = 'normal',
  ...props
}: React.ComponentProps<'tr'> & {
  tone?:
    | 'normal'
    | 'section'
    | 'subtotal'
    | 'total'
    | 'header'
    | 'risk'
    | 'warning';
}) {
  return (
    <tr
      data-slot="table-row"
      data-tone={tone}
      className={cn('ui-table-row', layoutClassName(className))}
      {...props}
    />
  );
}

/** Label a column with the same visible grid line as data cells. */
function TableHead({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'th'> & {
  variant?: 'default' | 'numeric' | 'editable' | 'label';
}) {
  return (
    <th
      data-slot="table-head"
      data-variant={variant}
      scope="col"
      className={cn('ui-table-head', layoutClassName(className))}
      {...props}
    />
  );
}

/** Keep dense cells aligned and preserve caller-provided wrapping or numeric alignment. */
function TableCell({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'td'> & {
  variant?: 'default' | 'numeric' | 'editable' | 'label';
}) {
  return (
    <td
      data-slot="table-cell"
      data-variant={variant}
      className={cn('ui-table-cell', layoutClassName(className))}
      {...props}
    />
  );
}

/** Describe a table outside its data grid. */
function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn(
        'text-muted-foreground mt-4 text-body-main',
        layoutClassName(className),
      )}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
