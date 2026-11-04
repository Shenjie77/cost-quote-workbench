export let language =
  localStorage.getItem('review-language') === 'en' ? 'en' : 'zh';
export const pick = (zh, en) => (language === 'en' ? en : zh);
export function setLanguage(value) {
  language = value === 'en' ? 'en' : 'zh';
  localStorage.setItem('review-language', language);
}
const messages = {
  功能对照: 'Functional audit',
  版本对比: 'Version comparison',
  补充费用: 'Supplemental costs',
  服务报价历史: 'Service quote history',
  项目标签: 'Project tags',
  状态节点: 'Status nodes',

  删除: 'Delete',
  '基准费率 / SGD': 'Base rate / SGD',
  '目录条目、分类、单价与数量在同一张表中编辑。':
    'Edit catalog items, categories, unit prices and quantities in one table.',
  'Category 用于成本汇总与报价分类':
    'Category links cost reporting and quotation grouping',
  工作描述: 'Scope description',

  项目工作平台: 'Project Workbench',
  全站导航: 'Workspace navigation',
  工作空间: 'Workspace',
  当前项目: 'Current project',
  全局资源: 'Global resources',
  今日工作: 'Today',
  项目列表: 'Projects',
  项目流程: 'Workflow',
  成本录入: 'Cost input',
  分包成本: 'Subcontract',
  成本汇总: 'Cost summary',
  定价与报价: 'Pricing & quote',
  'CPQ 配置': 'CPQ setup',
  维保报价: 'Maintenance',
  测算草稿: 'Scratchpad',
  项目文件: 'Project files',
  主数据: 'Master data',
  工作平台: 'Workbench',
  独立审核原型: 'Design review',
  '示例数据 · 不连接正式项目': 'Sample data · No live connection',
  演示数据: 'Sample data',
  演示已更新: 'Demo updated',
  使用说明: 'Help',
  当前操作人: 'Current user',
  切换项目: 'Switch project',
  展开导航: 'Open navigation',
  '负责人 · 林嘉': 'Owner · Lin Jia',
  草稿: 'Draft',
  '交互审核版：修改仅影响当前演示，金额不作为正式报价依据。':
    'Design review: changes affect this demo only. Amounts are not formal quotations.',
  重置演示: 'Reset demo',
  保存演示: 'Save demo',
  '导出示例 CSV': 'Export sample CSV',
  全站设计审核: 'Design review',
  '组头管理 Group 与 Category；明细只录入工作内容、资源与工作量。':
    'Set Group and Category once per group. Enter scope, resources and effort in the rows.',
  'Scope / 工作内容': 'Scope',
  成本年份: 'Cost years',
  录入模式: 'Input mode',
  表格分组: 'Row grouping',
  添加行: 'Add row',
  添加组: 'Add group',
  按组: 'Grouped',
  平铺: 'Flat',
  应用组内: 'Apply to group',
  复制: 'Copy',
  资源类型: 'Resource type',
  '人天 / MD': 'Mandays',
  '费率 / SGD': 'Rate / SGD',
  '成本 / SGD': 'Cost / SGD',
  人天: 'MD',
  条明细: 'rows',
  全部年度: 'All years',
  人力成本: 'HR cost',
  '查看含 EHS / 风险的汇总': 'Cost summary with EHS / risk',
  展开或收起: 'Expand / collapse',
  删除成本行: 'Delete cost row',
  '搜索当前表格…': 'Search this table…',
  搜索当前页面: 'Search this page',
  没有匹配内容: 'No matching records',
  新分组: 'New group',
  新工作内容: 'New scope',
  副本: 'Copy',
  '项目信息直接编辑；选择“打开”进入工作表。':
    'Edit project details in place. Select Open to enter the worksheet.',
  新建示例项目: 'New demo project',
  此版本演示共享工作表与项目基础资料编辑:
    'Demo: shared worksheets and editable project metadata',
  '项目名称、客户、负责人均支持原位编辑':
    'Edit project names, clients and owners in place',
  项目名称: 'Project name',
  下一截止日: 'Next due',
  负责人: 'Owner',
  当前阶段: 'Stage',
  '报价 / SGD': 'Quote / SGD',
  操作: 'Action',
  打开: 'Open',
  客户: 'Client',
  个项目: 'projects',
  个示例项目: 'sample projects',
  准备中: 'Preparing',
  成本评估: 'Cost review',
  客户报价: 'Customer quote',
  技术评审: 'Technical review',
  新项目: 'New project',
  待填写: 'To complete',
  待安排: 'Unscheduled',
  '先处理需要你行动的事项，再进入项目。':
    'Start with the next action, then open the project.',
  待我处理: 'My actions',
  本周交付: 'Due this week',
  进行中项目: 'Active projects',
  全部项目: 'All projects',
  需要处理: 'Next action',
  截止: 'Due',
  优先级: 'Priority',
  去处理: 'Open task',
  最近工作: 'Recent work',
  交付检查: 'Delivery checks',
  范围已确认: 'Scope confirmed',
  成本版本待确认: 'Cost version to confirm',
  报价说明待补充: 'Quote notes to complete',
  打开完整流程: 'Open workflow',
  进入: 'Open',
  今天: 'Today',
  优先: 'High',
  常规: 'Normal',
  星期二: 'Tuesday',
  核对人力与分包成本: 'Review personnel and subcontract costs',
  补齐商务报价说明: 'Complete quotation notes',
  登记技术评审结果: 'Record technical review outcome',
  '更新维保 BOQ 数量': 'Update maintenance BOQ quantities',
  '已保存 8 条工作明细': '8 saved scope entries',
  '3 个 Category 已生成报价': '3 priced categories',
  实施范围与交付清单: 'Scope and delivery checklist',
  '进度、责任人、截止日和跟进备注直接在表格内维护。':
    'Maintain progress, owners, dates and notes directly in the table.',
  '当前关注：人力与分包评估': 'Current focus: personnel and subcontract review',
  添加事项: 'Add task',
  流程节点: 'Stage',
  状态: 'Status',
  责任人: 'Owner',
  截止日期: 'Due date',
  跟进备注: 'Follow-up note',
  关联工作: 'Related work',
  成本工作表: 'Cost worksheet',
  报价工作表: 'Quote worksheet',
  '状态与跟进记录独立于成本金额；所有修改均为示例。':
    'Progress records are separate from cost amounts. All edits are sample data.',
  已完成: 'Completed',
  进行中: 'In progress',
  待处理: 'Pending',
  '分包条目与数量直接编辑；所有费用归入对应 Category。':
    'Edit subcontract items and quantities; assign each to a Category.',
  添加分包: 'Add subcontract',
  添加条目: 'Add item',
  '数量 × 单价计入项目成本':
    'Quantity × unit price is included in project cost',
  编码: 'Code',
  描述: 'Description',
  单位: 'Unit',
  '单价 / SGD': 'Unit price / SGD',
  数量: 'Quantity',
  '金额 / SGD': 'Amount / SGD',
  分包合计: 'Subcontract total',
  删除分包: 'Delete subcontract',
  新分包条目: 'New subcontract item',
  '分包数量与单价直接编辑，成本汇总同步更新。':
    'Edit quantities and unit prices; the cost summary updates automatically.',
  '先选服务，再填数量，配置金额自动汇总。':
    'Select services and enter quantities; configuration amounts update automatically.',
  标准服务目录: 'Standard service catalog',
  '此处演示选配与数量计算，不写入正式成本。':
    'Selection and quantity demo; no changes to live project costs.',
  选用: 'Include',
  服务条目: 'Service item',
  '参考单价 / SGD': 'Reference price / SGD',
  '配置金额 / SGD': 'Amount / SGD',
  已选: 'Selected',
  项: 'items',
  配置金额: 'Configuration total',
  '设备数量、CT、SPMS 与服务年限在同一行完成。':
    'Enter equipment quantity, CT, SPMS and service term on one row.',
  添加设备: 'Add equipment',
  '年费 =（CT + SPMS）× 设备数量': 'Annual fee = (CT + SPMS) × quantity',
  '设备 / 型号': 'Equipment / model',
  服务说明: 'Service description',
  设备数量: 'Equipment quantity',
  年限: 'Years',
  '年费 / SGD': 'Annual fee / SGD',
  '总报价 / SGD': 'Total / SGD',
  维保总报价: 'Maintenance total',
  新设备: 'New equipment',
  项设备: 'equipment items',
  '独立试算区域，确认后再录入项目成本。':
    'Calculate separately; enter confirmed items into project costs.',
  添加测算行: 'Add calculation',
  独立草稿: 'Independent draft',
  '当前草稿不计入成本与报价汇总。':
    'This draft is not included in cost or quotation totals.',
  测算事项: 'Calculation item',
  '测算金额 / SGD': 'Amount / SGD',
  独立试算合计: 'Draft total',
  新测算事项: 'New calculation',
  '按业务归档，版本和当前状态直接可见。':
    'Browse archives by business area, with visible versions and status.',
  导出示例清单: 'Export sample index',
  文件分类: 'File category',
  全部文件: 'All files',
  '原型展示示例文件索引，不包含实际附件':
    'Sample file index; actual attachments are not included',
  文件名称: 'File name',
  归档分类: 'Category',
  更新时间: 'Updated',
  维护人: 'Owner',
  已确认: 'Confirmed',
  '文件索引示例 · 正式版将连接各项目归档。':
    'Sample index · Production connects to existing project archives.',
  '通用目录集中维护，项目采用快照，减少重复录入。':
    'Manage shared catalogs centrally; projects retain captured snapshots.',
  主数据库: 'Master data catalogs',
  资源费率: 'Resource rates',
  分包目录: 'Subcontract catalog',
  'CPQ 目录': 'CPQ catalog',
  风险假设: 'Risk assumptions',
  报价模板: 'Quote templates',
  'BU 分成': 'BU profit share',
  流程模板: 'Workflow templates',
  维保历史: 'Maintenance history',
  资源编码: 'Resource code',
  资源名称: 'Resource name',
  '日费率 / SGD': 'Daily rate / SGD',
  目录编码: 'Catalog code',
  '参考价格 / SGD': 'Reference price / SGD',
  假设主题: 'Assumption',
  默认说明: 'Default wording',
  模板: 'Template',
  适用客户: 'Applies to',
  有效期: 'Validity',
  标准服务报价: 'Standard service quotation',
  年度维保报价: 'Annual maintenance quotation',
  通用: 'General',
  已启用: 'Enabled',
  分成口径: 'Share basis',
  费率: 'Rate',
  报价收入: 'Quotation revenue',
  节点顺序: 'Order',
  流程名称: 'Stage name',
  默认负责角色: 'Default role',
  方案与交付: 'Solution & delivery',
  商务: 'Commercial',
  设备类别: 'Equipment class',
  服务年限: 'Service term',
  '年度参考价格 / SGD': 'Annual reference / SGD',
  '费率修改不会自动覆盖当前项目快照。':
    'Rate edits do not overwrite current project snapshots.',
  '目录页面展示可复用的信息结构。': 'Reusable catalog structures.',
  应用演示费率到成本: 'Apply demo rates to cost',
  请输入有效的非负数字: 'Enter a valid non-negative number',
  '演示修改已保留在本页；未连接正式项目':
    'Changes retained in this demo; no live project connection',
  已恢复初始示例: 'Initial sample restored',
  '请填写 Group 名称': 'Enter a Group name',
  'Group 与 Category 已应用到组内，汇总同步更新':
    'Group and Category applied; summaries updated',
  '已复制整组，可直接修改组头与明细':
    'Group copied; edit its header and rows directly',
  '已移除示例行；使用“重置演示”可恢复':
    'Sample row removed; Reset demo restores the initial rows',
  '风险总额已保留，并按各 Category 成本重新分摊':
    'Risk total retained and reallocated by pre-risk Category cost',
  已将演示费率应用到成本行: 'Demo rates applied to cost rows',
  '已添加示例项目，请直接编辑名称与客户':
    'Demo project added; edit its name and client',
  '已切换演示项目标题；各页共用同一组示例业务数据':
    'Demo project context changed; worksheets share sample data',
  '以 Sites × MD 录入当前年度；修改后才重算该行':
    'Enter Sites × MD for the selected year; edits recalculate that row',
  直接编辑年度人天: 'Edit annual mandays directly',
  当前页面没有可导出的表格: 'No table available to export',
  '已导出示例 CSV；正式 Excel 导出在设计确认后接入':
    'Sample CSV exported; production Excel integration follows design review',
  '一套操作，贯穿全站。': 'One interaction model across the site.',
  '点击单元格直接编辑；Tab 切换字段；组头两项使用同一个应用动作。页面切换保留演示输入，刷新恢复初始示例。':
    'Edit cells in place; Tab moves between fields. Apply Group and Category together. Navigation retains demo edits; refresh resets the sample.',
  收起: 'Close',
  项目: 'Project',
  成本: 'Cost',
  报价: 'Quote',
  流程: 'Workflow',
  维保: 'Maintenance',
  保存: 'Save',
  折扣: 'Discount',
  说明: 'Description',
  总计: 'Total',
  全部: 'All',
  人力: 'HR Cost',
  差旅: 'Travel',
  合作成本: 'Subcontract',
  结算: 'Settlement',
  汽车费: 'Car fee',
  未分类: 'Uncategorized',
  按比例重置: 'Reset proportions',
};
export function translate(value) {
  const text = String(value);
  if (language !== 'en') return text;
  const trimmed = text.trim();
  if (messages[trimmed]) return text.replace(trimmed, messages[trimmed]);
  // Translate interface templates only. User-entered names/notes are never substring-rewritten.
  const numberLabel = trimmed.match(
    /^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*(条明细|个示例项目|个项目|项设备|已完成|行|项)(.*)$/,
  );
  if (numberLabel)
    return `${numberLabel[1]} ${messages[numberLabel[2]] || { 行: 'rows', 条明细: 'rows', 个示例项目: 'sample projects', 个项目: 'projects', 项设备: 'equipment items', 项: 'items' }[numberLabel[2]]}${numberLabel[3]}`;
  for (const prefix of ['删除成本行', '展开或收起', '选用', '已选', '删除'])
    if (trimmed.startsWith(prefix + ' '))
      return messages[prefix] + ' ' + trimmed.slice(prefix.length + 1);
  if (text.includes(' · '))
    return text
      .split(' · ')
      .map((part) => translate(part))
      .join(' · ');
  return text;
}
const originals = new WeakMap();
export function localize(root = document.body) {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('script,style,[data-user-content]'))
      continue;
    const last = originals.get(node);
    const source =
      last && node.textContent === last.output ? last.source : node.textContent;
    const output = translate(source);
    originals.set(node, { source, output });
    node.textContent = output;
  }
  for (const el of root.querySelectorAll('[placeholder],[aria-label],[title]'))
    for (const key of ['placeholder', 'aria-label', 'title']) {
      if (el.closest('[data-user-content]')) continue;
      const value = el.getAttribute(key);
      if (value === null) continue;
      const source = el.getAttribute(`data-i18n-${key}`) || value;
      el.setAttribute(`data-i18n-${key}`, source);
      el.setAttribute(key, translate(source));
    }
  for (const button of document.querySelectorAll('[data-language]'))
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.language === language),
    );
}
