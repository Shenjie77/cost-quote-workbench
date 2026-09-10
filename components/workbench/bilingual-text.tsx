/** Compact English-first labels with subordinate Chinese helper text. */

export function BiText({
  en,
  zh,
  className = '',
  zhClassName = '',
}: {
  en: string;
  zh: string;
  className?: string;
  zhClassName?: string;
}) {
  return (
    <span className={'flex min-w-0 flex-col ' + className}>
      <span>{en}</span>
      <span
        className={
          'mt-0.5 text-[10px] font-normal leading-4 text-muted-foreground ' +
          zhClassName
        }
      >
        {zh}
      </span>
    </span>
  );
}

export function BiInline({ en, zh }: { en: string; zh: string }) {
  return (
    <span>
      {en}
      <span className="ml-1 text-[10px] font-normal opacity-70">/ {zh}</span>
    </span>
  );
}
