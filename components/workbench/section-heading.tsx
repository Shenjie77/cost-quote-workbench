'use client';
import type { ReactNode } from 'react';
import { Surface, Text } from '@/components/ui/presentation';
import { useWorkbenchLanguage } from '@/features/workbench/workbench-language';
export function SectionHeading({
  index,
  title,
  titleZh,
  description,
  descriptionZh,
  action,
  variant = 'section',
}: {
  index?: string;
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  action?: ReactNode;
  variant?: 'page' | 'section';
}) {
  const { label } = useWorkbenchLanguage();
  return (
    <Surface variant={variant === 'page' ? 'page-heading' : 'header'}>
      <div className="min-w-0">
        <Text
          as={variant === 'page' ? 'h1' : 'h2'}
          title={[title, titleZh].filter(Boolean).join(' / ')}
        >
          {index && <span className="sr-only">{index} </span>}
          {label(title, titleZh)}
        </Text>
        {(description || descriptionZh) && (
          <Text as="p" tone="muted" textRole="body-small" className="mt-1">
            {label(description || '', descriptionZh)}
          </Text>
        )}
      </div>
      {action && (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {action}
        </div>
      )}
    </Surface>
  );
}
