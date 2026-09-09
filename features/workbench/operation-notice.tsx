'use client';

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
    <output
      aria-live="polite"
      aria-atomic="true"
      className="fixed right-4 bottom-4 z-[70] flex w-fit max-w-[min(440px,calc(100vw-32px))] items-start gap-3 rounded-lg border border-[#9eb9ba] bg-[#173a52] px-4 py-3 text-xs text-white shadow-xl"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#b9d7d5]" />
      <span className="min-w-0 whitespace-pre-wrap break-words">{message}</span>
      <button
        type="button"
        aria-label="Close notice"
        onClick={onDismiss}
        className="mt-0.5 shrink-0 text-[#b9c9d0] hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </output>
  );
}
