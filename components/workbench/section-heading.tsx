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
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <div className="flex items-baseline gap-2">
          {index ? (
            <span className="financial-numeral text-[11px] font-semibold text-[#a86432]">
              {index}
            </span>
          ) : null}
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          <span className="text-[10px] text-muted-foreground">{titleZh}</span>
        </div>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
        {descriptionZh ? (
          <p className="text-[9px] leading-4 text-muted-foreground">
            {descriptionZh}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
