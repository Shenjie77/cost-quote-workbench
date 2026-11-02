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
  return (
    <Text>
      {en}
      <Text className="ml-1" textRole="body-small" tone="inherit">
        / {zh}
      </Text>
    </Text>
  );
}
