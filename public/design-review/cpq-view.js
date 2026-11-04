import { pick } from './i18n.js';
import { esc, heading, table, input, btn, cellInput, badge } from './ui.js';
import { engine } from './business/adapter.js';
import { workspaceFromState } from './business/live-model.js';
import { workspaceCostBaseline } from './business/cpq-baseline.js';
export const cpqBaseline = (data, code = 'V1', state) =>
  state?.live
    ? workspaceCostBaseline(workspaceFromState(state))
    : { ...data.snapshot, code };
export function cpqView(state, data, code, error = '') {
  const ws = state.cpqWorkspace,
    draft = ws.draft,
    baseline = cpqBaseline(data, code, state);
  const confirmed = draft.confirmation?.key === engine.mappingKey(ws);
  const fresh = draft.result?.inputKey === engine.calculationKey(ws, baseline);
  const candidates = engine.matchCatalog(ws.catalog, draft.brief);
  const matches = new Map(candidates.map((c) => [c.item.code, c.reason]));
  return (
    heading(
      pick('CPQ 配置', 'CPQ configuration'),
      pick(
        '选择目录 → 确认映射 → 按约束求解 → 查看差额。',
        'Select catalog → confirm mapping → solve constraints → review difference.',
      ),
    ) +
    `<section class="sheet"><div class="toolbar"><label class="inline-field"><span>${pick('范围简述', 'Scope brief')}</span>${input('cpqDraft', 'draft', 'brief', draft.brief)}</label><label class="inline-field"><span>${pick('确认人', 'Confirmed by')}</span>${input('cpqMeta', 'draft', 'confirmer', state.cpqMeta.confirmer)}</label>${btn(pick('确认映射', 'Confirm mapping'), 'cpq-confirm')}${badge(confirmed ? pick('已确认', 'Confirmed') : pick('待确认', 'Not confirmed'), confirmed ? 'success' : 'warning')}</div>${error ? `<div class="validation" role="alert">${esc(error)}</div>` : ''}${table(
      [
        { label: pick('选用', 'Use'), cls: 'c-short' },
        { label: 'Code / Scope', cls: 'c-description' },
        { label: pick('单价', 'Unit cost'), cls: 'c-number' },
        { label: pick('步长 / 上下界', 'Step / bounds'), cls: 'c-medium' },
        { label: pick('数量', 'Qty'), cls: 'c-short' },
        { label: pick('锁定', 'Lock'), cls: 'c-short' },
        { label: pick('权重', 'Weight'), cls: 'c-short' },
        { label: pick('选择依据', 'Selection reason'), cls: 'c-description' },
      ],
      ws.catalog
        .map((item) => {
          const row = draft.selections.find((r) => r.code === item.code);
          return `<tr><td><input type="checkbox" aria-label="Select ${item.code}" data-collection="cpqSelect" data-id="${item.code}" data-field="selected" ${row ? 'checked' : ''}></td><td data-user-content>${esc(item.code)} · ${esc(item.scope)}${matches.has(item.code) ? `<p class="small muted">${esc(matches.get(item.code))}</p>` : ''}</td><td class="num">${item.unitCost.toFixed(2)}</td><td>${item.step} / ${item.minQty}–${item.maxQty}</td>${cellInput('cpqSelections', item.code, 'quantity', row?.quantity || 0, 'number', row ? '' : 'disabled')}<td><input type="checkbox" aria-label="Lock ${item.code}" data-collection="cpqSelections" data-id="${item.code}" data-field="locked" ${row?.locked ? 'checked' : ''} ${row ? '' : 'disabled'}></td>${cellInput('cpqSelections', item.code, 'weight', row?.weight || 1, 'number', row ? '' : 'disabled')}${cellInput('cpqSelections', item.code, 'reason', row?.reason || '', 'text', row ? '' : 'disabled')}</tr>`;
        })
        .join(''),
    )}<div class="toolbar"><label class="inline-field small-field"><span>${pick('目标成本', 'Target cost')}</span>${input('cpqDraft', 'draft', 'targetCost', draft.targetCost, 'number')}</label><label class="inline-field small-field"><span>${pick('容差', 'Tolerance')}</span>${input('cpqDraft', 'draft', 'tolerance', draft.tolerance, 'number')}</label>${btn(pick('采用当前成本', 'Use current cost'), 'cpq-baseline')}<label class="inline-field"><span>${pick('目标依据', 'Target basis')}</span>${input('cpqDraft', 'draft', 'targetBasis', draft.targetBasis)}</label><label class="inline-field"><span>${pick('分配依据', 'Allocation basis')}</span>${input('cpqDraft', 'draft', 'allocationBasis', draft.allocationBasis)}</label><label class="inline-field">${pick('金额取整', 'Rounding')}<select data-collection="cpqDraft" data-id="draft" data-field="rounding">${['ceil-cent', 'half-up-cent'].map((v) => `<option ${draft.rounding === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>${btn(pick('计算配置', 'Solve configuration'), 'cpq-solve', true)}</div>${draft.result ? `<div class="toolbar">${badge(fresh ? pick('结果有效', 'Current result') : pick('输入已变化，需重算', 'Inputs changed; recalculate'), fresh ? 'success' : 'warning')}<span>${pick('结果', 'Result')} SGD ${draft.result.totalCost.toFixed(2)} · ${pick('差额', 'Difference')} ${draft.result.difference.toFixed(2)}</span>${badge(draft.result.acceptable ? pick('容差内', 'Within tolerance') : pick('未满足容差', 'Outside tolerance'), draft.result.acceptable ? 'success' : 'warning')}</div>${table(['Code', pick('求解数量', 'Solved qty'), pick('金额', 'Amount')], draft.result.lines.map((l) => `<tr><td>${esc(l.item.code)}</td><td>${l.quantity}</td><td>${l.amount.toFixed(2)}</td></tr>`).join(''))}` : ''}<div class="sheet-footer">${pick('使用原平台约束求解与映射校验；有效结果可在下方归档。', 'Uses the original solver and mapping validation. Archive a current result below.')}</div></section>`
  );
}
