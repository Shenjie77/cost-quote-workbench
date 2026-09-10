'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ResourceType } from '@/features/cost/domain';
import { contentKey, type CatalogItem } from '@/features/cpq/domain';
import type {
  WorkflowStep,
  ProjectStatusDefinition,
} from '@/features/projects/types';
import type {
  QuoteTemplate,
  AssumptionDefinition,
} from '@/features/quote/types';
import type { MaintenancePriceRecord, SupplementalCostItem } from './domain';
import type { SubcontractItem } from './types';
import type { ProfitShareRate } from '@/features/quote/profit-share';
import { MasterDataView } from './master-data-view';
import { WorkflowPublishDialog } from './workflow-publish-dialog';
import type { MasterDataTab } from './navigation';
import {
  emptyGlobalTabState,
  isGlobalTabDirty,
  type GlobalMasterDataStore,
} from './use-global-master-data';
import type {
  GlobalMasterDataConflict,
  GlobalMasterDataTab,
} from './global-types';

/** Resolving a migrated conflict is an explicit draft choice, saved with this tab's revision. */
export function resolveGlobalConflict(
  items: Record<string, unknown>[],
  keyField: 'id' | 'code',
  conflict: GlobalMasterDataConflict,
  selected: Record<string, unknown>,
) {
  if (
    !conflict.variants.some(
      (variant) => contentKey(variant.item) === contentKey(selected),
    )
  )
    throw new Error('Select an existing source variant first.');
  const keys = new Set(
    conflict.variants.map((variant) => String(variant.item[keyField])),
  );
  return [
    ...items.filter((item) => !keys.has(String(item[keyField]))),
    structuredClone(selected),
  ];
}

const fieldLabels: Record<string, string> = {
  code: 'Code / 编码',
  name: 'Name / 名称',
  nameZh: '中文名称',
  pool: 'Resource pool / 人员类别',
  level: 'Level / 等级',
  mandayRate: 'MD rate / 人天费率（SGD）',
  mandaysPerMonth: 'MD per month / 每月人天',
  hoursPerManday: 'Hours per MD / 每天工时',
  effectiveFrom: 'Effective from / 生效日期',
  effectiveTo: 'Effective to / 截止日期',
  active: 'Active / 启用',
  hqTravel: 'HQ travel / 总部差旅',
  category: 'Category / 分类',
  scope: 'Scope / 服务范围',
  unit: 'Unit / 单位',
  unitCost: 'Unit cost / 单位成本',
  unitPrice: 'Unit price / 参考单价',
  kind: 'Kind / 类型',
  adjustable: 'Adjustable / 可调数量',
  step: 'Quantity step / 数量步长',
  minQty: 'Minimum qty / 最小数量',
  maxQty: 'Maximum qty / 最大数量',
  referenceQty: 'Reference qty / 参考数量',
  tags: 'Tags / 检索词',
  revision: 'Revision / 目录版本',
  item: 'Item / 服务条目',
  bu: 'BU / 业务领域',
  buCode: 'BU Code / 公司编码',
  ratePercent: 'Profit share rate (%) / 分成比例（%）',
  supplier: 'Supplier / 供应商',
  pricingBasis: 'Pricing basis / 计价依据',
  currency: 'Currency / 币种',
  statementCode: 'Cost account / 成本科目',
  defaultAmount: 'Reference amount / 参考金额',
  owner: 'Owner / 负责人',
  sourceNote: 'Source note / 来源说明',
  client: 'Client / 客户',
  service: 'Service / 服务',
  productModel: 'Product model / 设备型号',
  serviceLevel: 'Service level / 服务等级',
  site: 'Site / 站点',
  coverageMonths: 'Coverage months / 服务月数',
  quantity: 'Quantity / 数量',
  costAmount: 'Cost / 成本金额',
  quotedAmount: 'Quoted / 报价金额',
  quoteDate: 'Quote date / 报价日期',
  outcome: 'Outcome / 报价结果',
  source: 'Source / 来源',
  clientPattern: 'Client / 客户（* 为通用）',
  text: 'Assumption / 假设正文',
  textZh: '假设译文',
  documentTitle: 'Document title / 报价标题',
  documentTitleZh: '标题译文',
  validityDays: 'Validity days / 有效天数',
  paymentTerms: 'Payment terms / 付款条款',
  paymentTermsZh: '付款条款译文',
  termsAndConditions: 'Terms & Conditions / 条款',
  defaultAssumptionIds: 'Default assumption references / 默认假设引用',
  no: 'Order / 顺序',
  detail: 'Requirements / 输入要求',
  detailZh: '输入要求译文',
  required: 'Required / 必经节点',
  parallelGroup: '并行组',
  slaDays: '处理时限（天）',
  slaCalendar: '工作日 / 自然日口径',
  slaHolidays: '非工作日期',
  reminderEnabled: '开启提醒',
  requiredFields: '完成时必填信息',
  roundStart: '新成本轮次起点',
  requiresConfirmedCost: '要求成本定稿',
  finishesWorkflow: '结束项目流程',
  autoSkip: '默认跳过可选节点',
};
const workflowFieldLabels: Record<string, string> = {
  name: 'English Name',
  nameZh: 'Chinese Name',
  owner: 'Default Owner',
  no: 'Order',
  detail: 'Requirements',
  detailZh: 'Requirements Translation',
  required: 'Required Step',
  parallelGroup: 'Parallel Group',
  slaDays: 'SLA Days',
  slaCalendar: 'SLA Calendar',
  slaHolidays: 'Non-working Dates',
  reminderEnabled: 'Enable Reminders',
  requiredFields: 'Required Completion Fields',
  roundStart: 'New Cost Round Start',
  requiresConfirmedCost: 'Require Confirmed Cost',
  finishesWorkflow: 'Complete Workflow',
  autoSkip: 'Skip Optional Step by Default',
};
/** Quote-template conflicts show only the fields used by the English customer document. */
const quoteTemplateFieldLabels: Record<string, string> = {
  name: 'Template Name',
  clientPattern: 'Client Pattern',
  documentTitle: 'Document Title',
  validityDays: 'Validity Days',
  paymentTerms: 'Payment Terms',
  termsAndConditions: 'Terms & Conditions',
  defaultAssumptionIds: 'Default Assumption References',
  active: 'Active',
};
const displayValue = (value: unknown, workflow = false): string => {
  if (value === true) return workflow ? 'Yes' : 'Yes / 是';
  if (value === false) return workflow ? 'No' : 'No / 否';
  if (value === '' || value === null || value === undefined) return '—';
  if (Array.isArray(value))
    return (
      value
        .map((entry) => displayValue(entry, workflow))
        .join(workflow ? ', ' : '、') || '—'
    );
  if (typeof value === 'object')
    return Object.entries(value)
      .map(
        ([key, entry]) =>
          `${(workflow ? workflowFieldLabels : fieldLabels)[key] || key}: ${displayValue(entry, workflow)}`,
      )
      .join(workflow ? '; ' : '；');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return value.toString();
  return '—';
};
export function globalConflictTitle(
  conflict: GlobalMasterDataConflict,
  tab?: string,
) {
  const item = conflict.variants[0]?.item || {};
  return (
    [
      tab === 'workflow' ? item.no : item.code,
      tab === 'workflow'
        ? item.name || item.nameZh
        : item.name ||
          item.item ||
          item.scope ||
          item.bu ||
          item.productModel ||
          item.service,
    ]
      .filter(Boolean)
      .map(String)
      .join(' · ') || (tab === 'workflow' ? 'Workflow Step' : conflict.key)
  );
}
/** Display the saved conflict variant using only the fields relevant to its catalog. */
export function GlobalConflictFields({
  item,
  tab,
}: {
  item: Record<string, unknown>;
  tab?: string;
}) {
  const hidden = new Set([
    'id',
    'state',
    'tone',
    'date',
    'dateZh',
    'input',
    'inputZh',
  ]);
  if (tab === 'workflow') hidden.add('code');
  if (tab === 'quote-templates') {
    // Old translations remain stored for history, but are no longer customer-template fields.
    hidden.add('nameZh');
    hidden.add('documentTitleZh');
    hidden.add('paymentTermsZh');
  }
  if (tab === 'subcontract') {
    hidden.add('supplier');
    hidden.add('pricingBasis');
  }
  return (
    <dl className="my-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(item)
        .filter(([key]) => !hidden.has(key))
        .map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted-foreground">
              {(tab === 'workflow'
                ? workflowFieldLabels
                : tab === 'quote-templates'
                  ? quoteTemplateFieldLabels
                  : fieldLabels)[key] || key}
            </dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium">
              {displayValue(
                value,
                tab === 'workflow' || tab === 'quote-templates',
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function GlobalMasterDataPage({
  store,
  activeTab,
  onTabChange,
  announce,
  onWorkflowPublished,
}: {
  store: GlobalMasterDataStore;
  activeTab: MasterDataTab;
  onTabChange: (tab: MasterDataTab) => void;
  announce: (message: string) => void;
  onWorkflowPublished?: () => void;
}) {
  const { load } = store;
  const workflow = activeTab === 'workflow';
  const [publication, setPublication] = useState<{
    steps: WorkflowStep[];
    revision: number;
  } | null>(null);
  useEffect(() => {
    void load(activeTab);
    // Cross-reference validation uses only the relevant global catalog, never a project.
    if (activeTab === 'assumptions') void load('quote-templates');
    if (activeTab === 'quote-templates') void load('assumptions');
  }, [activeTab, load]);
  const state = store.tabs[activeTab] || emptyGlobalTabState;
  const dependency =
    activeTab === 'assumptions'
      ? 'quote-templates'
      : activeTab === 'quote-templates'
        ? 'assumptions'
        : null;
  const dependencyState = dependency ? store.tabs[dependency] : undefined;
  const blocked =
    !state.record ||
    state.loading ||
    state.saving ||
    !!(
      dependency &&
      (!dependencyState?.record ||
        dependencyState.loading ||
        dependencyState.saving)
    );
  const rows = <T,>(tab: GlobalMasterDataTab) =>
    (store.tabs[tab]?.items || []) as T[];
  const setter =
    <T,>(tab: GlobalMasterDataTab): React.Dispatch<React.SetStateAction<T[]>> =>
    (change) =>
      store.setItems(tab, change);
  return (
    <div className="space-y-3" data-master-data-scope="global">
      {publication && (
        <WorkflowPublishDialog
          steps={publication.steps}
          expectedRevision={publication.revision}
          onClose={() => setPublication(null)}
          onPublished={async (result) => {
            await load('workflow', true);
            setPublication(null);
            announce(
              `Workflow template published. ${result.updatedProjects.length} projects synchronized.`,
            );
            onWorkflowPublished?.();
          }}
        />
      )}
      <output className="flex flex-wrap items-center gap-3 border bg-card p-3 text-xs">
        <strong>
          {workflow ? 'Global Master Data' : 'Global Master Data / 全局主数据'}
        </strong>
        <span>
          {state.loading
            ? workflow
              ? 'Loading'
              : 'Loading / 加载中'
            : state.saving
              ? workflow
                ? 'Saving'
                : 'Saving / 保存中'
              : state.record
                ? `Revision ${state.record.revision}`
                : workflow
                  ? 'Not loaded'
                  : 'Not loaded / 尚未载入'}
        </span>
        {isGlobalTabDirty(state) && (
          <span className="text-amber-800">
            {workflow ? 'Unsaved changes' : 'Unsaved changes / 未保存修改'}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={state.loading || state.saving}
          onClick={() => {
            if (
              !isGlobalTabDirty(state) ||
              window.confirm(
                workflow
                  ? 'Discard unsaved workflow edits and reload the published template?'
                  : 'Discard this tab’s unsaved edits and reload global data? / 放弃当前页签未保存修改并重新加载？',
              )
            )
              void load(activeTab, true);
          }}
        >
          {workflow ? 'Reload Template' : 'Reload this tab / 重新加载'}
        </Button>
      </output>
      {(state.error || dependencyState?.error) && (
        <div
          role="alert"
          className="border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error || dependencyState?.error}
          <p className="mt-1 text-xs">
            {workflow
              ? 'Your edits are retained. If another operation updated the template, reload it and reapply your changes. Newer data will not be overwritten.'
              : '修改仍保留。若其他操作已更新此页签，请重新加载后重新编辑；不会覆盖新数据。'}
          </p>
          {dependencyState?.error && dependency && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load(dependency, true)}
            >
              Retry related global catalog / 重试关联全局目录
            </Button>
          )}
        </div>
      )}
      {!!state.record?.conflicts.length && (
        <section className="space-y-2 border border-amber-300 bg-amber-50 p-3 text-sm">
          <h2 className="font-semibold">
            {workflow
              ? 'Resolve Source Differences'
              : 'Resolve source differences / 确认全局数据来源'}
          </h2>
          <p className="text-xs">
            {workflow
              ? 'Migration retained values from different sources. Review and select the template values, then preview the project impact before publishing. Completed history and cost snapshots are retained.'
              : '迁移保留了不同来源的值。请核对并选择未来项目采用的值，然后保存当前页签；已有项目快照保持不变。'}
          </p>
          {state.record.conflicts.map((conflict) => (
            <details key={conflict.key} className="border bg-white p-2">
              <summary>
                {globalConflictTitle(conflict, activeTab)} ·{' '}
                {conflict.variants.length}{' '}
                {workflow ? 'source values' : 'source values / 个来源值'}
              </summary>
              {conflict.variants.map((variant, index) => (
                <div key={index} className="mt-2 border-t pt-2">
                  <p className="text-xs text-muted-foreground">
                    {variant.sources
                      .map(
                        (source) =>
                          `${source.projectName || source.projectId || 'Initial defaults'}${source.revision === undefined ? '' : ` · r${source.revision}`}`,
                      )
                      .join(' / ')}
                  </p>
                  <GlobalConflictFields item={variant.item} tab={activeTab} />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={blocked}
                    aria-pressed={state.items.some(
                      (item) => contentKey(item) === contentKey(variant.item),
                    )}
                    onClick={() =>
                      store.setItems(
                        activeTab,
                        (items: Record<string, unknown>[]) =>
                          resolveGlobalConflict(
                            items,
                            state.record!.keyField,
                            conflict,
                            variant.item,
                          ),
                      )
                    }
                  >
                    {state.items.some(
                      (item) => contentKey(item) === contentKey(variant.item),
                    )
                      ? workflow
                        ? 'Selected · preview and publish'
                        : 'Selected · save this tab / 已选择，请保存页签'
                      : workflow
                        ? 'Use This Value'
                        : 'Use this value / 采用此值'}
                  </Button>
                </div>
              ))}
            </details>
          ))}
        </section>
      )}
      <div className="min-w-0">
        <MasterDataView
          editingDisabled={blocked}
          activeTab={activeTab}
          onTabChange={onTabChange}
          saveLabel={activeTab === 'workflow' ? 'Preview & Publish' : undefined}
          onSave={async () => {
            if (activeTab !== 'workflow') return store.save(activeTab);
            if (!state.record || blocked) return false;
            setPublication({
              steps: structuredClone(rows<WorkflowStep>('workflow')),
              revision: state.record.revision,
            });
            return false;
          }}
          resourceTypes={rows<ResourceType>('resources')}
          setResourceTypes={setter('resources')}
          subcontractItems={rows<SubcontractItem>('subcontract')}
          setSubcontractItems={setter('subcontract')}
          supplementalCostItems={rows<SupplementalCostItem>('supplemental')}
          setSupplementalCostItems={setter('supplemental')}
          maintenancePriceRecords={rows<MaintenancePriceRecord>('maintenance')}
          setMaintenancePriceRecords={setter('maintenance')}
          assumptionLibrary={rows<AssumptionDefinition>('assumptions')}
          setAssumptionLibrary={setter('assumptions')}
          quoteTemplates={rows<QuoteTemplate>('quote-templates')}
          setQuoteTemplates={setter('quote-templates')}
          profitShareRates={rows<ProfitShareRate>('profit-share')}
          setProfitShareRates={setter('profit-share')}
          processSteps={rows<WorkflowStep>('workflow')}
          setProcessSteps={setter('workflow')}
          projectStatusDefinitions={rows<ProjectStatusDefinition>('status')}
          setProjectStatusDefinitions={setter('status')}
          catalog={rows<CatalogItem>('cpq-catalog')}
          setCatalog={setter('cpq-catalog')}
          announce={announce}
        />
      </div>
    </div>
  );
}
