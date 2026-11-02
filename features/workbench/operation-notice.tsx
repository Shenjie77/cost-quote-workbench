'use client';

import { Surface, Text } from '@/components/ui/presentation';
import { Button } from '@/components/ui/button';
import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { createNoticeController } from './notice-controller';

export function useOperationNotice() {
  const [notice, setNotice] = useState('');
  const controller = useMemo(() => createNoticeController(setNotice), []);
  useEffect(() => () => controller.dispose(), [controller]);
  return [notice, controller.announce] as const;
}

export function OperationNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <Surface
      aria-live="polite"
      aria-atomic="true"
      as="output"
      variant="panel"
      padded
      tone="inverse"
      textRole="body-small"
      className="fixed right-4 bottom-4 z-[70] flex w-fit max-w-[min(440px,calc(100vw-32px))] items-start gap-3"
    >
      <Text
        aria-hidden="true"
        as={CircleAlert}
        tone="inverse"
        className="mt-1 size-4 shrink-0"
      />
      <span className="min-w-0 whitespace-pre-wrap break-words">{message}</span>
      <Button
        variant="ghost"
        type="button"
        aria-label="Close notice"
        onClick={onDismiss}
        className="shrink-0"
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </Surface>
  );
}
