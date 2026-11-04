'use client';
import { useWorkbenchLanguage } from '@/features/workbench/workbench-language';
/** Labels inherit selected-row contrast; helper text uses the same role everywhere. */
import { Text, type Tone } from '@/components/ui/presentation';
export function BiText({
  en,
  zh,
  className,
  zhTone = 'muted',
}: {
  en: string;
  zh: string;
  className?: string;
  zhTone?: Tone;
}) {
  const { label, enabled } = useWorkbenchLanguage();
  if (enabled)
    return (
      <Text className={className} title={`${en} / ${zh}`}>
        {label(en, zh)}
      </Text>
    );
  return (
    <Text className={`flex min-w-0 flex-col ${className || ''}`}>
      <span>{en}</span>
      <Text className="mt-1" textRole="body-small" tone={zhTone}>
        {zh}
      </Text>
    </Text>
  );
}
export function BiInline({ en, zh }: { en: string; zh: string }) {
  const { label, enabled } = useWorkbenchLanguage();
  if (enabled) return <Text title={`${en} / ${zh}`}>{label(en, zh)}</Text>;
  return (
    <Text>
      {en}
      <Text className="ml-1" textRole="body-small" tone="inherit">
        / {zh}
      </Text>
    </Text>
  );
}
