/** Local mirrors of SSR review evidence. Company approvals are never inferred. */
import type { CostVersionSnapshot } from '../cost/domain.ts';
import { contentKey, costBaselineKey } from '../cpq/domain.ts';
export type ReviewKind =
  | 'DTRB'
  | 'DRB'
  | 'BUDGET'
  | 'SPECIALIST'
  | 'QUOTE_DECISION'
  | 'BID_REVIEW';
export type ReviewResult = {
  id: string;
  outcome: 'approved' | 'rejected' | 'conditional' | 'withdrawn';
  evidence: string;
  recordedAt: string;
  conditions: string[];
};
export type ConditionClosure = {
  resultId: string;
  condition: string;
  evidence: string;
  recordedAt: string;
};
export type SsrSubmission = {
  id: string;
  kind: ReviewKind;
  domain: string;
  owner: string;
  dueDate: string;
  applicationNumber: string;
  evidence: string;
  createdAt: string;
  scopeBasis: string;
  dependencies: string[];
  dependencyResults: Record<string, string>;
  costBaseline: CostVersionSnapshot;
  costKey: string;
  results: ReviewResult[];
  closures: ConditionClosure[];
  followUps: {
    id: string;
    note: string;
    nextDate: string;
    recordedAt: string;
  }[];
  bidKey: string;
  commercialKey: string;
};
export type BidResponse = {
  id: string;
  clause: string;
  requirement: string;
  domain: string;
  response: string;
  deviation: string;
  owner: string;
  dueDate: string;
};
export type SsrWorkspace = {
  commercialBasis: string;
  enabled: boolean;
  proposalNumber: string;
  companyUrl: string;
  scopeBrief: string;
  technicalBasis: string;
  mode: 'service' | 'tender';
  requiredDomains: string[];
  submissions: SsrSubmission[];
  bidResponses: BidResponse[];
};
export const emptySsr = (): SsrWorkspace => ({
  commercialBasis: '',
  enabled: false,
  proposalNumber: '',
  companyUrl: '',
  scopeBrief: '',
  technicalBasis: '',
  mode: 'service',
  requiredDomains: [],
  submissions: [],
  bidResponses: [],
});
export const REVIEW_KINDS: ReviewKind[] = [
  'DTRB',
  'DRB',
  'BUDGET',
  'SPECIALIST',
  'QUOTE_DECISION',
  'BID_REVIEW',
];
export const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const scopeBasisKey = (ssr: SsrWorkspace) =>
  contentKey({
    brief: ssr.scopeBrief,
    technicalBasis: ssr.technicalBasis,
    proposalNumber: ssr.proposalNumber,
  });
export const bidResponseKey = (ssr: SsrWorkspace) =>
  contentKey({
    domains: [...ssr.requiredDomains].sort(),
    responses: ssr.bidResponses
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
export const latestResult = (submission: SsrSubmission) =>
  submission.results.at(-1);
export const openConditions = (submission: SsrSubmission) =>
  (latestResult(submission)?.conditions || []).filter(
    (c) =>
      !submission.closures.some(
        (x) => x.resultId === latestResult(submission)?.id && x.condition === c,
      ),
  );
export const isApproved = (submission: SsrSubmission) =>
  ['approved', 'conditional'].includes(
    latestResult(submission)?.outcome || '',
  ) && openConditions(submission).length === 0;
export function isStale(
  ssr: SsrWorkspace,
  submission: SsrSubmission,
  baseline: CostVersionSnapshot,
  visited = new Set<string>(),
): boolean {
  if (visited.has(submission.id)) return true;
  const seen = new Set(visited).add(submission.id);
  if (
    submission.costBaseline.code !== baseline.code ||
    submission.scopeBasis !== scopeBasisKey(ssr) ||
    (submission.kind !== 'DTRB' &&
      submission.costKey !== costBaselineKey(baseline)) ||
    (submission.kind === 'BID_REVIEW' &&
      submission.bidKey !== bidResponseKey(ssr))
  )
    return true;
  if (submission.kind === 'QUOTE_DECISION') {
    if (submission.commercialKey !== ssr.commercialBasis) return true;
    const domains = submission.dependencies
      .map((id) => ssr.submissions.find((s) => s.id === id))
      .filter((s) => s?.kind === 'SPECIALIST')
      .map((s) => s!.domain)
      .sort();
    if (contentKey(domains) !== contentKey([...ssr.requiredDomains].sort()))
      return true;
    if (
      ssr.mode === 'tender' &&
      !submission.dependencies.some(
        (id) => ssr.submissions.find((s) => s.id === id)?.kind === 'BID_REVIEW',
      )
    )
      return true;
  }
  return submission.dependencies.some((id) => {
    const dep = ssr.submissions.find((s) => s.id === id);
    if (
      !dep ||
      latest(ssr, dep.kind, dep.domain, baseline.code)?.id !== id ||
      isStale(ssr, dep, baseline, seen)
    )
      return true;
    if (submission.kind === 'SPECIALIST' && dep.kind === 'BUDGET')
      return ['rejected', 'withdrawn'].includes(
        latestResult(dep)?.outcome || '',
      );
    return (
      !isApproved(dep) ||
      submission.dependencyResults[id] !== latestResult(dep)?.id
    );
  });
}
export const latest = (
  ssr: SsrWorkspace,
  kind: ReviewKind,
  domain: string,
  version: string,
) =>
  ssr.submissions
    .filter(
      (s) =>
        s.kind === kind &&
        s.domain === domain &&
        s.costBaseline.code === version,
    )
    .at(-1);
/** Returns concrete missing prerequisites without changing any current project state. */
export function submissionDependencies(
  ssr: SsrWorkspace,
  kind: ReviewKind,
  domain: string,
  baseline: CostVersionSnapshot,
) {
  if (!ssr.enabled || !ssr.proposalNumber.trim() || !ssr.scopeBrief.trim())
    throw new TypeError(
      'Enable SSR and record proposal number and brief / 请启用SSR并填写proposal和简述',
    );
  if (
    kind !== 'DTRB' &&
    kind !== 'BID_REVIEW' &&
    baseline.state !== 'Confirmed'
  )
    throw new TypeError(
      `请先确认成本 ${baseline.code} (Confirmed)，再进入 ${kind}；Draft 保持在 DTRB。`,
    );
  const dependencies: string[] = [];
  const requireGate = (k: ReviewKind, d = '', mustApprove = true) => {
    const s = latest(ssr, k, d, baseline.code);
    if (
      !s ||
      isStale(ssr, s, baseline) ||
      (mustApprove && !isApproved(s)) ||
      (!mustApprove &&
        ['rejected', 'withdrawn'].includes(latestResult(s)?.outcome || ''))
    )
      throw new TypeError(
        `${k}${d ? ' / ' + d : ''} result is missing, stale or has open conditions / 前置评审未通过、过期或条件未关闭`,
      );
    dependencies.push(s.id);
  };
  if (kind === 'DRB') requireGate('DTRB');
  if (kind === 'BUDGET') requireGate('DRB');
  if (kind === 'SPECIALIST') {
    if (!domain.trim() || !ssr.requiredDomains.includes(domain))
      throw new TypeError('Select a configured specialist domain');
    requireGate('BUDGET', '', false);
  }
  if (kind === 'QUOTE_DECISION') {
    if (!ssr.requiredDomains.length)
      throw new TypeError('请配置需要进行专业评审的领域');
    requireGate('BUDGET');
    for (const d of ssr.requiredDomains) requireGate('SPECIALIST', d);
    if (ssr.mode === 'tender') requireGate('BID_REVIEW');
  }
  if (kind === 'BID_REVIEW') {
    if (
      ssr.mode !== 'tender' ||
      !ssr.bidResponses.length ||
      ssr.requiredDomains.some(
        (d) => !ssr.bidResponses.some((r) => r.domain === d),
      ) ||
      ssr.bidResponses.some(
        (r) =>
          !r.requirement.trim() ||
          !r.response.trim() ||
          !r.domain.trim() ||
          !r.owner.trim(),
      )
    )
      throw new TypeError(
        'Complete the tender response matrix first / 请先完成各专业标书答复',
      );
  }
  return dependencies;
}
export function recordSubmission(
  ssr: SsrWorkspace,
  baseline: CostVersionSnapshot,
  input: {
    kind: ReviewKind;
    domain: string;
    owner: string;
    dueDate: string;
    applicationNumber: string;
    evidence: string;
  },
): SsrWorkspace {
  if (
    !REVIEW_KINDS.includes(input.kind) ||
    !input.owner.trim() ||
    !input.applicationNumber.trim() ||
    !input.evidence.trim() ||
    !validDate(input.dueDate)
  )
    throw new TypeError(
      'Kind, owner, real due date, application number and evidence are required',
    );
  const domain = input.kind === 'SPECIALIST' ? input.domain : '';
  const dependencies = submissionDependencies(
    ssr,
    input.kind,
    domain,
    baseline,
  );
  const item: SsrSubmission = {
    ...input,
    domain,
    id: `submission-${globalThis.crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    scopeBasis: scopeBasisKey(ssr),
    dependencies,
    dependencyResults: Object.fromEntries(
      dependencies.map((id) => [
        id,
        latestResult(ssr.submissions.find((s) => s.id === id)!)?.id || '',
      ]),
    ),
    costBaseline: structuredClone(baseline),
    costKey: costBaselineKey(baseline),
    results: [],
    closures: [],
    followUps: [],
    commercialKey: input.kind === 'QUOTE_DECISION' ? ssr.commercialBasis : '',
    bidKey: input.kind === 'BID_REVIEW' ? bidResponseKey(ssr) : '',
  };
  return { ...ssr, submissions: [...ssr.submissions, item] };
}
export function recordReviewResult(
  ssr: SsrWorkspace,
  id: string,
  input: {
    outcome: ReviewResult['outcome'];
    evidence: string;
    conditions: string[];
  },
): SsrWorkspace {
  if (!ssr.submissions.some((s) => s.id === id))
    throw new TypeError('Submission not found');
  if (
    !input.evidence.trim() ||
    !['approved', 'rejected', 'conditional', 'withdrawn'].includes(
      input.outcome,
    )
  )
    throw new TypeError('Record the actual result and evidence');
  const conditions = [
    ...new Set(input.conditions.map((s) => s.trim()).filter(Boolean)),
  ];
  if (input.outcome === 'conditional' && !conditions.length)
    throw new TypeError('List the conditions of conditional approval');
  if (input.outcome !== 'conditional' && conditions.length)
    throw new TypeError('Only conditional approval can contain conditions');
  return {
    ...ssr,
    submissions: ssr.submissions.map((s) =>
      s.id !== id
        ? s
        : {
            ...s,
            results: [
              ...s.results,
              {
                ...input,
                conditions,
                id: `result-${globalThis.crypto.randomUUID()}`,
                recordedAt: new Date().toISOString(),
              },
            ],
          },
    ),
  };
}
export function closeCondition(
  ssr: SsrWorkspace,
  id: string,
  condition: string,
  evidence: string,
): SsrWorkspace {
  const source = ssr.submissions.find((s) => s.id === id);
  if (
    !source ||
    !openConditions(source).includes(condition) ||
    !evidence.trim()
  )
    throw new TypeError('Select an open condition and record closure evidence');
  return {
    ...ssr,
    submissions: ssr.submissions.map((s) =>
      s.id !== id
        ? s
        : {
            ...s,
            closures: [
              ...s.closures,
              {
                resultId: latestResult(source)!.id,
                condition,
                evidence,
                recordedAt: new Date().toISOString(),
              },
            ],
          },
    ),
  };
}
export function followUpSubmission(
  ssr: SsrWorkspace,
  id: string,
  note: string,
  nextDate: string,
): SsrWorkspace {
  if (
    !ssr.submissions.some((s) => s.id === id) ||
    !note.trim() ||
    !validDate(nextDate)
  )
    throw new TypeError('Submission, note and follow-up date are required');
  return {
    ...ssr,
    submissions: ssr.submissions.map((s) =>
      s.id !== id
        ? s
        : {
            ...s,
            followUps: [
              ...s.followUps,
              {
                id: `follow-${globalThis.crypto.randomUUID()}`,
                note,
                nextDate,
                recordedAt: new Date().toISOString(),
              },
            ],
          },
    ),
  };
}
/** Project summary for daily reminders, with stable action IDs. */
export function ssrAttention(
  ssr: SsrWorkspace,
  baseline: CostVersionSnapshot,
  asOf: string,
) {
  if (!ssr.enabled) return [];
  const items: {
    id: string;
    title: string;
    detail: string;
    severity: 'red' | 'amber';
    fingerprint: string;
  }[] = [];
  for (const s of ssr.submissions) {
    if (
      s.costBaseline.code !== baseline.code ||
      latest(ssr, s.kind, s.domain, baseline.code)?.id !== s.id
    )
      continue;
    const outcome = latestResult(s)?.outcome;
    if (outcome === 'withdrawn') continue;
    const stale = isStale(ssr, s, baseline),
      conditions = openConditions(s);
    if (isApproved(s) && !stale) continue;
    const next = s.followUps.at(-1)?.nextDate;
    const effectiveDate = next || s.dueDate;
    const due = effectiveDate <= asOf;
    const soon = (Date.parse(effectiveDate) - Date.parse(asOf)) / 86400000 <= 3;
    if (!stale && !conditions.length && !due && !soon && outcome !== 'rejected')
      continue;
    const reason =
      outcome === 'rejected'
        ? '评审未通过，需修改或重新申请'
        : stale
          ? '材料或成本已变化，需核实评审适用性'
          : conditions.length
            ? `有 ${conditions.length} 个未关闭条件`
            : due
              ? '到期或到达承诺跟进日'
              : '评审临期';
    const detail = `${ssr.proposalNumber} · ${s.owner} · ${s.applicationNumber} · ${reason}`;
    items.push({
      id: s.id,
      title: `${s.kind}${s.domain ? ' / ' + s.domain : ''}`,
      detail,
      severity:
        outcome === 'rejected' || stale || conditions.length || due
          ? 'red'
          : 'amber',
      fingerprint: contentKey({
        owner: s.owner,
        dueDate: s.dueDate,
        next,
        outcome,
        conditions,
        stale,
        due,
        soon,
      }),
    });
  }
  return items;
}
/** Validates standalone snapshots; transaction checks protect existing append-only records. */
export function assertSsr(ssr: SsrWorkspace) {
  if (
    new Set(ssr.requiredDomains).size !== ssr.requiredDomains.length ||
    ssr.requiredDomains.some((d) => !d.trim())
  )
    throw new TypeError('Specialist domains must be unique nonblank names');
  const ids = new Set<string>();
  for (const s of ssr.submissions) {
    if (
      ids.has(s.id) ||
      !REVIEW_KINDS.includes(s.kind) ||
      !validDate(s.dueDate) ||
      !s.owner.trim() ||
      !s.applicationNumber.trim() ||
      !s.evidence.trim() ||
      s.costKey !== costBaselineKey(s.costBaseline)
    )
      throw new TypeError('Invalid SSR submission snapshot');
    for (const dependency of s.dependencies)
      if (!ids.has(dependency))
        throw new TypeError(
          'SSR dependencies must reference earlier submissions',
        );
    ids.add(s.id);
    if (new Set(s.results.map((r) => r.id)).size !== s.results.length)
      throw new TypeError('Result IDs must be unique');
    for (const r of s.results)
      if (
        !r.evidence.trim() ||
        (r.outcome === 'conditional' && !r.conditions.length) ||
        (r.outcome !== 'conditional' && r.conditions.length) ||
        r.conditions.some((c) => !c.trim())
      )
        throw new TypeError(
          'Review result requires evidence and conditional items',
        );
    for (const c of s.closures)
      if (
        !c.evidence.trim() ||
        !s.results.some(
          (r) => r.id === c.resultId && r.conditions.includes(c.condition),
        )
      )
        throw new TypeError('Invalid condition closure');
    for (const f of s.followUps)
      if (!f.note.trim() || !validDate(f.nextDate))
        throw new TypeError('Invalid follow-up');
  }
}
/** Existing submissions and recorded events remain unchanged; updates append new evidence. */
export function assertSsrTransition(
  previous: SsrWorkspace,
  next: SsrWorkspace,
  baselineOrVersions: CostVersionSnapshot | CostVersionSnapshot[],
) {
  const versions = Array.isArray(baselineOrVersions)
    ? baselineOrVersions
    : [baselineOrVersions];
  for (const old of previous.submissions) {
    const current = next.submissions.find((s) => s.id === old.id);
    if (!current)
      throw new TypeError('Submitted review records cannot be deleted');
    if (
      old.kind === 'DRB' &&
      (current.results.length > old.results.length ||
        current.closures.length > old.closures.length) &&
      ['approved', 'conditional'].includes(latestResult(current)?.outcome || '')
    ) {
      const version = versions.find((v) => v.code === old.costBaseline.code);
      if (!version || version.state !== 'Confirmed')
        throw new TypeError(
          `请先确认成本 ${old.costBaseline.code} (Confirmed)，再登记 DRB 通过或关闭条件。`,
        );
      if (old.costKey !== costBaselineKey(version))
        throw new TypeError(
          'DRB 送审成本已过期，请确认当前成本后重新提交本版本评审。',
        );
    }
    const { results: a, closures: b, followUps: c, ...oldCore } = old;
    const { results: x, closures: y, followUps: z, ...newCore } = current;
    if (contentKey(oldCore) !== contentKey(newCore))
      throw new TypeError('Submitted review snapshots cannot be edited');
    for (const [before, after] of [
      [a, x],
      [b, y],
      [c, z],
    ])
      if (contentKey(after.slice(0, before.length)) !== contentKey(before))
        throw new TypeError('Recorded results and follow-ups are append-only');
  }
  if (
    contentKey(
      next.submissions.slice(0, previous.submissions.length).map((s) => s.id),
    ) !== contentKey(previous.submissions.map((s) => s.id))
  )
    throw new TypeError('Submission order is immutable');
  const accepted = structuredClone(next);
  accepted.submissions = [];
  for (const s of next.submissions) {
    if (!previous.submissions.some((old) => old.id === s.id)) {
      const baseline = versions.find((v) => v.code === s.costBaseline.code);
      if (!baseline)
        throw new TypeError('Submission cost version does not exist.');
      if (
        contentKey(s.costBaseline) !== contentKey(baseline) ||
        s.scopeBasis !== scopeBasisKey(next) ||
        (s.kind === 'QUOTE_DECISION' &&
          s.commercialKey !== next.commercialBasis) ||
        (s.kind === 'BID_REVIEW' && s.bidKey !== bidResponseKey(next))
      )
        throw new TypeError(
          'New submission must capture current materials and cost',
        );
      const expected = submissionDependencies(
        accepted,
        s.kind,
        s.domain,
        baseline,
      );
      if (
        contentKey(
          Object.fromEntries(
            expected.map((id) => [
              id,
              latestResult(accepted.submissions.find((s) => s.id === id)!)
                ?.id || '',
            ]),
          ),
        ) !== contentKey(s.dependencyResults)
      )
        throw new TypeError(
          'Review must capture the current dependency results',
        );
      if (contentKey(expected) !== contentKey(s.dependencies))
        throw new TypeError(
          'Review dependencies do not match current required gates',
        );
    }
    accepted.submissions.push(s);
  }
}

export function assertQuoteDecision(
  ssr: SsrWorkspace | undefined,
  baseline: CostVersionSnapshot,
) {
  if (!ssr?.enabled) return;
  const gate = latest(ssr, 'QUOTE_DECISION', '', baseline.code);
  if (!gate || !isApproved(gate) || isStale(ssr, gate, baseline))
    throw new TypeError(
      '请先记录适用于当前成本与范围的报价决策，并关闭所有条件',
    );
}

export const commercialBasisKey = (workspace: {
  project: unknown;
  pricing: unknown;
  quoteAssumptions: unknown;
  selectedQuoteTemplateId: string;
  quoteTemplates: { id: string }[];
}) =>
  contentKey({
    project: workspace.project,
    pricing: workspace.pricing,
    assumptions: workspace.quoteAssumptions,
    template: workspace.quoteTemplates.find(
      (t) => t.id === workspace.selectedQuoteTemplateId,
    ),
  });
