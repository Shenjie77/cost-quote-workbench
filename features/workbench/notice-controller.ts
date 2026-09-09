/** Latest-operation notice: every announcement, including repeated text, gets a fresh timer. */
export const NOTICE_DURATION_MS = 3000;

export function createNoticeController(onChange: (message: string) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const cancel = () => {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    announce: (message: string) => {
      cancel();
      onChange(message);
      if (!message) return;
      const current = generation;
      timer = setTimeout(() => {
        if (generation !== current) return;
        timer = undefined;
        onChange('');
      }, NOTICE_DURATION_MS);
    },
    dispose: cancel,
  };
}
