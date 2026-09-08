/** Freeze version navigation while its source document is durably flushed. */
export async function runVersionTransition(options: {
  busy: { current: boolean };
  setBusy: (busy: boolean) => void;
  flushAndPause: () => Promise<number | null>;
  resume: () => void;
  commit: (revision: number) => void | Promise<void>;
  onFailure: (error?: unknown) => void;
}): Promise<boolean> {
  if (options.busy.current) return false;
  options.busy.current = true;
  options.setBusy(true);
  try {
    const revision = await options.flushAndPause();
    if (revision === null) {
      options.onFailure();
      return false;
    }
    await options.commit(revision);
    return true;
  } catch (error) {
    options.onFailure(error);
    return false;
  } finally {
    options.resume();
    options.busy.current = false;
    options.setBusy(false);
  }
}
