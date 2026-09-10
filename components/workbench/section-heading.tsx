/** Consistent bilingual heading for bordered workbench sections. */

import type React from 'react';

export function SectionHeading({
  index,
  title,
  titleZh,
  description,
  descriptionZh,
  action,
}: {
  index?: string;
  title: string;
  titleZh: string;
  description?: string;
  descriptionZh?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2">
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {index ? (
            <span className="financial-numeral inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-accent px-1.5 text-[10px] font-semibold text-accent-foreground">
              {index}
            </span>
          ) : null}
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <span className="text-[11px] font-normal text-muted-foreground">
            {titleZh}
          </span>
        </div>
        {description || descriptionZh ? (
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {description}
            {descriptionZh ? (
              <span className={description ? 'ml-2 text-[10px]' : ''}>
                {descriptionZh}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}
