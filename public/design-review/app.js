import { moveCostGroup, removeCostGroup } from './business/cost-groups.js';
import { columnSettings, groupActions } from './cost-grid-view.js';
import {
  readGrid,
  writeGrid,
  orderedColumns,
} from './cost-grid-preferences.js';
import { LiveWorkbench } from './live-workbench.js';
import { projectState } from './business/live-model.js';
import {
  liveQuoteView,
  liveWorkflowView,
  liveTodayView,
  liveMasterView,
} from './live-views.js';
const isDemo = new URLSearchParams(location.search).get('demo') === '1';
import { pick, translate, localize, setLanguage } from './i18n.js';
import { reviewData, reviewPricing, engine } from './business/adapter.js';
import { summaryView as renderSummary } from './summary-view.js';
import { projectInfoView } from './project-info-view.js';
import {
  captureCost,
  restoreCost,
  versionBar,
  compareView,
} from './version-view.js';
import { cpqView as renderCpq, cpqBaseline } from './cpq-view.js';
import { auditView } from './audit-view.js';
import {
  filesView as renderFiles,
  folderLinks,
  folderFor,
} from './files-view.js';
import { editDirectMandays } from './business/cost-input.js';
import { ratesView, travelView, inputSummaryView } from './rates-view.js';
import { subcontractView } from './subcontract-view.js';
import { pricingView } from './pricing-view.js';
import {
  esc,
  svg,
  btn,
  badge,
  input,
  select,
  cellInput,
  table,
  heading,
} from './ui.js';
const $ = (s) => document.querySelector(s);
const money = (n) =>
  Number(n || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const routes = [
  ['today', '今日工作', 'clock', '工作空间'],
  ['projects', '项目列表', 'folder'],
  ['workflow', '项目流程', 'flow', '当前项目'],
  ['cost', '成本录入', 'sheet'],
  ['subcon', '分包成本', 'list'],
  ['summary', '成本汇总', 'grid'],
  ['compare', '版本对比', 'grid'],
  ['quote', '定价与报价', 'sheet'],
  ['cpq', 'CPQ 配置', 'settings'],
  ['maintenance', '维保报价', 'list'],
  ['drafts', '测算草稿', 'sheet'],
  ['files', '项目文件', 'file'],
  ['master', '主数据', 'settings', '全局资源'],
  ['audit', '功能对照', 'list'],
];
const categories = ['Mandatory', 'Phase2', 'Optional'];
import { seed } from './sample-data.js';

const collapsed = new Set();
let subconTab = 'shared',
  catalogOpen = false;
let fileFilters = {
  folder: 'all',
  category: 'all',
  version: '',
  node: '',
  deleteId: '',
};
let cpqError = '';
let summaryTab = 'statement';
let hasEdits = false;
let pendingGroupDelete = null;
let state = structuredClone(seed),
  route = location.hash.slice(1) || 'cost',
  year = '0',
  grouped = true,
  basis = 'md',
  filter = '',
  masterTab = 'resources',
  quotePreview = false,
  helpOpen = false,
  projectName = '园区网络升级';
let currentVersion = 'V1',
  compareVersion = 'V1',
  confirmingVersion = false;
let versions = [{ code: 'V1', confirmed: false, snapshot: captureCost(state) }];
const openPanels = new Set();
function restorePanels() {
  document.querySelectorAll('#main details').forEach((el) => {
    const key = el.dataset.panelKey || el.querySelector('summary')?.textContent;
    if (openPanels.has(key)) el.open = true;
  });
}
document.addEventListener(
  'toggle',
  (event) => {
    const el = event.target;
    if (el.tagName !== 'DETAILS' || !el.isConnected) return;
    const key = el.dataset.panelKey || el.querySelector('summary')?.textContent;
    if (el.open) openPanels.add(key);
    else openPanels.delete(key);
  },
  true,
);
let creatingProject = false;
const live = isDemo
  ? null
  : new LiveWorkbench({
      state: () => state,
      data,
      layout: () => ({
        grouped,
        columns: (
          readGrid(state).visible || [
            'scope',
            'bu',
            'reType',
            'totalMd',
            'totalCost',
          ]
        ).filter((id) => !['index', 'rate'].includes(id)),
        yearIndex: year === 'all' ? 'all' : Number(year),
      }),
      render,
      renderInPlace,
      notify: (text) => notify(text),
      dirty: () => saved(),
      lock: (busy) => {
        document
          .querySelectorAll(
            '#main input,#main select,#main button,#project-choice',
          )
          .forEach((el) => (el.disabled = busy));
      },
      setState: (next) => {
        const switching =
          state._source?.project.id !== next._source.project.id ||
          state._source?.activeVersion !== next._source.activeVersion;
        state = next;
        pendingGroupDelete = null;
        if (switching) {
          const view = readGrid(state);
          year = view.year || '0';
          basis = year === 'all' ? 'md' : view.basis || 'md';
          grouped = view.grouped ?? true;
        }
        hasEdits = false;
        cachedKey = '';
        projectName = next._source.project.name;
        currentVersion = next._source.activeVersion;
        compareVersion = currentVersion;
        confirmingVersion = false;
        versions = next._source.costVersions.map((v) => {
          const projected = projectState(
            { ...next._source, ...v, activeVersion: v.code },
            live.index,
          );
          return {
            code: v.code,
            state: v.state,
            confirmed: v.state !== 'Draft',
            snapshot: {
              ...captureCost(projected),
              _source: projected._source,
              _baseline: projected._baseline,
            },
          };
        });
      },
      showCreate: () => {
        creatingProject = true;
        render();
      },
      hideCreate: () => {
        creatingProject = false;
      },
      taskFiles: (id) => {
        fileFilters = {
          ...fileFilters,
          folder: 'workflow',
          category: 'workflow',
          version: state._source.workflowVersion || currentVersion,
          node: id,
        };
        location.hash = 'files';
        render();
      },
    });
const costRoutes = ['cost', 'subcon', 'summary', 'compare'];
const costLocked = () =>
  versions.find((v) => v.code === currentVersion).confirmed ||
  Boolean(
    live?.record &&
    live.features.caps?.costLockReason(state._source, currentVersion),
  );
const titleFor = (key) => routes.find((r) => r[0] === key)?.[1] || '成本录入';
const notify = (text) => {
  $('#toast').textContent = translate(text);
  $('#toast').style.display = 'block';
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(
    () => ($('#toast').style.display = 'none'),
    2600,
  );
};
const saved = () => {
  hasEdits = true;
  if (live) live.dirty();
  $('#save-status').textContent = live ? live.status : '演示已更新';
  localize($('#save-status'));
};
const search = () =>
  `<input type="search" id="table-search" value="${esc(filter)}" aria-label="搜索当前页面" placeholder="搜索当前表格…">`;
const rowMatch = (r) =>
  !filter ||
  Object.values(r).join(' ').toLowerCase().includes(filter.toLowerCase());
const rowMd = (r) =>
  year === 'all' ? r.years.reduce((a, b) => a + b, 0) : r.years[Number(year)];
let cachedKey = '',
  cachedData;
function data() {
  const key = JSON.stringify(state);
  if (key !== cachedKey) {
    cachedData = reviewData(state);
    cachedKey = key;
  }
  return cachedData;
}
const visibleCost = (r) => {
  const row = data().snapshot.costRows.find((x) => x.id === r.id);
  return year === 'all'
    ? engine.totalRowCost(row)
    : row.years[Number(year)].cost;
};
const totalCost = () => data().total;
const pricing = () => reviewPricing(state, data()).rows;
function renderNav() {
  $('#navigation').innerHTML = routes
    .filter((r) => !live || r[0] !== 'audit')
    .map(
      ([key, label, icon, section]) =>
        `${section ? `<span class="nav-heading">${section}</span>` : ''}<a class="nav-link" title="${label}" href="#${key}" ${route === key ? 'aria-current="page"' : ''}>${svg(icon)}<span>${label}</span>${key === 'workflow' ? '<span class="nav-count">5</span>' : ''}</a>`,
    )
    .join('');
  $('#breadcrumb').innerHTML =
    `工作平台 <span>/</span> <strong>${titleFor(route)}</strong>`;
}
function costView() {
  const heads = [
    { label: '#', cls: 'c-index' },
    { label: 'Scope / 工作内容', cls: 'c-description' },
    { label: 'BU', cls: 'c-short' },
    { label: '资源类型', cls: 'c-medium' },
  ];
  if (!grouped)
    heads.splice(
      1,
      0,
      { label: 'Group', cls: 'c-code' },
      { label: 'Category', cls: 'c-code' },
    );
  if (year === 'all')
    heads.push(
      ...[1, 2, 3, 4, 5].map((n) => ({
        label: `Y${n} ${pick('人天', 'MD')}`,
        cls: 'c-short',
      })),
    );
  else if (basis === 'sites')
    heads.push(
      { label: 'MD / Site', cls: 'c-short' },
      { label: 'Sites', cls: 'c-short' },
      { label: '人天', cls: 'c-short' },
    );
  else heads.push({ label: '人天 / MD', cls: 'c-number' });
  heads.push(
    { label: '基准费率 / SGD', cls: 'c-number' },
    { label: '成本 / SGD', cls: 'c-number' },
    { label: '', cls: 'c-action' },
  );
  let index = 0,
    body = '';
  const visible = state.rows.filter(rowMatch);
  const ids = [
    'index',
    ...(!grouped ? ['groupName', 'category'] : []),
    'scope',
    'bu',
    'reType',
    ...(year === 'all'
      ? [1, 2, 3, 4, 5].map((n) => `Y${n}:mandays`)
      : basis === 'sites'
        ? [
            'mdPerSite',
            `Y${Number(year) + 1}:sites`,
            `Y${Number(year) + 1}:mandays`,
          ]
        : [`Y${Number(year) + 1}:mandays`]),
    'rate',
    'totalCost',
    'action',
  ];
  const prefs = readGrid(state),
    order = orderedColumns(ids, prefs);
  const headers = order.map((id) => heads[ids.indexOf(id)]);
  writeGrid(state, {
    visible: order,
    all: orderedColumns(ids, { ...prefs, hidden: [] }),
  });
  const columnsMenu = columnSettings(ids, heads, prefs);
  const rowHtml = (r) => {
    const cells = {
      index: `<td class="row-index">${++index}</td>`,
      groupName: cellInput(
        'rows',
        r.id,
        'groupLabel',
        state.groups.find((g) => g.id === r.group)?.name || '',
      ),
      category: cellInput(
        'rows',
        r.id,
        'categoryLabel',
        state.groups.find((g) => g.id === r.group)?.category || '',
      ),
      scope: cellInput('rows', r.id, 'scope', r.scope),
      bu: `<td class="edit">${select('rows', r.id, 'bu', r.bu, live ? [...new Set([...state.rows.map((r) => r.bu), ...state.businessUnits].filter(Boolean))] : ['FBB', 'MBB'])}</td>`,
      reType: `<td class="edit">${select('rows', r.id, 'resource', r.resource, live ? state.resources.map((r) => r.name) : ['Local L3', 'Local L4', 'HQ L2'])}</td>`,
      mdPerSite: cellInput('rows', r.id, 'mdSite', r.mdSite, 'number'),
      rate: `<td class="num">${money(r.rate)}</td>`,
      totalCost: `<td class="num">${money(visibleCost(r))}</td>`,
      action: `<td><div class="cell-actions"><button class="icon-button" data-action="row-up" data-id="${esc(r.id)}" aria-label="${esc(pick('上移行', 'Move row up'))} ${esc(r.scope)}">↑</button><button class="icon-button" data-action="delete-row" data-id="${esc(r.id)}" aria-label="${esc(pick('删除成本行', 'Delete cost row'))} ${esc(r.scope)}">${svg('trash')}</button></div></td>`,
    };
    r.years.forEach((v, i) => {
      cells[`Y${i + 1}:mandays`] =
        basis === 'sites' && year !== 'all'
          ? `<td class="num">${v}</td>`
          : cellInput('rows', r.id, `year${i}`, v, 'number');
      cells[`Y${i + 1}:sites`] = cellInput(
        'rows',
        r.id,
        'sites',
        r.siteYears?.[i] ?? 0,
        'number',
      );
    });
    return `<tr>${order.map((id) => cells[id]).join('')}</tr>`;
  };
  for (const group of state.groups) {
    const rows = visible.filter((r) => r.group === group.id);
    if (!rows.length && filter) continue;
    if (grouped)
      body += `<tr class="group-row"><td colspan="${headers.length}"><div class="group-bar"><button class="icon-button" data-action="collapse" data-id="${group.id}" aria-expanded="${!collapsed.has(group.id)}" aria-label="展开或收起 ${esc(group.name)}">${collapsed.has(group.id) ? '+' : '−'}</button><label class="inline-field"><span>Group</span><input aria-label="Group ${group.id}" data-group-name="${group.id}" value="${esc(group.name)}"></label><label class="inline-field"><span>Category</span><input aria-label="Category ${group.id}" data-group-category="${group.id}" list="category-options" value="${esc(group.category)}"></label>${btn('应用组内', 'apply-group', false, 'check', `data-id="${group.id}"`)}${btn('复制', 'copy-group', false, '', `data-id="${group.id}"`)}<span class="group-meta"><span>${rows.length} 行</span><span>${rows.reduce((s, r) => s + rowMd(r), 0)} MD</span><strong>SGD ${money(rows.reduce((s, r) => s + visibleCost(r), 0))}</strong></span>${groupActions(state.groups, group, costLocked())}</div>${pendingGroupDelete === group.id ? `<div class="toolbar" role="alert"><span>${esc(pick('删除此组及组内全部', 'Delete this group and all'))} ${state.rows.filter((r) => r.group === group.id).length} ${pick('条人力明细？（包括筛选隐藏的行）', 'HR rows? (Including filtered-out rows)')}</span>${btn(pick('确认删除', 'Confirm delete'), 'confirm-delete-group', false, '', `data-id="${esc(group.id)}"`)}${btn(pick('取消', 'Cancel'), 'cancel-delete-group')}</div>` : ''}</td></tr>`;
    if (!grouped || !collapsed.has(group.id))
      body += rows.map(rowHtml).join('');
  }
  return (
    heading(
      '成本录入',
      '组头管理 Group 与 Category；明细只录入工作内容、资源与工作量。',
      btn('保存演示', 'save', false, 'check') +
        btn('导出示例 CSV', 'export', true, 'download'),
    ) +
    ratesView(state) +
    travelView(state, data().snapshot) +
    inputSummaryView(data().snapshot) +
    `<section class="sheet"><div class="toolbar"><div class="segments" aria-label="成本年份">${[0, 1, 2, 3, 4, 'all'].map((y) => `<button class="segment" data-action="year" data-value="${y}" aria-pressed="${year === String(y)}">${y === 'all' ? 'All years' : `Y${Number(y) + 1}`}</button>`).join('')}</div>${btn('添加行', 'add-row', false, 'plus')}${btn('添加组', 'add-group', false, 'plus')}<span class="grow"></span><div class="segments" aria-label="录入模式"><button class="segment" data-action="basis" data-value="md" aria-pressed="${basis === 'md'}">Direct MD</button><button class="segment" data-action="basis" data-value="sites" aria-pressed="${basis === 'sites'}">Sites × MD</button></div><div class="segments" aria-label="表格分组"><button class="segment" data-action="grouped" data-value="true" aria-pressed="${grouped}">按组</button><button class="segment" data-action="grouped" data-value="false" aria-pressed="${!grouped}">平铺</button></div></div>${columnsMenu}${table(headers, body, 'cost-table')}<div class="sheet-footer"><span>${visible.length} 条明细</span><span>${year === 'all' ? '全部年度' : `Y${Number(year) + 1}`} · <strong>${visible.reduce((s, r) => s + rowMd(r), 0)} MD</strong></span><span class="grow"></span><span>人力成本 <strong>SGD ${money(visible.reduce((s, r) => s + visibleCost(r), 0))}</strong></span><a class="text-button" href="#summary">查看含 EHS / 风险的汇总 ${svg('arrow')}</a></div></section>`
  );
}
function projectsView() {
  const rows = state.projects.filter(rowMatch);
  return (
    heading(
      '项目列表',
      '项目信息直接编辑；选择“打开”进入工作表。',
      btn('新建示例项目', 'new-project', true, 'plus'),
    ) +
    `<section class="sheet"><div class="toolbar">${search()}${badge(`${state.projects.length} 个项目`, 'info')}<span class="toolbar-note">此版本演示共享工作表与项目基础资料编辑</span></div>${table(
      [
        { label: '项目名称', cls: 'c-description' },
        { label: '客户', cls: 'c-medium' },
        { label: '负责人', cls: 'c-short' },
        { label: '当前阶段', cls: 'c-code' },
        { label: '成本 / SGD', cls: 'c-number' },
        { label: '报价 / SGD', cls: 'c-number' },
        { label: '下一截止日', cls: 'c-code' },
        { label: '操作', cls: 'c-short' },
      ],
      rows
        .map(
          (r) =>
            `<tr>${cellInput('projects', r.id, 'name', r.name)}${cellInput('projects', r.id, 'client', r.client)}${cellInput('projects', r.id, 'owner', r.owner)}<td>${badge(r.stage, 'info')}</td><td class="num">${money((live ? r.id === state._source.project.id : r.id === 'PRJ-2027-018') ? totalCost() : r.cost)}</td><td class="num">${money((live ? r.id === state._source.project.id : r.id === 'PRJ-2027-018') ? (live ? reviewPricing(state, data()).quoteAfterTax : pricing().reduce((s, r) => s + r.net, 0)) : r.quote)}</td>${cellInput('projects', r.id, 'due', r.due)}<td><button class="text-button" data-action="open-project" data-name="${esc(r.name)}" data-project-id="${esc(r.id)}">打开</button></td></tr>`,
        )
        .join(''),
    )}<div class="sheet-footer">${state.projects.length} 个示例项目<span class="grow"></span>项目名称、客户、负责人均支持原位编辑</div></section>`
  );
}
function todayView() {
  if (live) return liveTodayView(live.index, engine);
  return (
    heading(
      '今日工作',
      '先处理需要你行动的事项，再进入项目。',
      `<span class="muted small">2027 / 01 / 12 · 星期二</span>`,
    ) +
    `<section class="panel"><div class="metrics"><div class="metric"><span>待我处理</span><strong>4</strong></div><div class="metric"><span>本周交付</span><strong>2</strong></div><div class="metric"><span>进行中项目</span><strong>3</strong></div><span class="grow"></span><a class="text-button" href="#projects">全部项目 ${svg('arrow')}</a></div>${table(
      [
        { label: '需要处理', cls: 'c-description' },
        { label: '项目', cls: 'c-note' },
        { label: '截止', cls: 'c-code' },
        { label: '优先级', cls: 'c-short' },
        { label: '', cls: 'c-code' },
      ],
      [
        ['核对人力与分包成本', projectName, '今天', '优先', 'cost'],
        ['补齐商务报价说明', '区域设备维保', '01 / 14', '常规', 'quote'],
        ['登记技术评审结果', '数据中心迁移', '01 / 15', '常规', 'workflow'],
        ['更新维保 BOQ 数量', '区域设备维保', '01 / 16', '常规', 'maintenance'],
      ]
        .map(
          (r) =>
            `<tr><td>${r[0]}</td><td data-user-content>${r[1]}</td><td>${r[2]}</td><td>${badge(r[3], r[3] === '优先' ? 'warning' : 'neutral')}</td><td><a class="text-button" href="#${r[4]}">去处理 ${svg('arrow')}</a></td></tr>`,
        )
        .join(''),
    )}</section><div class="split"><section class="panel"><div class="panel-head"><h2>最近工作</h2></div>${[
      ['成本录入', '已保存 8 条工作明细', 'cost'],
      ['定价与报价', '3 个 Category 已生成报价', 'quote'],
      ['项目文件', '实施范围与交付清单', 'files'],
    ]
      .map(
        (r) =>
          `<a href="#${r[2]}" class="list-item">${svg('file')}<div class="list-text"><strong>${r[0]}</strong><p>${r[1]}</p></div><span class="muted">进入 →</span></a>`,
      )
      .join(
        '',
      )}</section><section class="panel"><div class="panel-head"><h2>交付检查</h2></div>${[
      ['范围已确认', 'success'],
      ['成本版本待确认', 'warning'],
      ['报价说明待补充', 'warning'],
    ]
      .map((r) => `<div class="list-item">${badge(r[0], r[1])}</div>`)
      .join(
        '',
      )}<a class="list-item subtle-link" href="#workflow">打开完整流程 →</a></section></div>`
  );
}
function workflowView() {
  if (live)
    return liveWorkflowView(state, live.expandedTask, live.workflowReasons);
  return (
    heading(
      '项目流程',
      '进度、责任人、截止日和跟进备注直接在表格内维护。',
      btn('保存演示', 'save', true, 'check'),
    ) +
    `<section class="sheet"><div class="toolbar">${badge(`${state.tasks.filter((t) => t.status === '已完成').length} / ${state.tasks.length} 已完成`, 'success')}<span class="muted small">当前关注：人力与分包评估</span><span class="grow"></span>${btn('添加事项', 'add-task', false, 'plus')}</div>${table(
      [
        { label: '#', cls: 'c-index' },
        { label: '流程节点', cls: 'c-note' },
        { label: '状态', cls: 'c-code' },
        { label: '负责人', cls: 'c-code' },
        { label: '截止日期', cls: 'c-medium' },
        { label: '跟进备注', cls: 'c-description' },
        { label: '关联工作', cls: 'c-code' },
      ],
      state.tasks
        .map(
          (r, i) =>
            `<tr><td class="row-index">${i + 1}</td><td>${esc(r.name)}</td><td class="edit">${select('tasks', r.id, 'status', r.status, ['待处理', '进行中', '已完成'])}</td>${cellInput('tasks', r.id, 'owner', r.owner)}${cellInput('tasks', r.id, 'due', r.due, 'date')}${cellInput('tasks', r.id, 'note', r.note)}<td><a class="text-button" href="#${i < 4 ? 'cost' : 'quote'}">${i < 4 ? '成本工作表' : '报价工作表'}</a></td></tr>`,
        )
        .join(''),
    )}<div class="sheet-footer">状态与跟进记录独立于成本金额；所有修改均为示例。</div></section>`
  );
}
function subconView() {
  return subcontractView(state, data(), subconTab, catalogOpen);
}
function summaryView() {
  return renderSummary(state, data(), summaryTab);
}
function quoteView() {
  return live
    ? liveQuoteView(state, data(), quotePreview)
    : pricingView(state, data(), reviewPricing(state, data()), quotePreview);
}
function cpqView() {
  return renderCpq(state, data(), currentVersion, cpqError);
}
function maintenanceView() {
  let calculation,
    error = '';
  try {
    calculation = engine.calculateComponentMaintenance({
      startYear: state.maintenanceSettings.startYear,
      coverageMonths: 12,
      archives: [],
      boq: state.maintenance.map((r) => ({
        ...r,
        quantity: r.qty,
        durationYears: r.years,
        unitAnnualQuote: r.ct,
      })),
    });
  } catch (e) {
    error = e.message;
  }
  return (
    heading(
      '维保报价',
      '设备数量、CT、SPMS 与服务年限在同一行完成。',
      btn('添加设备', 'add-maintenance', true, 'plus'),
    ) +
    `${error ? `<div class="validation" role="alert">${esc(error)}</div>` : ''}<section class="sheet"><div class="toolbar">${search()}<label class="inline-field small-field"><span>${pick('开始年', 'Start year')}</span>${input('maintenanceSettings', 'project', 'startYear', state.maintenanceSettings.startYear, 'number')}</label><span class="toolbar-note">年费 =（CT + SPMS）× 设备数量</span></div>${table(
      [
        { label: '设备 / 型号', cls: 'c-medium' },
        { label: '服务说明', cls: 'c-description' },
        { label: '设备数量', cls: 'c-short' },
        { label: 'CT / SGD', cls: 'c-number' },
        { label: 'SPMS / SGD', cls: 'c-number' },
        { label: '年限', cls: 'c-short' },
        { label: '年费 / SGD', cls: 'c-number' },
        { label: '总报价 / SGD', cls: 'c-number' },
        { label: pick('单位', 'Unit'), cls: 'c-short' },
        { label: pick('SLA / 站点', 'SLA / site'), cls: 'c-medium' },
        { label: pick('备注', 'Remark'), cls: 'c-description' },
      ],
      state.maintenance
        .filter(rowMatch)
        .map(
          (r) =>
            `<tr>${cellInput('maintenance', r.id, 'model', r.model)}${cellInput('maintenance', r.id, 'description', r.description)}${cellInput('maintenance', r.id, 'qty', r.qty, 'number')}${cellInput('maintenance', r.id, 'ct', r.ct, 'number')}${cellInput('maintenance', r.id, 'spms', r.spms, 'number')}${cellInput('maintenance', r.id, 'years', r.years, 'number')}<td class="num">${money((r.ct + r.spms) * r.qty)}</td><td class="num">${money(calculation?.lines.find((l) => l.boq.id === r.id)?.quote)}</td>${cellInput('maintenance', r.id, 'unit', r.unit || 'pcs')}${cellInput('maintenance', r.id, 'site', r.site || '')}${cellInput('maintenance', r.id, 'remark', r.remark || '')}</tr>`,
        )
        .join(''),
    )}<div class="sheet-footer">${state.maintenance.length} 项设备<span class="grow"></span>维保总报价 <strong>SGD ${money(calculation?.quote)}</strong></div>${calculation ? table([pick('年度', 'Year'), pick('年度金额 / SGD', 'Annual amount / SGD')], calculation.annual.map((y) => `<tr><td>${y.year}</td><td class="num">${money(y.total)}</td></tr>`).join('')) : ''}</section>`
  );
}
function draftsView() {
  if (live) return live.draft.view();
  return (
    heading(
      '测算草稿',
      '独立试算区域，确认后再录入项目成本。',
      btn('添加测算行', 'add-draft', true, 'plus'),
    ) +
    `<section class="sheet"><div class="toolbar">${badge('独立草稿', 'neutral')}<span class="notice">当前草稿不计入成本与报价汇总。</span></div>${table(
      [
        { label: '#', cls: 'c-index' },
        { label: '测算事项', cls: 'c-description' },
        { label: '数量', cls: 'c-number' },
        { label: '参考单价 / SGD', cls: 'c-medium' },
        { label: '测算金额 / SGD', cls: 'c-medium' },
      ],
      state.drafts
        .map(
          (r, i) =>
            `<tr><td>${i + 1}</td>${cellInput('drafts', r.id, 'description', r.description)}${cellInput('drafts', r.id, 'qty', r.qty, 'number')}${cellInput('drafts', r.id, 'price', r.price, 'number')}<td class="num">${money(r.qty * r.price)}</td></tr>`,
        )
        .join(''),
    )}<div class="sheet-footer">独立试算合计<span class="grow"></span><strong>SGD ${money(state.drafts.reduce((s, r) => s + engine.roundMoney(r.qty * r.price), 0))}</strong></div></section>`
  );
}
function filesView() {
  return (
    renderFiles(state, fileFilters) +
    (live?.uploadQueue.some((i) => !i.done)
      ? `<div class="validation">${live.uploadQueue
          .filter((i) => !i.done)
          .map((i) => esc(i.file.name + ': ' + i.error))
          .join(
            '<br>',
          )}${btn(pick('重试未完成上传', 'Retry uploads'), 'live-upload-retry')}</div>`
      : '')
  );
}
const masterTabs = [
  ['resources', '资源费率'],
  ['catalog', '分包目录'],
  ['cpq', 'CPQ 目录'],
  ['assumptions', '风险假设'],
  ['templates', '报价模板'],
  ['share', 'BU 分成'],
  ['workflow', '流程模板'],
  ['history', '维保历史'],
  ['supplemental', '补充费用'],
  ['service-history', '服务报价历史'],
  ['project-tags', '项目标签'],
  ['status', '状态节点'],
];
function masterView() {
  if (live)
    return (
      liveMasterView(live.master, masterTab, masterTabs) +
      (live.publishPreview
        ? `<section class="sheet"><div class="toolbar">${pick('发布影响预览：保留已完成节点及历史，更新未完成节点。', 'Publication impact: retain completed steps/history and update unfinished steps.')}${btn(pick('确认发布', 'Confirm publication'), 'live-workflow-publish', true)}</div>${table([pick('项目', 'Project'), pick('更新 / 保留', 'Changes / retained'), pick('阻碍', 'Blockers'), pick('重算进行中 SLA', 'Recalculate active SLA')], live.publishPreview.projects.map((p) => `<tr><td>${esc(p.name)}</td><td>${[...p.changes, ...p.retained].map(esc).join('<br>')}</td><td>${p.blockers.map(esc).join('<br>')}</td><td><input type="checkbox" data-extra-migrate="${esc(p.projectId)}" ${(live.migrateIds || []).includes(p.projectId) ? 'checked' : ''} ${p.completed ? 'disabled' : ''}></td></tr>`).join(''))}</section>`
        : '')
    );
  let heads, body;
  if (masterTab === 'resources') {
    heads = [
      { label: '资源编码', cls: 'c-medium' },
      { label: '资源名称', cls: 'c-description' },
      { label: 'BU', cls: 'c-code' },
      { label: '日费率 / SGD', cls: 'c-medium' },
    ];
    body = state.resources
      .map(
        (r) =>
          `<tr>${cellInput('resources', r.id, 'code', r.code)}${cellInput('resources', r.id, 'name', r.name)}<td class="edit">${select('resources', r.id, 'bu', r.bu, live ? [...new Set([...state.rows.map((r) => r.bu), ...state.businessUnits].filter(Boolean))] : ['FBB', 'MBB'])}</td>${cellInput('resources', r.id, 'rate', r.rate, 'number')}</tr>`,
      )
      .join('');
  } else if (masterTab === 'supplemental') {
    heads = [
      pick('费用描述', 'Cost description'),
      pick('科目', 'Account'),
      pick('单位', 'Unit'),
      pick('参考单价', 'Reference price'),
    ];
    body = state.supplemental
      .map(
        (r) =>
          `<tr>${cellInput('supplemental', r.id, 'description', r.description)}<td>${esc(r.account)}</td>${cellInput('supplemental', r.id, 'unit', r.unit)}${cellInput('supplemental', r.id, 'price', r.price, 'number')}</tr>`,
      )
      .join('');
  } else if (masterTab === 'service-history') {
    heads = [
      pick('项目 / 客户', 'Project / client'),
      pick('报价版本', 'Quote version'),
      pick('日期', 'Date'),
      pick('成本', 'Cost'),
      pick('报价', 'Quote'),
      pick('结果 / 来源', 'Outcome / source'),
    ];
    body = `<tr><td colspan="6" class="empty">${pick('没有示例历史记录。正式版需保留原服务报价快照、手工参考及查询/导入。', 'No sample history. Production retains service quote snapshots, manual references, search and import.')}</td></tr>`;
  } else if (masterTab === 'project-tags') {
    heads = [pick('标签', 'Tag'), pick('启用', 'Active')];
    body = state.projectTags
      .map(
        (r) =>
          `<tr>${cellInput('projectTags', r.id, 'name', r.name)}<td><input type="checkbox" aria-label="Active ${esc(r.name)}" data-collection="projectTags" data-id="${r.id}" data-field="active" ${r.active ? 'checked' : ''}></td></tr>`,
      )
      .join('');
  } else if (masterTab === 'status') {
    heads = [pick('状态名称', 'Status name'), pick('说明', 'Description')];
    body = state.statusNodes
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td><td>${pick('兼容目录；项目进度由流程维护，不形成第二套状态。', r.description)}</td></tr>`,
      )
      .join('');
  } else if (masterTab === 'catalog') {
    heads = ['目录编码', '服务条目', '单位', '参考价格 / SGD'];
    body = state.subconCatalog
      .map(
        (r) =>
          `<tr><td>${r.code}</td><td>${r.description}</td><td>${r.unit}</td><td class="num">${money(r.price)}</td></tr>`,
      )
      .join('');
  } else if (masterTab === 'cpq') {
    heads = ['服务条目', '单位', '参考价格 / SGD'];
    body = state.cpq
      .map(
        (r) =>
          `<tr><td>${r.description}</td><td>${r.unit}</td><td class="num">${money(r.price)}</td></tr>`,
      )
      .join('');
  } else if (masterTab === 'assumptions') {
    heads = [
      { label: '假设主题', cls: 'c-note' },
      { label: '默认说明', cls: 'c-description' },
    ];
    body = state.assumptions
      .map(
        (r) =>
          `<tr>${cellInput('assumptions', r.id, 'name', r.name)}${cellInput('assumptions', r.id, 'text', r.text)}</tr>`,
      )
      .join('');
  } else if (masterTab === 'templates') {
    heads = ['模板', '适用客户', '有效期', '状态'];
    body = `<tr><td>标准服务报价</td><td>通用</td><td>30 天</td><td>${badge('已启用', 'success')}</td></tr><tr><td>年度维保报价</td><td>通用</td><td>30 天</td><td>${badge('已启用', 'success')}</td></tr>`;
  } else if (masterTab === 'share') {
    heads = ['BU', '分成口径', '费率'];
    body = state.profitShareRates
      .map(
        (r) =>
          `<tr><td>${esc(r.bu)}</td><td>报价收入</td>${cellInput('profitShareRates', r.id, 'ratePercent', r.ratePercent, 'number')}</tr>`,
      )
      .join('');
  } else if (masterTab === 'workflow') {
    heads = ['节点顺序', '流程名称', '默认负责角色'];
    body = state.tasks
      .map(
        (r, i) =>
          `<tr><td>${i + 1}</td><td>${r.name}</td><td>${i < 3 ? '方案与交付' : '商务'}</td></tr>`,
      )
      .join('');
  } else {
    heads = ['设备类别', '服务年限', '年度参考价格 / SGD'];
    body = state.maintenance
      .map(
        (r) =>
          `<tr><td>${r.model}</td><td>${r.years}</td><td class="num">${money(r.ct + r.spms)}</td></tr>`,
      )
      .join('');
  }
  return (
    heading(
      '主数据',
      '通用目录集中维护，项目采用快照，减少重复录入。',
      btn('保存演示', 'save', true, 'check'),
    ) +
    `<section class="sheet"><div class="toolbar"><div class="segments" aria-label="主数据库">${masterTabs.map(([id, label]) => `<button class="segment" data-action="master-tab" data-value="${id}" aria-pressed="${masterTab === id}">${label}</button>`).join('')}</div></div>${table(heads, body)}<div class="sheet-footer">${masterTabs.find((t) => t[0] === masterTab)[1]} · ${masterTab === 'resources' ? '费率修改不会自动覆盖当前项目快照。' : '目录页面展示可复用的信息结构。'}<span class="grow"></span>${masterTab === 'resources' ? btn('应用演示费率到成本', 'apply-rates') : ''}</div></section>`
  );
}
const renderers = {
  compare: () =>
    compareView(
      state,
      versions.map((v) =>
        v.code === currentVersion ? { ...v, snapshot: captureCost(state) } : v,
      ),
      currentVersion,
      compareVersion,
    ),
  audit: auditView,
  today: todayView,
  projects: projectsView,
  workflow: workflowView,
  cost: costView,
  subcon: subconView,
  summary: summaryView,
  quote: quoteView,
  cpq: cpqView,
  maintenance: maintenanceView,
  drafts: draftsView,
  files: filesView,
  master: masterView,
};
function render() {
  live?.features.detach();
  if (live) live.draft.detach();
  $('#save-status').textContent = live
    ? live.status
    : hasEdits
      ? '演示已更新'
      : '演示数据';
  if (live && !live.record) {
    $('#project-choice').innerHTML = '';
    $('#project-choice').disabled = true;
    $('#project-reference').textContent = '';
    renderNav();
    $('#main').innerHTML = creatingProject ? createProjectForm() : live.empty();
    configureLiveChrome();
    localize();
    return;
  }
  if (!renderers[route]) route = 'cost';
  $('#category-options').innerHTML = [
    ...new Set([
      ...categories,
      ...state.groups.map((g) => g.category),
      ...state.subcon.map((r) => r.category),
    ]),
  ]
    .filter(Boolean)
    .map((value) => `<option value="${esc(value)}"></option>`)
    .join('');
  $('#project-choice').disabled = Boolean(live?.busy);
  $('#project-choice').innerHTML = state.projects
    .map(
      (p) =>
        `<option value="${esc(live ? p.id : p.name)}" ${p.name === projectName ? 'selected' : ''}>${esc(p.name)}</option>`,
    )
    .join('');
  $('#project-reference').textContent =
    state.projects.find((p) => p.name === projectName)?.id || '';
  $('#folder-shortcuts').innerHTML = folderLinks(true);
  renderNav();
  $('#main').innerHTML =
    (creatingProject ? createProjectForm() : '') +
    (helpOpen
      ? `<div class="help"><p><strong>一套操作，贯穿全站。</strong> 点击单元格直接编辑；Tab 切换字段；组头两项使用同一个应用动作。${live ? pick('编辑自动保存；复杂设置明确确认后应用。', 'Edits save automatically; apply advanced changes explicitly.') : '页面切换保留演示输入，刷新恢复初始示例。'}</p>${btn('收起', 'help')}</div>`
      : '') +
    (['projects', 'workflow'].includes(route)
      ? projectInfoView(
          state.projects.find((p) => p.name === projectName),
          state.projectTags,
        )
      : '') +
    (costRoutes.includes(route)
      ? versionBar(versions, currentVersion, confirmingVersion)
      : '') +
    (live?.features.exclusive()
      ? live.features.view(route)
      : renderers[route]() + (live?.features.view(route) || ''));
  document.title = translate(
    `${titleFor(route)} · ${live ? '项目工作平台' : '全站设计审核'}`,
  );
  if (live) {
    configureLiveChrome();
    if (live.features.exclusive()) {
      $('#project-choice').disabled = true;
      const selector = $('#cost-version');
      if (selector) selector.disabled = true;
      document
        .querySelectorAll(
          '[data-action="version-copy"],[data-action="version-blank"],[data-action="version-confirm"]',
        )
        .forEach((el) => (el.disabled = true));
    }
  }
  localize();
  restorePanels();
  applyReviewLocks();
  if (live) void live.features.mount().catch((e) => live.error(e));
  if (live && route === 'drafts' && !live.features.exclusive())
    void live.draft.mount().catch((e) => live.error(e));
}
function patchChildren(target, source) {
  const next = Array.from(source.childNodes),
    previous = Array.from(target.childNodes);
  next.forEach((fresh, i) => {
    const old = previous[i];
    if (!old) {
      target.append(fresh.cloneNode(true));
      return;
    }
    if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName) {
      old.replaceWith(fresh.cloneNode(true));
      return;
    }
    if (old.nodeType === Node.TEXT_NODE) {
      if (old.textContent !== fresh.textContent)
        old.textContent = fresh.textContent;
      return;
    }
    for (const attr of Array.from(old.attributes))
      if (
        !fresh.hasAttribute(attr.name) &&
        !(old.tagName === 'DETAILS' && attr.name === 'open')
      )
        old.removeAttribute(attr.name);
    for (const attr of Array.from(fresh.attributes))
      if (old.getAttribute(attr.name) !== attr.value)
        old.setAttribute(attr.name, attr.value);
    patchChildren(old, fresh);
    if (old instanceof HTMLInputElement) {
      if (old !== document.activeElement) old.value = fresh.value;
      old.checked = fresh.checked;
    }
    if (old instanceof HTMLSelectElement && old !== document.activeElement)
      old.value = fresh.value;
  });
  previous.slice(next.length).forEach((node) => node.remove());
}
function renderInPlace() {
  if (live && !live.record) {
    render();
    return;
  }
  const temporary = document.createElement('main');
  temporary.innerHTML =
    (helpOpen ? $('#main .help')?.outerHTML || '' : '') +
    (['projects', 'workflow'].includes(route)
      ? projectInfoView(
          state.projects.find((p) => p.name === projectName),
          state.projectTags,
        )
      : '') +
    (costRoutes.includes(route)
      ? versionBar(versions, currentVersion, confirmingVersion)
      : '') +
    (live?.features.exclusive()
      ? live.features.view(route)
      : renderers[route]() + (live?.features.view(route) || ''));
  patchChildren($('#main'), temporary);
  if (live) {
    configureLiveChrome();
    if (live.features.exclusive()) {
      $('#project-choice').disabled = true;
      const selector = $('#cost-version');
      if (selector) selector.disabled = true;
      document
        .querySelectorAll(
          '[data-action="version-copy"],[data-action="version-blank"],[data-action="version-confirm"]',
        )
        .forEach((el) => (el.disabled = true));
    }
  }
  localize();
  restorePanels();
  applyReviewLocks();
}
async function change(event) {
  const el = event.target;
  if (live) {
    if (live.busy) return;
    try {
      if (el.id === 'project-choice') {
        void live.run(() => live.load(el.value));
        return;
      }
      if (el.id === 'cost-version') {
        void live.switchVersion(el.value);
        return;
      }
      if (el.id === 'review-file-upload') {
        void live.upload(el.files, fileFilters);
        return;
      }
      if (await live.features.input(el)) return;
      if (live.input(el)) return;
    } catch (e) {
      live.error(e);
      return;
    }
    if (!live.record) return;
    if (el.dataset.collection === 'archive') {
      state.archive[el.dataset.field] = el.value;
      return;
    }
  }
  if (el.dataset.projectTag) {
    const project = state.projects.find((p) => p.id === el.dataset.projectId);
    const tags = new Set(Array.isArray(project.tags) ? project.tags : []);
    if (el.checked) tags.add(el.dataset.projectTag);
    else tags.delete(el.dataset.projectTag);
    project.tags = [...tags];
    saved();
    return;
  }
  if (el.id === 'cost-version') {
    versions.find((v) => v.code === currentVersion).snapshot =
      captureCost(state);
    currentVersion = el.value;
    restoreCost(
      state,
      versions.find((v) => v.code === currentVersion).snapshot,
    );
    state.cpqWorkspace.draft.costVersion = currentVersion;
    confirmingVersion = false;
    render();
    return;
  }
  if (el.id === 'compare-version') {
    compareVersion = el.value;
    render();
    return;
  }
  if (
    costLocked() &&
    costRoutes.includes(route) &&
    (el.dataset.collection || el.dataset.setting)
  )
    return;
  if (el.id === 'review-file-upload') {
    addReviewFiles(el.files);
    return;
  }
  if (el.dataset.fileFilter) {
    fileFilters[el.dataset.fileFilter] = el.value;
    renderInPlace();
    return;
  }
  if (el.id === 'project-choice') {
    projectName = el.value;
    notify('已切换演示项目标题；各页共用同一组示例业务数据');
    renderInPlace();
    return;
  }
  if (el.dataset.setting) {
    const field = el.dataset.setting;
    if (field === 'quoteMode') {
      state.quoteMode = el.value;
      render();
      return;
    }
    const n = Number(el.value);
    if (!Number.isFinite(n) || n < 0) {
      notify('请输入有效的非负数字');
      return;
    }
    state[field] = n;
    saved();
    renderInPlace();
    return;
  }
  const collection = el.dataset.collection;
  if (!collection) return;
  const id = el.dataset.id,
    field = el.dataset.field;
  const nullablePrice =
    ['subcon', 'siteLines'].includes(collection) &&
    ['price', 'unitPrice'].includes(field) &&
    el.value === '';
  const value = nullablePrice
    ? null
    : el.type === 'checkbox'
      ? el.checked
      : el.type === 'number'
        ? Number(el.value)
        : el.value;
  const uplift =
    ['rateSettings', 'subconRates'].includes(collection) &&
    (field.startsWith('uplift') || field === 'defaultUplift');
  if (
    el.type === 'number' &&
    !nullablePrice &&
    (!Number.isFinite(value) ||
      value < (uplift ? -100 : 0) ||
      (uplift && value > 1000) ||
      (field === 'baseYear' &&
        (!Number.isInteger(value) || value < 2000 || value > 2200)) ||
      (field === 'trips' && !Number.isInteger(value)))
  ) {
    notify('请输入有效的非负数字');
    return;
  }
  if (collection === 'cpqSelect') {
    const ws = state.cpqWorkspace,
      item = ws.catalog.find((r) => r.code === id);
    ws.draft.selections = ws.draft.selections.filter((r) => r.code !== id);
    if (value)
      ws.draft.selections.push({
        code: id,
        quantity: item.referenceQty,
        locked: false,
        weight: 1,
        reason: 'Manual selection',
      });
  } else if (collection === 'cpqSelections') {
    state.cpqWorkspace.draft.selections.find((r) => r.code === id)[field] =
      value;
  } else if (collection === 'cpqDraft') {
    state.cpqWorkspace.draft[field] = value;
  } else if (['cpqMeta', 'maintenanceSettings'].includes(collection)) {
    state[collection][field] = value;
  } else if (collection === 'manual') {
    if (field === 'otherService')
      state.manual = engine.overrideOtherServiceCost(state.manual, value);
    else state.manual[field] = value;
  } else if (collection === 'risk')
    state.manual = engine.overrideCategoryRiskAmount(
      state.manual,
      data().categories.map((r) => ({ category: r.category, amount: r.risk })),
      id,
      value,
    );
  else if (
    ['rateSettings', 'subconRates', 'travelSettings', 'archive'].includes(
      collection,
    )
  ) {
    if (field.startsWith('uplift'))
      state[collection].annualUplifts[Number(field.slice(6))] = value;
    else state[collection][field] = value;
    if (field === 'defaultUplift')
      state[collection].annualUplifts = Array(5).fill(value);
  } else if (collection === 'sites') {
    const site = state.siteTypes.find((s) => s.id === id);
    if (field.startsWith('sites')) {
      if (!Number.isInteger(value)) return;
      site.sites[Number(field.slice(5))] = value;
    } else site[field] = value;
  } else if (collection === 'siteLines') {
    const [siteId, lineId] = id.split(':');
    const line = state.siteTypes
      .find((s) => s.id === siteId)
      .lines.find((l) => l.id === lineId);
    if (
      field === 'quantityPerSite' &&
      line.unit === 'pcs' &&
      !Number.isInteger(value)
    )
      return;
    line[field] = value;
  } else if (collection === 'allowance') {
    const pools = new Set(
      engine.getAllowancePools(
        state.rateSettings,
        data().snapshot.resourceTypes,
      ),
    );
    if (value) pools.add(id);
    else pools.delete(id);
    state.rateSettings.allowancePools = [...pools];
  } else if (
    ['prices', 'descriptions', 'sections', 'lineGp', 'discountShares'].includes(
      collection,
    )
  ) {
    if (collection === 'discountShares' && el.value === '')
      delete state.discountShares[id];
    else state[collection][id] = value;
  } else {
    const row = state[collection].find((r) => r.id === id);
    if (!row) return;
    if (
      collection === 'projects' &&
      field === 'name' &&
      row.name === projectName
    )
      projectName = value;
    const originalMd = row.mdSite;
    if (collection === 'subcon' && field.startsWith('qty')) {
      if (row.unit === 'pcs' && !Number.isInteger(value)) return;
      row.quantities ??= [row.qty, 0, 0, 0, 0];
      row.quantities[Number(field.slice(3))] = value;
    } else if (collection === 'rows' && /^year[0-4]$/.test(field)) {
      editDirectMandays(row, Number(field.slice(4)), value);
    } else row[field] = value;
    if (collection === 'rows' && field === 'resource')
      row.rate =
        state.resources.find((r) => r.name === value)?.rate || row.rate;
    if (collection === 'rows' && ['mdSite', 'sites'].includes(field)) {
      row.siteYears ??= row.years.map((md) =>
        originalMd ? md / originalMd : 0,
      );
      row.inputMode = 'sites';
      if (field === 'sites')
        row.siteYears[Number(year === 'all' ? 0 : year)] = value;
      row.years = row.siteYears.map((sites) => sites * row.mdSite);
    }
  }
  saved();
  renderInPlace();
}
function exportCsv() {
  if (route === 'quote' && !reviewPricing(state, data()).valid) {
    notify(pick('请先修正报价错误', 'Correct quotation errors first'));
    return;
  }
  const t = route === 'cost' ? $('#main .cost-table') : $('#main table');
  if (!t) {
    notify('当前页面没有可导出的表格');
    return;
  }
  const rows = Array.from(t.rows).map((r) =>
    Array.from(r.cells)
      .map((c) => {
        const input = c.querySelector('input,select');
        return (
          '"' +
          String(input ? input.value : c.textContent)
            .replaceAll('"', '""')
            .trim() +
          '"'
        );
      })
      .join(','),
  );
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + rows.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `设计审核_${titleFor(route)}_示例.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已导出示例 CSV；正式 Excel 导出在设计确认后接入');
}
document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action,
    id = el.dataset.id;
  if (live && action === 'master-tab') masterTab = el.dataset.value;
  if (live) {
    if (live.busy) return;
    try {
      if (await live.action(action, el)) return;
    } catch (e) {
      live.error(e);
      return;
    }
    if (!live.record) return;
  }
  if (
    costLocked() &&
    costRoutes.includes(route) &&
    [
      'add-row',
      'add-group',
      'delete-row',
      'row-up',
      'group-up',
      'group-down',
      'delete-group',
      'confirm-delete-group',
      'apply-group',
      'copy-group',
      'reset-uplifts',
      'enable-subcon-rates',
      'add-site',
      'copy-site',
      'delete-site',
      'delete-subcon',
      'catalog-add',
      'reset-risk',
      'reset-ehs',
    ].includes(action)
  )
    return;
  switch (action) {
    case 'version-confirm':
      confirmingVersion = true;
      break;
    case 'version-cancel':
      confirmingVersion = false;
      break;
    case 'version-lock':
      versions.find((v) => v.code === currentVersion).confirmed = true;
      versions.find((v) => v.code === currentVersion).snapshot =
        captureCost(state);
      confirmingVersion = false;
      break;
    case 'version-copy':
    case 'version-blank': {
      versions.find((v) => v.code === currentVersion).snapshot =
        captureCost(state);
      if (action === 'version-blank') {
        state.rows = [];
        state.groups = [
          { id: 'g1', name: pick('未分组', 'Unassigned Group'), category: '' },
        ];
        state.subcon = [];
        state.siteTypes = [];
        state.manual = { ...structuredClone(seed.manual), riskContingency: 0 };
      }
      currentVersion = 'V' + (versions.length + 1);
      versions.push({
        code: currentVersion,
        confirmed: false,
        snapshot: captureCost(state),
      });
      state.cpqWorkspace.draft.costVersion = currentVersion;
      confirmingVersion = false;
      break;
    }
    case 'cpq-confirm':
      try {
        state.cpqWorkspace = engine.confirmMapping(
          state.cpqWorkspace,
          state.cpqMeta.confirmer,
        );
        cpqError = '';
      } catch (error) {
        cpqError = error.message;
      }
      break;
    case 'cpq-baseline':
      state.cpqWorkspace.draft.targetCost = data().total;
      state.cpqWorkspace.draft.targetBasis = pick(
        '当前含风险成本',
        'Current total cost with risk',
      );
      break;
    case 'cpq-solve':
      try {
        state.cpqWorkspace.draft.result = engine.solveCpq(
          state.cpqWorkspace,
          cpqBaseline(data(), currentVersion, state),
        );
        cpqError = '';
      } catch (error) {
        cpqError = error.message;
      }
      break;
    case 'reset-uplifts':
      state[el.dataset.value].annualUplifts = Array(5).fill(
        state[el.dataset.value].defaultUplift,
      );
      saved();
      break;
    case 'enable-subcon-rates':
      state.subconRates = {
        baseYear: engine.getY1Year(state.rateSettings) || 2027,
        defaultUplift: 0,
        annualUplifts: [0, 0, 0, 0, 0],
      };
      break;
    case 'subcon-tab':
      subconTab = el.dataset.value;
      catalogOpen = false;
      break;
    case 'subcon-catalog':
      catalogOpen = !catalogOpen;
      break;
    case 'add-site': {
      const site = {
        id: 'site' + Date.now(),
        name: pick('新站型', 'New site type'),
        sites: [0, 0, 0, 0, 0],
        lines: [],
      };
      state.siteTypes.push(site);
      subconTab = site.id;
      catalogOpen = true;
      break;
    }
    case 'copy-site': {
      const site = structuredClone(state.siteTypes.find((s) => s.id === id));
      site.id = 'site' + Date.now();
      site.name += ' · Copy';
      site.sites = [0, 0, 0, 0, 0];
      site.lines = site.lines.map((line) => ({
        ...line,
        id: crypto.randomUUID(),
      }));
      state.siteTypes.push(site);
      subconTab = site.id;
      break;
    }
    case 'catalog-add': {
      const item = structuredClone(
        state.subconCatalog.find((r) => r.id === id),
      );
      const site = state.siteTypes.find((s) => s.id === subconTab);
      if ((site?.lines || state.subcon).some((l) => l.code === item.code))
        return;
      const base = engine.copySubcontractCatalogLine({
        ...item,
        item: item.item ?? item.description,
        unitPrice: item.unitPrice ?? item.price ?? null,
        currency: item.currency || 'SGD',
      });
      if (site) site.lines.push({ ...base, quantityPerSite: 0 });
      else
        state.subcon.push({
          ...base,
          price: base.unitPrice,
          quantities: [0, 0, 0, 0, 0],
        });
      saved();
      break;
    }
    case 'language':
      setLanguage(el.dataset.language);
      render();
      return;
    case 'summary-tab':
      summaryTab = el.dataset.value;
      break;
    case 'reset-discount':
      state.discountShares = {};
      break;
    case 'menu':
      $('.app').classList.toggle('menu-open');
      return;
    case 'help':
      helpOpen = !helpOpen;
      break;
    case 'save':
      saved();
      notify('演示修改已保留在本页；未连接正式项目');
      return;
    case 'reset':
      hasEdits = false;
      for (const f of state.files) if (f.url) URL.revokeObjectURL(f.url);
      state = structuredClone(seed);
      currentVersion = 'V1';
      compareVersion = 'V1';
      confirmingVersion = false;
      versions = [
        { code: 'V1', confirmed: false, snapshot: captureCost(state) },
      ];
      subconTab = 'shared';
      catalogOpen = false;
      cpqError = '';
      collapsed.clear();
      notify('已恢复初始示例');
      break;
    case 'column-left': {
      const prefs = readGrid(state),
        order = [...(prefs.all || prefs.visible || [])],
        index = order.indexOf(id);
      if (
        index > 1 &&
        !/^Y[1-5]:/.test(id) &&
        !/^Y[1-5]:/.test(order[index - 1])
      )
        [order[index - 1], order[index]] = [order[index], order[index - 1]];
      writeGrid(state, { order });
      break;
    }
    case 'group-up':
    case 'group-down':
      pendingGroupDelete = null;
      if (moveCostGroup(state, id, action === 'group-up' ? -1 : 1)) saved();
      break;
    case 'delete-group':
      pendingGroupDelete = id;
      break;
    case 'cancel-delete-group':
      pendingGroupDelete = null;
      break;
    case 'confirm-delete-group':
      if (pendingGroupDelete !== id) return;
      if (removeCostGroup(state, id)) {
        collapsed.delete(id);
        saved();
      }
      pendingGroupDelete = null;
      break;
    case 'row-up': {
      const index = state.rows.findIndex((r) => r.id === id),
        group = state.rows[index]?.group;
      const before = state.rows
        .slice(0, index)
        .findLastIndex((r) => r.group === group);
      if (before >= 0) {
        [state.rows[index], state.rows[before]] = [
          state.rows[before],
          state.rows[index],
        ];
        saved();
      }
      break;
    }
    case 'year':
      year = el.dataset.value;
      if (year === 'all') basis = 'md';
      writeGrid(state, { year, basis });
      break;
    case 'basis':
      basis = el.dataset.value;
      if (year === 'all' && basis === 'sites') year = '0';
      writeGrid(state, { basis, year });
      notify(
        basis === 'sites'
          ? '以 Sites × MD 录入当前年度；修改后才重算该行'
          : '直接编辑年度人天',
      );
      break;
    case 'grouped':
      grouped = el.dataset.value === 'true';
      writeGrid(state, { grouped });
      break;
    case 'collapse':
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      break;
    case 'apply-group': {
      const name = document
          .querySelector(`[data-group-name="${id}"]`)
          .value.trim(),
        category = document
          .querySelector(`[data-group-category="${id}"]`)
          .value.trim();
      if (!name) {
        notify('请填写 Group 名称');
        return;
      }
      const g = state.groups.find((g) => g.id === id);
      g.name = name;
      g.category = category;
      const existing = state.groups.find(
        (other) =>
          other.id !== id && other.name === name && other.category === category,
      );
      if (existing) {
        state.rows.forEach((r) => {
          if (r.group === id) r.group = existing.id;
        });
        state.groups = state.groups.filter((other) => other.id !== id);
      }
      saved();
      notify('Group 与 Category 已应用到组内，汇总同步更新');
      break;
    }
    case 'copy-group': {
      const source = state.groups.find((g) => g.id === id),
        next = 'g' + Date.now();
      state.groups.push({ ...source, id: next, name: source.name + ' 副本' });
      state.rows
        .filter((r) => r.group === id)
        .forEach((r) =>
          state.rows.push({
            ...structuredClone(r),
            id: 'r' + Math.random().toString(36).slice(2),
            group: next,
          }),
        );
      notify('已复制整组，可直接修改组头与明细');
      break;
    }
    case 'add-group': {
      const id = 'g' + Date.now();
      state.groups.push({ id, name: '新分组', category: 'Mandatory' });
      state.rows.push({
        id: 'r' + Date.now(),
        group: id,
        scope: '新工作内容',
        bu: live ? state.rows[0]?.bu || state.businessUnits[0] || '' : 'FBB',
        resource: live ? state.resources[0]?.id || '' : 'Local L3',
        rate: live ? state.resources[0]?.rate || 0 : 480,
        mdSite: 1,
        sites: 1,
        years: [0, 0, 0, 0, 0],
      });
      break;
    }
    case 'add-row':
      state.rows.push({
        id: 'r' + Date.now(),
        group: state.groups.at(-1)?.id || 'group-0',
        scope: '新工作内容',
        bu: live ? state.rows[0]?.bu || state.businessUnits[0] || '' : 'FBB',
        resource: live ? state.resources[0]?.id || '' : 'Local L3',
        rate: live ? state.resources[0]?.rate || 0 : 480,
        mdSite: 1,
        sites: 1,
        years: [0, 0, 0, 0, 0],
      });
      collapsed.delete(state.groups.at(-1).id);
      break;
    case 'delete-row':
      state.rows = state.rows.filter((r) => r.id !== id);
      notify(
        live
          ? pick('已移除成本行', 'Cost row removed')
          : '已移除示例行；使用“重置演示”可恢复',
      );
      break;
    case 'add-subcon':
      state.subcon.push({
        id: 's' + Date.now(),
        code: 'SC-NEW',
        description: '新分包条目',
        category: 'Mandatory',
        bu: live ? state.rows[0]?.bu || state.businessUnits[0] || '' : 'FBB',
        unit: 'lot',
        price: 0,
        qty: 1,
      });
      break;
    case 'delete-subcon': {
      const site = state.siteTypes.find((s) => s.id === el.dataset.site);
      if (site) site.lines = site.lines.filter((r) => r.id !== id);
      else state.subcon = state.subcon.filter((r) => r.id !== id);
      break;
    }
    case 'delete-site':
      state.siteTypes = state.siteTypes.filter((s) => s.id !== id);
      subconTab = 'shared';
      break;
    case 'add-maintenance':
      state.maintenance.push({
        id: 'm' + Date.now(),
        model: '新设备',
        description: '服务说明',
        qty: 1,
        ct: 0,
        spms: 0,
        years: 1,
      });
      break;
    case 'add-draft':
      state.drafts.push({
        id: 'd' + Date.now(),
        description: '新测算事项',
        qty: 1,
        price: 0,
      });
      break;
    case 'add-task':
      state.tasks.push({
        id: 't' + Date.now(),
        name: '补充跟进事项',
        owner: '林嘉',
        due: '2027-01-20',
        status: '待处理',
        note: '',
      });
      break;
    case 'reset-risk':
      state.manual.categoryRiskWeights = [];
      notify('风险总额已保留，并按各 Category 成本重新分摊');
      break;
    case 'reset-ehs':
      state.manual.otherServiceRate = 0.01;
      notify(
        pick(
          '其他服务成本恢复为 1%；汽车费保持原值',
          'Other Service Costs reset to 1%; Car Fee retained',
        ),
      );
      break;
    case 'preview':
      if (!reviewPricing(state, data()).valid) return;
      quotePreview = !quotePreview;
      break;
    case 'master-tab':
      masterTab = el.dataset.value;
      break;
    case 'folder':
      fileFilters = {
        folder: el.dataset.value,
        category: 'all',
        version: '',
        node: '',
        deleteId: '',
      };
      location.hash = 'files';
      break;
    case 'file-location': {
      const file = state.files.find((f) => f.id === id);
      fileFilters = {
        folder: folderFor(file.category),
        category: 'all',
        version: '',
        node: file.node || '',
        deleteId: '',
      };
      break;
    }
    case 'file-delete':
      fileFilters.deleteId = id;
      break;
    case 'file-delete-cancel':
      fileFilters.deleteId = '';
      break;
    case 'file-delete-confirm': {
      const f = state.files.find((f) => f.id === id);
      if (f?.url) URL.revokeObjectURL(f.url);
      state.files = state.files.filter((f) => f.id !== id);
      fileFilters.deleteId = '';
      break;
    }
    case 'file-download': {
      const f = state.files.find((f) => f.id === id);
      if (!f?.url) return;
      const link = document.createElement('a');
      link.href = f.url;
      link.download = f.name;
      link.click();
      return;
    }

    case 'apply-rates':
      if (costLocked()) {
        notify(
          pick(
            '当前成本版本已锁定，请先复制 Draft',
            'Current cost version is locked; copy a draft first',
          ),
        );
        return;
      }
      state.rows.forEach((r) => {
        r.rate =
          state.resources.find((x) => x.name === r.resource)?.rate || r.rate;
      });
      notify('已将演示费率应用到成本行');
      break;
    case 'open-project':
      projectName = el.dataset.name;
      $('#project-choice').value = projectName;
      location.hash = 'cost';
      return;
    case 'new-project':
      state.projects.push({
        id: 'PRJ-' + Date.now(),
        name: '新项目',
        client: '待填写',
        owner: '林嘉',
        stage: '准备中',
        cost: 0,
        quote: 0,
        due: '待安排',
      });
      filter = '';
      notify('已添加示例项目，请直接编辑名称与客户');
      break;
    case 'export':
      exportCsv();
      return;
  }
  if (
    live &&
    [
      'apply-group',
      'copy-group',
      'add-group',
      'add-row',
      'delete-row',
      'add-subcon',
      'add-maintenance',
      'catalog-add',
      'add-site',
      'copy-site',
      'delete-site',
      'delete-subcon',
      'cpq-confirm',
      'cpq-solve',
      'cpq-baseline',
      'reset-ehs',
      'reset-risk',
    ].includes(action)
  )
    saved();
  render();
});
document.addEventListener('change', (event) => {
  if (event.target.dataset.gridColumn) {
    const id = event.target.dataset.gridColumn,
      prefs = readGrid(state),
      hidden = new Set(prefs.hidden || []);
    if (event.target.checked) hidden.delete(id);
    else hidden.add(id);
    writeGrid(state, { hidden: [...hidden] });
    render();
    return;
  }
  if (
    event.target.dataset.collection === 'rows' &&
    ['groupLabel', 'categoryLabel'].includes(event.target.dataset.field)
  ) {
    if (costLocked()) return;
    const row = state.rows.find((r) => r.id === event.target.dataset.id),
      group = state.groups.find((g) => g.id === row.group);
    const name =
      event.target.dataset.field === 'groupLabel'
        ? event.target.value
        : group.name;
    const category =
      event.target.dataset.field === 'categoryLabel'
        ? event.target.value
        : group.category;
    let target = state.groups.find(
      (g) => g.name === name && g.category === category,
    );
    if (!target) {
      target = { id: crypto.randomUUID(), name, category };
      state.groups.push(target);
    }
    row.group = target.id;
    saved();
    render();
    return;
  }
  void change(event);
});
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-extra-path],[data-extra-ai]')) {
    void change(event);
    return;
  }
  if (
    event.target.matches('[data-collection],[data-setting]') &&
    event.target.value !== '' &&
    !['groupLabel', 'categoryLabel'].includes(event.target.dataset.field)
  )
    void change(event);
});
document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Enter' &&
    event.target.matches('[data-group-name],[data-group-category]')
  ) {
    event.preventDefault();
    event.target
      .closest('.group-bar')
      .querySelector('[data-action="apply-group"]')
      .click();
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'table-search') {
    filter = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const field = $('#table-search');
    field.focus();
    field.setSelectionRange(cursor, cursor);
  }
});
window.addEventListener('hashchange', () => {
  route = location.hash.slice(1);
  if (live && route === 'master') void live.loadMaster(masterTab);
  filter = '';
  quotePreview = false;
  $('.app').classList.remove('menu-open');
  render();
});
render();
if (live) {
  void live.start();
  if (route === 'master') void live.loadMaster(masterTab);
}
window.addEventListener('beforeunload', (e) => {
  if (
    hasEdits ||
    live?.busy ||
    live?.draft.dirty ||
    live?.features.exclusive() ||
    live?.hasMasterEdits()
  ) {
    e.preventDefault();
  }
});

function addReviewFiles(files) {
  if (live) {
    void live.upload(files, fileFilters);
    return;
  }
  let rejected = false;
  for (const file of files || []) {
    if (file.size > 50 * 1024 * 1024) {
      rejected = true;
      continue;
    }
    const category =
      fileFilters.category !== 'all'
        ? fileFilters.category
        : fileFilters.folder === 'quotation'
          ? 'quote'
          : fileFilters.folder === 'cost'
            ? 'cost'
            : fileFilters.node
              ? 'workflow'
              : 'general';
    state.files.push({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      category,
      version: fileFilters.version || 'V1',
      node: fileFilters.node,
      url: URL.createObjectURL(file),
    });
  }
  notify(
    rejected
      ? pick('超过 50 MiB 的文件未加入', 'Files over 50 MiB were skipped')
      : pick(
          '文件已加入本页演示；未上传到正式项目',
          'Files added to review session, not uploaded to production',
        ),
  );
  renderInPlace();
}
document.addEventListener('dragover', (event) => {
  if (event.target.closest('[data-file-drop]')) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  if (event.target.closest('[data-file-drop]')) {
    event.preventDefault();
    addReviewFiles(event.dataTransfer.files);
  }
});

function applyReviewLocks() {
  document.querySelector('.project-strip .badge').textContent =
    currentVersion +
    ' · ' +
    (versions.find((v) => v.code === currentVersion)?.state ||
      (costLocked() ? 'Confirmed' : 'Draft'));
  if (!costLocked() || !costRoutes.includes(route)) return;
  for (const input of document.querySelectorAll(
    '#main [data-collection],#main [data-setting],#main [data-group-name],#main [data-group-category]',
  ))
    input.disabled = true;
  const mutations = [
    'row-up',
    'group-up',
    'group-down',
    'delete-group',
    'confirm-delete-group',
    'add-row',
    'add-group',
    'delete-row',
    'apply-group',
    'copy-group',
    'reset-uplifts',
    'enable-subcon-rates',
    'add-site',
    'copy-site',
    'delete-site',
    'delete-subcon',
    'catalog-add',
    'reset-risk',
    'reset-ehs',
  ];
  for (const button of document.querySelectorAll('#main [data-action]'))
    if (mutations.includes(button.dataset.action)) button.disabled = true;
}

function createProjectForm() {
  return `<section class="panel"><div class="toolbar">${['id', 'name', 'client'].map((k) => `<label class="inline-field"><span>${esc(k)}</span><input data-new-project="${k}" aria-label="New project ${k}"></label>`).join('')}${btn(pick('创建项目', 'Create project'), 'live-create', true)}</div></section>`;
}
function configureLiveChrome() {
  document.querySelectorAll('.toolbar-note,.sheet-footer').forEach((el) => {
    for (const child of el.childNodes)
      if (
        child.nodeType === 3 &&
        /审核版本仅|Review versions stay|示例项目|演示共享|目录页面展示/.test(
          child.textContent,
        )
      )
        child.textContent = pick(
          '数据保存在本地项目；版本与历史保留。',
          'Stored in the local project, with versions and history retained.',
        );
  });
  $('.brand small').textContent = pick('本地工作区', 'Local workspace');
  $('.review-note').innerHTML =
    `<span class="status-dot"></span>${pick('真实项目数据', 'Live project data')}<small>${esc(live.status)}</small>`;
  $('.app-footer').innerHTML =
    `<span>${pick('原项目数据与版本继续保留；修改后保存。', 'Existing projects and versions are retained. Save your changes.')}</span>${btn(pick('保存', 'Save'), 'save')}${btn(pick('下载未保存备份', 'Back up edits'), 'live-backup')}`;
  $('.avatar').textContent = '';
  const p = state.projects?.find(
    (p) => p.id === live.record?.workspace.project.id,
  );
  $('.project-person').textContent = p?.owner || '';
  $('#save-status').textContent = live.status;
  const words = {
    保存演示: pick('保存', 'Save'),
    '导出示例 CSV': pick('导出 Excel', 'Export Excel'),
    新建示例项目: pick('新建项目', 'New project'),
  };
  document.querySelectorAll('[data-action]').forEach((el) => {
    for (const child of el.childNodes)
      if (child.nodeType === 3 && words[child.textContent.trim()])
        child.textContent = words[child.textContent.trim()];
  });
  document.querySelectorAll('[data-collection="projects"]').forEach((el) => {
    if (
      el.dataset.id !== live.record?.workspace.project.id ||
      ['owner', 'due'].includes(el.dataset.field)
    )
      el.disabled = true;
  });
  document
    .querySelectorAll('[data-collection="rows"][data-field="resource"] option')
    .forEach((el) => {
      el.textContent =
        state.resources.find((r) => r.id === el.value)?.label || el.value;
    });
  document
    .querySelectorAll('.nav-count')
    .forEach(
      (el) =>
        (el.textContent = String(
          state.tasks?.filter(
            (t) => !['completed', 'skipped'].includes(t.state),
          ).length || 0,
        )),
    );
}
