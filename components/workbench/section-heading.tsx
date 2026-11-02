import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Surface, Text } from '@/components/ui/presentation';

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
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  action?: ReactNode;
}) {
  return (
    <Surface variant="header">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {index ? <Badge>{index}</Badge> : null}
          <Text as="h2">{title}</Text>
          {titleZh ? (
            <Text tone="muted" textRole="body-small">
              {titleZh}
            </Text>
          ) : null}
        </div>
        {description || descriptionZh ? (
          <Text as="p" tone="muted" textRole="body-small" className="mt-1">
            {description}
            {descriptionZh ? (
              <Text className={description ? 'ml-2' : undefined}>
                {descriptionZh}
              </Text>
            ) : null}
          </Text>
        ) : null}
      </div>
      {action ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {action}
        </div>
      ) : null}
    </Surface>
  );
}
