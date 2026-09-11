/** Latest-intent coordination for workflow pages whose save and load stages are asynchronous. */

export type NavigationIntent = { isCurrent: () => boolean };

/** Makes explicit navigation invalidate older requests without aborting durable saves. */
export function createNavigationIntents() {
  let generation = 0;
  return {
    cancel() {
      generation += 1;
    },
    begin(): NavigationIntent {
      const current = ++generation;
      return { isCurrent: () => current === generation };
    },
  };
}

/** Loads one workflow only while its original navigation intent remains current. */
export async function loadWorkflowNavigation<T>({
  intent,
  saveCurrent,
  load,
  select,
}: {
  intent: NavigationIntent;
  saveCurrent?: () => Promise<boolean>;
  load: () => Promise<T | null>;
  select: () => Promise<boolean>;
}): Promise<T | null> {
  try {
    if (!intent.isCurrent()) return null;
    if (saveCurrent) {
      const saved = await saveCurrent();
      if (!intent.isCurrent()) return null;
      if (!saved)
        throw new Error(
          'Save the current cost edits or resolve their conflict first.',
        );
    }
    const record = await load();
    if (!intent.isCurrent()) return null;
    if (!record)
      throw new Error(
        'This project no longer exists. Refresh the project list.',
      );
    // Project selection owns the existing outgoing-business-save guard.
    const selected = await select();
    if (!intent.isCurrent()) return null;
    if (!selected)
      throw new Error(
        'Project switch cancelled. Resolve the current save or export first.',
      );
    return record;
  } catch (error) {
    // An abandoned page must not report errors or route changes over the newer page.
    if (!intent.isCurrent()) return null;
    throw error;
  }
}

/** Initial hydration errors need an actionable retry instead of an indefinite loading label. */
export function workflowRestoreFeedback(
  ready: boolean,
  phase: string,
  message: string,
) {
  return !ready && ['offline', 'error', 'conflict'].includes(phase)
    ? { failed: true, message }
    : {
        failed: false,
        message: 'Loading project workflow / 正在加载项目流程…',
      };
}
