'use client';
import { useEffect } from 'react';
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
import { MasterDataView } from './master-data-view';
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
  required: 'Required / 必须',
};
const displayValue = (value: unknown): string => {
  if (value === true) return 'Yes / 是';
  if (value === false) return 'No / 否';
  if (value === '' || value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(displayValue).join('、') || '—';
  if (typeof value === 'object')
    return Object.entries(value)
      .map(
        ([key, entry]) => `${fieldLabels[key] || key}: ${displayValue(entry)}`,
      )
      .join('；');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return value.toString();
  return '—';
};
export function globalConflictTitle(conflict: GlobalMasterDataConflict) {
  const item = conflict.variants[0]?.item || {};
  return (
    [
      item.code,
      item.name || item.item || item.scope || item.productModel || item.service,
    ]
      .filter(Boolean)
      .map(String)
      .join(' · ') || conflict.key
  );
}
export function GlobalConflictFields({
  item,
}: {
  item: Record<string, unknown>;
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
  return (
    <dl className="my-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(item)
        .filter(([key]) => !hidden.has(key))
        .map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted-foreground">{fieldLabels[key] || key}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium">
              {displayValue(value)}
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
}: {
  store: GlobalMasterDataStore;
  activeTab: MasterDataTab;
  onTabChange: (tab: MasterDataTab) => void;
  announce: (message: string) => void;
}) {
  const { load } = store;
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
      <output className="flex flex-wrap items-center gap-3 border bg-card p-3 text-xs">
        <strong>Global Master Data / 全局主数据</strong>
        <span>
          {state.loading
            ? 'Loading / 加载中'
            : state.saving
              ? 'Saving / 保存中'
              : state.record
                ? `Revision ${state.record.revision}`
                : 'Not loaded / 尚未载入'}
        </span>
        {isGlobalTabDirty(state) && (
          <span className="text-amber-800">Unsaved changes / 未保存修改</span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={state.loading || state.saving}
          onClick={() => {
            if (
              !isGlobalTabDirty(state) ||
              window.confirm(
                'Discard this tab’s unsaved edits and reload global data? / 放弃当前页签未保存修改并重新加载？',
              )
            )
              void load(activeTab, true);
          }}
        >
          Reload this tab / 重新加载
        </Button>
      </output>
      {(state.error || dependencyState?.error) && (
        <div
          role="alert"
          className="border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error || dependencyState?.error}
          <p className="mt-1 text-xs">
            修改仍保留。若其他操作已更新此页签，请重新加载后重新编辑；不会覆盖新数据。
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
            Resolve source differences / 确认全局数据来源
          </h2>
          <p className="text-xs">
            迁移保留了不同来源的值。请核对并选择未来项目采用的值，然后保存当前页签；已有项目快照保持不变。
          </p>
          {state.record.conflicts.map((conflict) => (
            <details key={conflict.key} className="border bg-white p-2">
              <summary>
                {globalConflictTitle(conflict)} · {conflict.variants.length}{' '}
                source values / 个来源值
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
                  <GlobalConflictFields item={variant.item} />
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
                      ? 'Selected · save this tab / 已选择，请保存页签'
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
          onSave={() => store.save(activeTab)}
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
