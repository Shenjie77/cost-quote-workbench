/** UI boundary: a Draft DRB request asks for explicit cost confirmation first. */
import { latestResult, recordSubmission, type SsrWorkspace } from './domain';
import type { CostVersionSnapshot } from '../cost/domain';
export type ReviewSubmissionInput = Parameters<typeof recordSubmission>[2];
export function submitReviewFromView(options: {
  value: SsrWorkspace;
  baseline: CostVersionSnapshot;
  input: ReviewSubmissionInput;
  onChange: (value: SsrWorkspace) => void;
  onRequestConfirmCost: (input: ReviewSubmissionInput) => void;
  announce: (message: string) => void;
}) {
  if (options.input.kind === 'DRB' && options.baseline.state !== 'Confirmed') {
    options.onRequestConfirmCost({ ...options.input });
    return;
  }
  try {
    options.onChange(
      recordSubmission(options.value, options.baseline, options.input),
    );
    options.announce('已保存送审快照');
  } catch (error) {
    options.announce(error instanceof Error ? error.message : String(error));
  }
}

/** Defer actual DRB approval/closure until its own cost version is confirmed. */
export function applySsrEditFromView(options: {
  previous: SsrWorkspace;
  next: SsrWorkspace;
  versions: CostVersionSnapshot[];
  onChange: (value: SsrWorkspace) => void;
  onRequestConfirmCost: (code: string, value: SsrWorkspace) => void;
}): boolean {
  for (const old of options.previous.submissions) {
    const current = options.next.submissions.find((item) => item.id === old.id);
    if (
      old.kind === 'DRB' &&
      current &&
      (current.results.length > old.results.length ||
        current.closures.length > old.closures.length) &&
      ['approved', 'conditional'].includes(
        latestResult(current)?.outcome || '',
      ) &&
      options.versions.find((version) => version.code === old.costBaseline.code)
        ?.state !== 'Confirmed'
    ) {
      options.onRequestConfirmCost(old.costBaseline.code, options.next);
      return false;
    }
  }
  options.onChange(options.next);
  return true;
}
