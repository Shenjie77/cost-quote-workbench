'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/** Wrap semantic data in a keyboard-scrollable grid without changing row behavior. */
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<'table'> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        'wb-table-scroll relative min-w-0 w-full focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2',
        containerClassName,
      )}
      tabIndex={0}
      role="region"
      aria-label={props['aria-label'] || 'Scrollable data table'}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-[13px]', className)}
        {...props}
      />
    </div>
  );
}

/** Provide a shared shaded header for all financial and catalog grids. */
function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('bg-muted [&_tr]:border-b [&_tr]:border-grid', className)}
      {...props}
    />
  );
}

/** Group data rows and avoid duplicating the enclosing bottom border. */
function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

/** Separate totals from editable data rows. */
function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

/** Highlight hover, selection, and expanded states without shifting cells. */
function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-accent/35 data-[state=selected]:bg-accent border-b transition-colors border-grid has-aria-expanded:bg-muted/50',
        className,
      )}
      {...props}
    />
  );
}

/** Label a column with the same visible grid line as data cells. */
function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        'border-r border-grid last:border-r-0 text-muted-foreground h-8 px-3 text-left align-middle text-xs font-semibold whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

/** Keep dense cells aligned and preserve caller-provided wrapping or numeric alignment. */
function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'border-r border-grid last:border-r-0 px-3 py-1.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
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
      className={cn('text-muted-foreground mt-4 text-sm', className)}
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
