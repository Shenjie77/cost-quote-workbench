/** Live renderers reuse the approved prototype's primitives and layout, not old React pages. */
import { esc, btn, badge, input, cellInput, table, heading } from './ui.js';
import { fieldName } from './field-editor.js';
import { pick } from './i18n.js';
import { livePricing } from './business/live-model.js';
import {
  allocateQuotationDiscount,
  allocateMoneyByWeights,
  discountGroupKey,
} from './business/engine.js';
const money = (n) =>
  Number(n || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function liveQuoteView(state, data, preview = false) {
  const p = livePricing(state, data),
    settings = state.pricing;
  const field = (id, key, value, type = 'text', extra = '') =>
    cellInput('liveQuote', id, key, value, type, extra);
  // Keep the approved nine-column category worksheet. Saved individual lines stay in details.
  const categories = allocateQuotationDiscount(p.customerLines, 0, {
    mode: 'category',
  }).rows;
  const categoryDiscounts = new Map();
  for (const parent of p.discounts.rows) {
    const children = categories.filter(
      (c) =>
        discountGroupKey(
          c.inclusion,
          p.discounts.mode === 'category' ? c.category : undefined,
          c.section,
        ) === parent.key,
    );
    const amounts = allocateMoneyByWeights(
      parent.discount,
      children.map((c) => c.gross),
    );
    children.forEach((c, i) => categoryDiscounts.set(c.key, amounts[i]));
  }
  const rows = categories
    .map((r) => {
      const indices = p.customerLines.flatMap((line, i) =>
        discountGroupKey(line.inclusion, line.category, line.section) === r.key
          ? [i]
          : [],
      );
      const serviceOnly = indices.every((i) => i < p.costs.length);
      const cost = serviceOnly
        ? indices.reduce((n, i) => n + (p.costs[i] || 0), 0)
        : null;
      const one = indices.length === 1 ? p.drafts[indices[0]] : null;
      const gp =
        one?.targetGrossMargin ??
        (r.gross
          ? (1 - cost / r.gross - p.weightedProfitShareRate / 100) * 100
          : 0);
      const discount = categoryDiscounts.get(r.key) || 0;
      const allocation = p.discounts.rows.find((d) => d.key === r.key);
      return `<tr><td data-user-content>${esc(r.section || r.inclusion)}</td><td data-user-content>${esc(r.category)}</td><td class="num">${cost === null ? '—' : money(cost)}</td>${one ? field(one.id, 'targetGrossMargin', gp, 'number') : `<td class="num">${cost === null ? '—' : money(gp)}</td>`}<td class="num">${money(r.gross)}</td>${allocation && p.discounts.mode === 'category' ? cellInput('liveDiscountShare', r.key, 'percentage', settings.discountAllocation?.shares?.find((s) => s.key === r.key)?.percentage ?? '', 'number', `placeholder="${allocation.percentage.toFixed(2)}"`) : `<td class="num">${settings.discount ? ((discount / settings.discount) * 100).toFixed(2) : '—'}</td>`}<td class="num">${money(discount)}</td><td class="num">${money(r.gross - discount)}</td>${allocation && p.discounts.mode === 'category' ? cellInput('liveDiscountDescription', r.key, 'description', settings.discountAllocation?.descriptions?.[r.key] || '') : `<td class="muted">${pick('按当前折扣层级设置', 'Uses current discount level')}</td>`}</tr>`;
    })
    .join('');
  const headers = [
    { label: 'Section', cls: 'c-code' },
    { label: 'Category', cls: 'c-code' },
    { label: pick('成本 / SGD', 'Cost / SGD'), cls: 'c-number' },
    { label: pick('行 GP %', 'Line GP %'), cls: 'c-short' },
    { label: pick('折前报价', 'List price'), cls: 'c-number' },
    { label: pick('折扣占比 %', 'Discount %'), cls: 'c-number' },
    { label: pick('折扣金额', 'Discount'), cls: 'c-number' },
    { label: pick('折后报价', 'Net price'), cls: 'c-number' },
    {
      label: pick('分类折扣描述', 'Category discount description'),
      cls: 'c-note',
    },
  ];
  const discounts = p.discounts.rows
    .map(
      (r) =>
        `<tr><td data-user-content>${esc(r.label || r.category || r.key)}</td><td class="num">${money(r.gross ?? r.amount ?? 0)}</td>${cellInput('liveDiscountShare', r.key, 'percentage', settings.discountAllocation?.shares?.find((s) => s.key === r.key)?.percentage ?? '', 'number', `placeholder="${r.percentage?.toFixed(2) || 'Auto'}"`)}<td class="num">${money(r.discount)}</td><td class="num">${money(r.net)}</td>${cellInput('liveDiscountDescription', r.key, 'description', settings.discountAllocation?.descriptions?.[r.key] || '')}</tr>`,
    )
    .join('');
  if (preview)
    return (
      heading(
        pick('客户报价预览', 'Customer quotation preview'),
        esc(state._source.project.name),
        btn(pick('返回编辑', 'Back to edit'), 'preview') +
          btn(
            pick('导出报价 Excel', 'Export quotation XLSX'),
            'live-export-quote',
            true,
          ),
      ) +
      `<section class="sheet">${table([pick('描述', 'Description'), pick('数量', 'Quantity'), pick('单价', 'Unit price'), 'SGD'], p.customerLines.map((l) => `<tr><td data-user-content>${esc(l.description)}</td><td class="num">${l.quantity}</td><td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.amount)}</td></tr>`).join(''))}<div class="sheet-footer">${pick('折扣', 'Discount')} ${money(settings.discount)}<span class="grow"></span>${pick('最终报价', 'Final quotation')} <strong>SGD ${money(p.customerTotal)}</strong></div></section>`
    );
  return (
    heading(
      pick('定价与报价', 'Pricing & quotation'),
      pick(
        '沿用已保存的逐行定价、分类和折扣；修改直接在表内完成。',
        'Edit saved line prices, categories and discounts directly in the worksheet.',
      ),
      btn(pick('保存', 'Save'), 'save') +
        btn(pick('客户预览', 'Customer preview'), 'preview', true),
    ) +
    (state.refreshQuote
      ? `<div class="toolbar">${pick('匹配条目保留 GP、价格和备注；新条目采用默认 45% GP。', 'Matched lines retain pricing and remarks; new lines start at 45% GP.')} ${state.refreshQuote.matched} / ${state.refreshQuote.newCount} / ${state.refreshQuote.removedCount}${btn(pick('确认刷新', 'Confirm refresh'), 'live-refresh-confirm', true)}${btn(pick('取消', 'Cancel'), 'live-refresh-cancel')}</div>`
      : '') +
    (p.errors.length
      ? `<div class="validation" role="alert">${p.errors.map(esc).join('<br>')}</div>`
      : '') +
    `<section class="sheet"><div class="toolbar"><label class="inline-field"><span>${pick('报价组织', 'Line grouping')}</span><select data-live-mode>${['single', 'scope', 'group', 'item', 'manual'].map((m) => `<option value="${m}" ${m === (settings.lineSourceMode || settings.lineMode || 'single') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>${btn(pick('从成本刷新', 'Refresh from cost'), 'live-refresh-quote')}<label class="inline-field small-field"><span>${pick('折扣总额', 'Total discount')}</span>${input('livePricing', 'project', 'discount', settings.discount, 'number')}</label><span>${pick('BU 加权分成', 'Weighted BU share')} ${p.weightedProfitShareRate.toFixed(2)}%</span><span class="grow"></span>${btn(pick('添加报价行', 'Add line'), 'live-add-line')}</div>${table(headers, rows, 'pricing-table')}<div class="sheet-footer"><span>${pick('成本', 'Cost')} ${money(data.total)}</span><span>${pick('服务实际 GP', 'Service GP')} <strong>${p.grossMarginPercent.toFixed(2)}%</strong></span><span class="grow"></span>${pick('最终报价', 'Final quotation')} <strong>SGD ${money(p.customerTotal)}</strong></div></section>
 <details class="panel details-panel"><summary>${pick('逐行价格、数量与备注', 'Line prices, quantities and remarks')}</summary><div class="details-content">${table([pick('条目', 'Line'), 'Section', 'Category', pick('行 GP %', 'Line GP %'), pick('单价', 'Unit price'), pick('数量', 'Quantity'), pick('单位', 'Unit'), pick('成本权重', 'Cost weight'), pick('锁定售价', 'Fix price'), pick('备注', 'Remark')], p.drafts.map((l) => `<tr><td data-user-content>${input('liveQuote', l.id, 'description', l.description)}</td>${cellInput('liveGroup', l.id, 'section', p.grouped.find((g) => g.id === l.id)?.section || '')}${cellInput('liveGroup', l.id, 'category', p.grouped.find((g) => g.id === l.id)?.category || '')}${field(l.id, 'targetGrossMargin', l.targetGrossMargin ?? 45, 'number')}${field(l.id, 'unitPrice', l.unitPrice, 'number')}${field(l.id, 'quantity', l.quantity, 'number')}${field(l.id, 'unit', l.unit)}${field(l.id, 'costWeight', l.costWeight ?? 0, 'number')}<td><input type="checkbox" data-collection="liveQuote" data-id="${esc(l.id)}" data-field="priceFixed" ${l.priceFixed ? 'checked' : ''}></td>${cellInput('liveRemark', l.id, 'remark', settings.lineRemarks?.[l.id] || '')}</tr>`).join(''))}</div></details>
 ${p.customer?.maintenance.length ? `<details class="panel details-panel"><summary>${pick('维保报价分类与备注', 'Maintenance grouping & remarks')}</summary><div class="details-content">${table([pick('条目', 'Item'), 'Section', 'Category', pick('备注', 'Remark')], p.customer.maintenance.map((l) => `<tr><td>${esc(l.description)}</td>${cellInput('liveGroup', l.id, 'section', l.section)}${cellInput('liveGroup', l.id, 'category', l.category)}${cellInput('liveRemark', l.id, 'remark', settings.lineRemarks?.[l.id] || '')}</tr>`).join(''))}</div></details>` : ''}
 <details class="panel details-panel"><summary>${pick('分类折扣与说明', 'Discount allocations and descriptions')}</summary><div class="details-content"><div class="toolbar"><select data-collection="livePricing" data-id="project" data-field="discountMode">${['total', 'section', 'category'].map((m) => `<option value="${m}" ${m === (settings.discountAllocation?.mode || 'total') ? 'selected' : ''}>${m}</option>`).join('')}</select>${btn(pick('按价格重置比例', 'Reset to price proportions'), 'reset-discount')}</div>${table([pick('分类', 'Group'), pick('折前', 'Before discount'), pick('折扣占比 %', 'Discount share %'), pick('折扣', 'Discount'), pick('折后', 'After discount'), pick('折扣说明', 'Discount description')], discounts)}</div></details>
 <details class="panel details-panel"><summary>${pick('报价模板、条款与历史', 'Quotation template, terms and history')}</summary><div class="details-content"><div class="toolbar"><select data-live-template>${state.quoteTemplates.map((t) => `<option value="${esc(t.id)}" ${t.id === state.selectedTemplate ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>${btn(pick('采用模板', 'Apply template'), 'live-apply-template')}${btn(pick('导出报价 Excel', 'Export quotation XLSX'), 'live-export-quote', true)}</div>${input('livePricing', 'project', 'quotationProjectName', settings.quotationProjectName || '')}<div class="field-grid">${['paymentTerms', 'validityDays', 'termsAndConditions'].map((k) => `<label class="inline-field"><span>${esc(k)}</span>${input('liveTemplate', state.selectedTemplate, k, state.quoteTemplates.find((t) => t.id === state.selectedTemplate)?.[k] ?? '', k === 'validityDays' ? 'number' : 'text')}</label>`).join('')}</div>${table([pick('包含', 'Include'), pick('假设', 'Assumption')], state.quoteAssumptions.map((a) => `<tr><td><input type="checkbox" data-collection="liveAssumptions" data-id="${esc(a.id)}" data-field="included" ${a.included ? 'checked' : ''}></td>${cellInput('liveAssumptions', a.id, 'text', a.text || '')}</tr>`).join(''))}${table([pick('版本', 'Version'), pick('时间', 'Date'), pick('报价', 'Quote')], state._source.quoteHistory.map((h) => `<tr><td>${esc(h.costVersion || h.id)}</td><td>${esc(h.generatedAt)}</td><td class="num">${money(h.customerQuoteAmount ?? h.quoteAfterTax)}${btn(pick('快照', 'Snapshot'), 'extra-quote-history', false, '', `data-value="${esc(h.id)}"`)}</td></tr>`).join(''))}</div></details>`
  );
}
export function liveWorkflowView(state, expanded, reasons = {}) {
  const w = state._source,
    hold = Boolean(w.workflowHold),
    done = ['completed', 'skipped'];
  const controls = (t) => {
    const disabled = hold || done.includes(t.state) ? 'disabled' : '';
    return `<tr><td>${esc(t.code)}</td><td data-user-content>${esc(pick(t.nameZh || t.name, t.name))}</td><td>${badge(t.state, done.includes(t.state) ? 'success' : 'neutral')}</td>${cellInput('tasks', t.id, 'owner', t.owner, 'text', disabled)}${cellInput('tasks', t.id, 'due', t.due, 'date', disabled)}${cellInput('tasks', t.id, 'note', t.note, 'text', disabled)}<td>${btn(pick('执行 / 附件', 'Actions / files'), 'live-task', false, '', `data-id="${esc(t.id)}"`)}</td></tr>${expanded === t.id ? `<tr><td colspan="7"><div class="details-content"><div class="toolbar"><span>${pick('开始', 'Started')} ${esc(t.startedAt || '—')}</span><span>SLA ${esc(t.dueAt || '—')}</span></div><div class="field-grid">${(t.requiredFields || []).map((k) => `<label class="inline-field"><span>${esc(k)}</span>${input('taskField', t.id, k, t.fields?.[k] || '', 'text', disabled)}</label>`).join('')}</div><div class="toolbar"><label class="inline-field"><input type="checkbox" data-task-confirm="${esc(t.id)}" ${t.confirmed ? 'checked' : ''} ${disabled}>${pick('确认此节点已完成', 'Confirm this task is complete')}</label><label class="inline-field"><span>${pick('操作原因', 'Action reason')}</span>${input('workflowReason', t.id, 'reason', reasons[t.id] || '')}</label>${['update', 'start', 'complete', 'pause', 'resume', 'skip', 'reopen'].map((a) => btn(pick({ update: '保存进展', start: '开始', complete: '完成', pause: '暂停', resume: '恢复', skip: '跳过', reopen: '重开' }[a], a), 'live-workflow-action', a === 'complete', '', `data-id="${esc(t.id)}" data-value="${a}" ${hold ? 'disabled' : ''}`)).join('')}${btn(pick('节点附件', 'Task files'), 'live-task-files', false, 'folder', `data-id="${esc(t.id)}"`)}</div></div></td></tr>` : ''}`;
  };
  return (
    heading(
      pick('项目流程', 'Project workflow'),
      pick(
        '进度、责任人、跟进日期和备注直接在表格内维护。',
        'Maintain progress, owner, follow-up and notes directly in the worksheet.',
      ),
      btn(pick('保存进展', 'Save progress'), 'save', true),
    ) +
    `<section class="sheet"><div class="toolbar">${badge(`${state.tasks.filter((t) => done.includes(t.state)).length} / ${state.tasks.length}`, 'success')}<span>${esc(w.currentWorkflowStepCode)}</span><span class="grow"></span><label class="inline-field"><span>${pick('项目暂停 / 恢复原因', 'Project hold / resume reason')}</span>${input('workflowReason', 'project', 'reason', reasons.project || '')}</label>${btn(hold ? pick('恢复项目', 'Resume project') : pick('暂停项目', 'Hold project'), 'live-hold')}</div>${table(['#', pick('流程节点', 'Workflow step'), pick('状态', 'State'), pick('负责人', 'Owner'), pick('跟进日期', 'Follow-up'), pick('跟进备注', 'Note'), pick('操作', 'Actions')], state.tasks.map(controls).join(''))}</section><details class="panel details-panel"><summary>${pick('流程历史', 'Workflow history')}</summary><div class="details-content">${table([pick('节点', 'Node'), pick('动作', 'Action'), pick('时间', 'Time'), pick('记录', 'Note')], (w.workflowUpdates || []).map((u) => `<tr><td>${esc(u.nodeCode)}</td><td>${esc(u.action)}</td><td>${esc(u.at || u.createdAt)}</td><td>${esc(u.note)}</td></tr>`).join(''))}</div></details>`
  );
}
export function liveTodayView(index, engine) {
  const digest = engine.buildDailyDigest(index, []),
    items = digest.items;
  return (
    heading(
      pick('今日工作', 'Today'),
      pick(
        '先处理需要你行动的事项，再进入项目。',
        'Start with the tasks that need your attention.',
      ),
      esc(digest.asOf || ''),
    ) +
    `<section class="panel"><div class="metrics"><div class="metric"><span>${pick('待处理事项', 'Pending tasks')}</span><strong>${items.length}</strong></div><div class="metric"><span>${pick('待跟进项目', 'Projects to follow up')}</span><strong>${new Set(items.map((i) => i.projectId)).size}</strong></div><div class="metric"><span>${pick('全部项目', 'All projects')}</span><strong>${index.length}</strong></div><span class="grow"></span><a class="text-button" href="#projects">${pick('全部项目', 'All projects')}</a></div>${table([pick('需要处理', 'Needs attention'), pick('项目', 'Project'), pick('截止', 'Due'), pick('优先级', 'Priority'), pick('操作', 'Action')], items.map((i) => `<tr><td data-user-content>${esc(pick(i.titleZh, i.title))}</td><td data-user-content>${esc(index.find((p) => p.projectId === i.projectId)?.name)}</td><td>${esc(i.dueAt || '—')}</td><td>${badge(i.severity, i.severity === 'red' ? 'warning' : 'neutral')}</td><td>${btn(pick('去处理', 'Open task'), 'live-open-task', false, '', `data-project-id="${esc(i.projectId)}" data-id="${esc(i.workflowNodeId || '')}"`)}</td></tr>`).join(''))}</section><div class="split"><section class="panel"><div class="panel-head"><h2>${pick('项目快捷入口', 'Project shortcuts')}</h2></div>${index
      .slice(0, 5)
      .map(
        (p) =>
          `<div class="list-item"><div class="list-text" data-user-content><strong>${esc(p.name)}</strong><p>${esc(p.proposalNumber || p.projectId)}</p></div>${btn(pick('打开', 'Open'), 'open-project', false, '', `data-project-id="${esc(p.projectId)}"`)}</div>`,
      )
      .join(
        '',
      )}</section><section class="panel"><div class="panel-head"><h2>${pick('交付检查', 'Delivery checks')}</h2></div><div class="list-item">${pick('待确认成本版本', 'Unconfirmed costs')} ${index.filter((p) => p.versionState !== 'Confirmed').length}</div><div class="list-item">${pick('流程待办', 'Pending workflow tasks')} ${items.length}</div><a class="list-item subtle-link" href="#workflow">${pick('打开完整流程', 'Open workflow')} →</a></section></div>`
  );
}
export function liveMasterView(record, tab, tabs) {
  const scalars = record?.items.length
    ? Object.keys(record.items[0]).filter((k) =>
        ['string', 'number', 'boolean'].includes(typeof record.items[0][k]),
      )
    : [];
  const cols = [
      ...scalars.filter((k) => k !== 'id' && k !== 'active').slice(0, 7),
      ...scalars.filter((k) => k === 'active'),
    ],
    idKey = record?.keyField || 'id';
  return (
    heading(
      pick('主数据', 'Master data'),
      pick(
        '全局目录独立保存；项目采用快照。',
        'Global catalogs save independently; projects retain snapshots.',
      ),
      btn(pick('保存目录', 'Save catalog'), 'live-master-save', true),
    ) +
    `<section class="sheet"><div class="toolbar"><div class="segments" aria-label="${pick('主数据库', 'Catalog')}">${tabs.map(([id, name]) => `<button class="segment" data-action="master-tab" data-value="${id}" aria-pressed="${id === tab}">${name}</button>`).join('')}</div></div>${record ? table([...cols.map(fieldName), pick('操作', 'Actions')], record.items.map((r, index) => `<tr>${cols.map((k) => (typeof r[k] === 'boolean' ? `<td><input type="checkbox" data-collection="liveMaster" data-id="${esc(r[idKey])}" data-field="${esc(k)}" ${r[k] ? 'checked' : ''}></td>` : cellInput('liveMaster', r[idKey], k, r[k], typeof r[k] === 'number' ? 'number' : 'text', k === idKey ? 'readonly' : ''))).join('')}<td>${btn(pick('完整字段', 'All fields'), 'extra-master-edit', false, '', `data-value="${index}"`)}${btn(pick('删除', 'Delete'), 'extra-master-remove', false, '', `data-value="${index}"`)}</td></tr>`).join('')) : '<div class="empty">Loading…</div>'}<div class="sheet-footer">${record?.total || 0} · R${record?.revision || 0}<span class="grow"></span>${btn(pick('重新载入目录', 'Reload catalog'), 'live-master-reload')}</div></section>`
  );
}
