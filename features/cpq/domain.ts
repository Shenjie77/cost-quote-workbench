/** CPQ matching and bounded discrete allocation. No company-system or AI calls. */
import type { CostVersionSnapshot } from '../cost/domain.ts';

export type CatalogItem = {
  code: string;
  scope: string;
  unit: string;
  unitCost: number;
  kind: 'equipment' | 'service';
  adjustable: boolean;
  active: boolean;
  step: number;
  minQty: number;
  maxQty: number;
  referenceQty: number;
  tags: string;
  revision: string;
};
export type CpqSelection = {
  code: string;
  quantity: number;
  locked: boolean;
  weight: number;
  reason: string;
};
export type CpqDraft = {
  brief: string;
  costVersion: string;
  targetCost: number;
  targetBasis: string;
  tolerance: number;
  rounding: 'ceil-cent' | 'half-up-cent';
  allocationBasis: string;
  selections: CpqSelection[];
  confirmation?: { key: string; by: string; at: string };
  result?: CpqResult;
};
export type CpqResultLine = {
  item: CatalogItem;
  quantity: number;
  referenceQty: number;
  amount: number;
  locked: boolean;
  reason: string;
};
export type CpqResult = {
  inputKey: string;
  lines: CpqResultLine[];
  targetCost: number;
  totalCost: number;
  difference: number;
  acceptable: boolean;
  searchComplete: boolean;
  visited: number;
  generatedAt: string;
  allocationBasis: string;
};
export type CpqArchive = {
  id: string;
  createdAt: string;
  costVersion: string;
  costBaseline: CostVersionSnapshot;
  costKey: string;
  draft: CpqDraft;
  result: CpqResult;
  proposalNumber: string;
};
export type CpqWorkspace = {
  catalog: CatalogItem[];
  draft: CpqDraft;
  archives: CpqArchive[];
};

export const emptyCpq = (): CpqWorkspace => ({
  catalog: [],
  archives: [],
  draft: {
    brief: '',
    costVersion: '',
    targetCost: 0,
    targetBasis: '',
    tolerance: 0,
    rounding: 'ceil-cent',
    allocationBasis: 'Equal service budget / 服务等额预算假设',
    selections: [],
  },
});

/** Stable content identity; deliberately a canonical value, not a digital signature. */
export const contentKey = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(contentKey).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${contentKey(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
export const costBaselineKey = (version: CostVersionSnapshot): string =>
  contentKey({
    code: version.code,
    costRows: version.costRows,
    rateSettings: version.rateSettings,
    resourceTypes: version.resourceTypes,
    travelSettings: version.travelSettings,
    travelRows: version.travelRows,
    travelUplift: version.travelUplift,
    manualCosts: version.manualCosts,
  });
const finite = (n: number, label: string, min = 0, max = 1e9) => {
  if (!Number.isFinite(n) || n < min || n > max)
    throw new TypeError(`${label}: invalid number / 数值超出范围`);
};
const scaled = (n: number, scale: number, label: string) => {
  const value = Math.round(n * scale);
  if (!Number.isSafeInteger(value) || Math.abs(n * scale - value) > 0.00001)
    throw new TypeError(`${label}: unsupported precision / 精度超出限制`);
  return value;
};
export function assertCatalog(catalog: CatalogItem[]) {
  const codes = new Set<string>();
  for (const item of catalog) {
    if (
      !item.code.trim() ||
      !item.scope.trim() ||
      !item.unit.trim() ||
      !item.revision.trim()
    )
      throw new TypeError(
        'Code, Scope, Unit and Revision are required / 编码、范围、单位、版本必填',
      );
    if (codes.has(item.code))
      throw new TypeError(`Duplicate code / 重复编码: ${item.code}`);
    codes.add(item.code);
    finite(item.unitCost, `${item.code} unitCost`, 0.01, 1e8);
    scaled(item.unitCost, 100, 'unitCost');
    if (item.unitCost * item.maxQty > 1e12)
      throw new TypeError(
        `${item.code}: unitCost × maxQty must not exceed 1e12 / 请缩小目录数量上限`,
      );
    for (const [key, value] of Object.entries({
      step: item.step,
      minQty: item.minQty,
      maxQty: item.maxQty,
      referenceQty: item.referenceQty,
    })) {
      finite(value, `${item.code} ${key}`, key === 'step' ? 0.0001 : 0, 1e6);
      scaled(value, 10000, key);
    }
    if (item.minQty > item.maxQty)
      throw new TypeError(`${item.code}: minQty > maxQty`);
    if (item.kind === 'equipment' && item.adjustable)
      throw new TypeError(
        `${item.code}: equipment quantity cannot be adjustable / 设备数量不能设为可调`,
      );
    if (item.kind !== 'equipment' && item.kind !== 'service')
      throw new TypeError('Invalid catalog kind');
  }
}
const normalizedText = (s: string) => s.normalize('NFKC').toLowerCase();
const terms = (s: string): string[] => {
  const text = normalizedText(s);
  const words = text.match(/[a-z0-9]+|[\u3400-\u9fff]+/gu) || [];
  return [
    ...new Set(
      words.flatMap((word) =>
        /[\u3400-\u9fff]/u.test(word)
          ? word.length === 1
            ? [word]
            : Array.from({ length: word.length - 1 }, (_, i) =>
                word.slice(i, i + 2),
              )
          : [word],
      ),
    ),
  ];
};
/** Local lexical candidates. Skills may rerank using catalog evidence; scores are not confidence. */
export function matchCatalog(catalog: CatalogItem[], brief: string) {
  assertCatalog(catalog);
  const query = terms(brief);
  if (!query.length) return [];
  return catalog
    .filter((row) => row.active)
    .map((item) => {
      const text = normalizedText(`${item.code} ${item.scope} ${item.tags}`);
      const matched = query.filter((term) => text.includes(term));
      return {
        item,
        score: matched.length / query.length,
        reason: `Matched terms / 关键词: ${matched.join(', ')}`,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.item.code.localeCompare(b.item.code))
    .slice(0, 30);
}
const selectedItems = (data: CpqWorkspace) =>
  data.draft.selections.map((selection) => {
    const item = data.catalog.find((row) => row.code === selection.code);
    if (!item || !item.active)
      throw new TypeError(
        `Selected catalog item missing/inactive / 条目失效: ${selection.code}`,
      );
    return { selection, item };
  });
export const mappingKey = (data: CpqWorkspace) =>
  contentKey({
    brief: data.draft.brief,
    selected: selectedItems(data).map(({ selection, item }) => ({
      item,
      code: selection.code,
      locked: selection.locked,
      quantity: selection.quantity,
    })),
  });
export const calculationKey = (
  data: CpqWorkspace,
  baseline: CostVersionSnapshot,
) => {
  const { result: _result, ...draft } = data.draft;
  return contentKey({
    draft,
    catalog: selectedItems(data).map(({ item }) => item),
    cost: costBaselineKey(baseline),
  });
};
export function confirmMapping(data: CpqWorkspace, by: string): CpqWorkspace {
  assertCatalog(data.catalog);
  if (!data.draft.brief.trim() || !by.trim() || !data.draft.selections.length)
    throw new TypeError(
      'Brief, selected items and confirmer are required / 请填写简述、选择条目并记录确认人',
    );
  if (
    new Set(data.draft.selections.map((s) => s.code)).size !==
    data.draft.selections.length
  )
    throw new TypeError('Duplicate selected codes');
  for (const { item, selection } of selectedItems(data)) {
    finite(selection.quantity, `${item.code} qty`, 0, 1e6);
    if (
      (!item.adjustable || item.kind === 'equipment' || selection.locked) &&
      selection.quantity <= 0
    )
      throw new TypeError(
        `${item.code}: enter actual fixed quantity / 请填写固定实际数量`,
      );
  }
  const { result: _result, ...draft } = data.draft;
  return {
    ...data,
    draft: {
      ...draft,
      confirmation: { key: mappingKey(data), by, at: new Date().toISOString() },
    },
  };
}
/** Exact integer line arithmetic; quantity supports 4 decimals, cost supports cents. */
export const cpqLineCents = (
  item: CatalogItem,
  quantity: number,
  rounding: CpqDraft['rounding'],
) => {
  const numerator =
    BigInt(scaled(item.unitCost, 100, 'unitCost')) *
    BigInt(scaled(quantity, 10000, 'quantity'));
  const amount = Number(
    (numerator + BigInt(rounding === 'ceil-cent' ? 9999 : 5000)) /
      BigInt(10000),
  );
  if (!Number.isSafeInteger(amount) || amount > 1e14)
    throw new RangeError('CPQ amount exceeds supported range');
  return amount;
};
export function solveCpq(
  data: CpqWorkspace,
  baseline: CostVersionSnapshot,
  maxVisited = 50000,
): CpqResult {
  assertCatalog(data.catalog);
  const draft = data.draft;
  if (
    !draft.selections.length ||
    new Set(draft.selections.map((s) => s.code)).size !==
      draft.selections.length
  )
    throw new TypeError('Select unique catalog items / 所选编码不可为空或重复');
  if (!Number.isInteger(maxVisited) || maxVisited < 1 || maxVisited > 1000000)
    throw new TypeError('Invalid search limit');
  if (!draft.confirmation || draft.confirmation.key !== mappingKey(data))
    throw new TypeError(
      'Confirm the current items before calculating / 条目有变化，请先确认',
    );
  if (draft.costVersion !== baseline.code)
    throw new TypeError('Cost version mismatch / 成本版本不一致');
  if (!draft.targetBasis.trim() || !draft.allocationBasis.trim())
    throw new TypeError(
      'Record target and allocation basis / 请记录目标成本与数量分配依据',
    );
  finite(draft.targetCost, 'targetCost', 0, 1e12);
  finite(draft.tolerance, 'tolerance', 0, 1e12);
  const target = scaled(draft.targetCost, 100, 'targetCost');
  const tolerance = scaled(draft.tolerance, 100, 'tolerance');
  const selected = selectedItems(data).sort((a, b) =>
    a.item.code.localeCompare(b.item.code),
  );
  if (selected.length > 30)
    throw new TypeError(
      'Solve up to 30 selected items per configuration / 单次最多计算30项',
    );
  const rows = selected.map(({ item, selection }) => {
    finite(selection.weight, 'weight', 0.0001, 1e14);
    finite(selection.quantity, 'quantity', 0, 1e6);
    const step = scaled(item.step, 10000, 'step');
    const min = Math.max(step, scaled(item.minQty, 10000, 'minQty'));
    const lo = Math.ceil(min / step),
      hi = Math.floor(scaled(item.maxQty, 10000, 'maxQty') / step);
    const locked =
      !item.adjustable || item.kind === 'equipment' || selection.locked;
    const qty = scaled(selection.quantity, 10000, 'quantity');
    if (
      lo > hi ||
      (locked && (qty % step !== 0 || qty / step < lo || qty / step > hi))
    )
      throw new TypeError(
        `${item.code}: quantity violates step or bounds / 数量不满足步长或上下限`,
      );
    return {
      item,
      selection,
      step,
      lo,
      hi,
      locked,
      amount: (k: number) =>
        cpqLineCents(item, (k * step) / 10000, draft.rounding),
    };
  });
  const fixed = rows
    .filter((r) => r.locked)
    .reduce(
      (sum, r) =>
        sum + cpqLineCents(r.item, r.selection.quantity, draft.rounding),
      0,
    );
  const variable = rows.filter((r) => !r.locked);
  const weights = variable.reduce((sum, r) => sum + r.selection.weight, 0);
  const budget = Math.max(0, target - fixed);
  const ideals = variable.map((r) => (budget * r.selection.weight) / weights);
  const refs = variable.map((r, i) =>
    Math.max(
      r.lo,
      Math.min(
        r.hi,
        Math.round(((ideals[i] / (r.item.unitCost * 100)) * 10000) / r.step),
      ),
    ),
  );
  let best = refs.slice();
  const evaluate = (ks: number[]) => {
    const amounts = ks.map((k, i) => variable[i].amount(k));
    return [
      Math.abs(fixed + amounts.reduce((a, b) => a + b, 0) - target),
      amounts.reduce((sum, n, i) => sum + Math.abs(n - ideals[i]), 0),
    ] as const;
  };
  let score = evaluate(best);
  const consider = (ks: number[]) => {
    const next = evaluate(ks);
    if (next[0] < score[0] || (next[0] === score[0] && next[1] < score[1])) {
      best = ks.slice();
      score = next;
    }
  };
  // Quickly repair rounding residuals before bounded exhaustive exploration.
  for (let pass = 0; pass < 3; pass++)
    for (let i = 0; i < variable.length; i++) {
      const row = variable[i];
      const other =
        fixed +
        best.reduce(
          (sum, k, j) => sum + (j === i ? 0 : variable[j].amount(k)),
          0,
        );
      const ideal =
        (((target - other) / (row.item.unitCost * 100)) * 10000) / row.step;
      for (const k of [Math.floor(ideal), Math.ceil(ideal), row.lo, row.hi]) {
        const candidate = best.slice();
        candidate[i] = Math.max(row.lo, Math.min(row.hi, k));
        consider(candidate);
      }
    }
  const suffixMin = Array(variable.length + 1).fill(0) as number[];
  const suffixMax = Array(variable.length + 1).fill(0) as number[];
  for (let i = variable.length - 1; i >= 0; i--) {
    suffixMin[i] = suffixMin[i + 1] + variable[i].amount(variable[i].lo);
    suffixMax[i] = suffixMax[i + 1] + variable[i].amount(variable[i].hi);
  }
  let visited = 0,
    complete = true;
  const ks: number[] = [];
  const search = (index: number, partial: number) => {
    if (visited >= maxVisited) {
      complete = false;
      return;
    }
    visited++;
    const low = partial + suffixMin[index],
      high = partial + suffixMax[index];
    if (Math.max(low - target, target - high, 0) > score[0]) return;
    if (index === variable.length) {
      consider(ks);
      return;
    }
    const r = variable[index],
      center = refs[index];
    for (
      let distance = 0;
      distance <= Math.max(center - r.lo, r.hi - center);
      distance++
    ) {
      for (const k of distance === 0
        ? [center]
        : [center - distance, center + distance]) {
        if (k < r.lo || k > r.hi) continue;
        if (visited >= maxVisited) {
          complete = false;
          return;
        }
        ks[index] = k;
        search(index + 1, partial + r.amount(k));
      }
    }
  };
  search(0, fixed);
  let index = 0;
  const lines = rows.map((r): CpqResultLine => {
    const quantity = r.locked
      ? r.selection.quantity
      : (best[index++] * r.step) / 10000;
    return {
      item: structuredClone(r.item),
      quantity,
      referenceQty: r.selection.quantity,
      amount: cpqLineCents(r.item, quantity, draft.rounding) / 100,
      locked: r.locked,
      reason: r.selection.reason,
    };
  });
  const total = lines.reduce(
    (sum, line) => sum + Math.round(line.amount * 100),
    0,
  );
  return {
    inputKey: calculationKey(data, baseline),
    lines,
    targetCost: draft.targetCost,
    totalCost: total / 100,
    difference: (total - target) / 100,
    acceptable: Math.abs(total - target) <= tolerance,
    searchComplete: complete,
    visited,
    generatedAt: new Date().toISOString(),
    allocationBasis: draft.allocationBasis,
  };
}
export function archiveCpq(
  data: CpqWorkspace,
  baseline: CostVersionSnapshot,
  proposalNumber = '',
): CpqWorkspace {
  const result = data.draft.result;
  if (!result || result.inputKey !== calculationKey(data, baseline))
    throw new TypeError(
      'Inputs changed; recalculate before archiving / 输入已变化，请重算后归档',
    );
  if (!result.acceptable)
    throw new TypeError(
      'Unresolved difference; keep as draft / 差额未满足容差，保留为草稿',
    );
  const draft = structuredClone(data.draft);
  delete draft.result;
  if (data.archives.some((entry) => entry.result.inputKey === result.inputKey))
    throw new TypeError(
      'This configuration is already archived / 此配置已归档',
    );
  const next = {
    ...data,
    archives: [
      ...data.archives,
      {
        id: `cpq-${globalThis.crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        costVersion: baseline.code,
        costBaseline: structuredClone(baseline),
        costKey: costBaselineKey(baseline),
        draft,
        result: structuredClone(result),
        proposalNumber,
      },
    ],
  };
  assertCpq(next);
  return next;
}
/** Verifies persisted results without trusting agent-supplied totals or changing archives. */
export function assertCpq(data: CpqWorkspace, allowUnacceptable = false) {
  assertCatalog(data.catalog);
  if (new Set(data.archives.map((a) => a.id)).size !== data.archives.length)
    throw new TypeError('Duplicate CPQ archive IDs');
  for (const archive of data.archives) {
    if (
      archive.costKey !== costBaselineKey(archive.costBaseline) ||
      archive.costVersion !== archive.costBaseline.code
    )
      throw new TypeError('CPQ cost snapshot mismatch');
    const local = {
      catalog: archive.result.lines.map((line) => line.item),
      draft: archive.draft,
      archives: [],
    };
    const computed = solveCpq(local, archive.costBaseline, 1);
    if (archive.result.inputKey !== computed.inputKey)
      throw new TypeError('CPQ archive input mismatch');
    if (
      archive.result.targetCost !== archive.draft.targetCost ||
      archive.result.allocationBasis !== archive.draft.allocationBasis
    )
      throw new TypeError('CPQ archive target or allocation basis mismatch');
    if (archive.result.lines.length !== archive.draft.selections.length)
      throw new TypeError('CPQ archive line count mismatch');
    let total = 0;
    for (const line of archive.result.lines) {
      const source = archive.draft.selections.find(
        (s) => s.code === line.item.code,
      );
      if (!source) throw new TypeError('CPQ archive contains unconfirmed item');
      if (
        line.referenceQty !== source.quantity ||
        line.reason !== source.reason
      )
        throw new TypeError('CPQ archive quantity provenance mismatch');
      const locked =
        !line.item.adjustable ||
        line.item.kind === 'equipment' ||
        source.locked;
      if (
        line.locked !== locked ||
        (locked && line.quantity !== source.quantity)
      )
        throw new TypeError('CPQ fixed quantity changed');
      const q = scaled(line.quantity, 10000, 'quantity'),
        step = scaled(line.item.step, 10000, 'step');
      if (
        q <= 0 ||
        q % step ||
        line.quantity < line.item.minQty ||
        line.quantity > line.item.maxQty
      )
        throw new TypeError('CPQ archived quantity violates rules');
      const amount = cpqLineCents(
        line.item,
        line.quantity,
        archive.draft.rounding,
      );
      if (scaled(line.amount, 100, 'line amount') !== amount)
        throw new TypeError('CPQ archived amount mismatch');
      total += amount;
    }
    const difference = total - Math.round(archive.draft.targetCost * 100);
    if (
      scaled(archive.result.totalCost, 100, 'total') !== total ||
      scaled(archive.result.difference, 100, 'difference') !== difference ||
      archive.result.acceptable !==
        Math.abs(difference) <= Math.round(archive.draft.tolerance * 100) ||
      (!allowUnacceptable && !archive.result.acceptable)
    )
      throw new TypeError('CPQ archived total mismatch');
  }
}

/** A matching key identifies inputs only; verify all current displayed numbers too. */
export function assertCurrentCpqResult(
  data: CpqWorkspace,
  baseline: CostVersionSnapshot,
) {
  if (!data.draft.result) return;
  let currentKey: string;
  try {
    currentKey = calculationKey(data, baseline);
  } catch {
    return;
  }
  if (data.draft.result.inputKey !== currentKey) return;
  const { result, ...draft } = data.draft;
  assertCpq(
    {
      ...data,
      archives: [
        {
          id: 'current-result',
          createdAt: result!.generatedAt,
          costVersion: baseline.code,
          costBaseline: baseline,
          costKey: costBaselineKey(baseline),
          draft,
          result: result!,
          proposalNumber: '',
        },
      ],
    },
    true,
  );
}
