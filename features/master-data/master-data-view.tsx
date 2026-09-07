/**
 * Compact master-data editor. Personnel level and pricing live in one RE Type
 * record so users cannot create an invalid RE Type + Grade combination.
 */
import {
  assertMaintenanceImport,
  parseImportNumber,
} from './maintenance-import';
import { useRef, useState } from 'react';
import { Plus, Save, Search, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BiInline } from '@/components/workbench/bilingual-text';
import { SectionHeading } from '@/components/workbench/section-heading';
import { StatusBadge } from '@/components/workbench/status-badge';
import {
  getResourceRateConversions,
  roundMoney,
  type CostInputRow,
  type ResourceType,
} from '@/features/cost/domain';
import {
  unitAnnualMaintenanceQuote,
  type MaintenancePriceRecord,
  type SupplementalCostItem,
} from '@/features/master-data/domain';
import type { SubcontractItem } from '@/features/master-data/types';
import { workflowStateLabels } from '@/features/projects/workflow-constants';
import type {
  Project,
  ProjectStatus,
  ProjectStatusDefinition,
  WorkflowState,
  WorkflowStep,
} from '@/features/projects/types';
import { formatSgd } from '@/lib/formatters';
import type {
  AssumptionDefinition,
  QuoteTemplate,
} from '@/features/quote/types';
import {
  AssumptionLibraryView,
  QuoteTemplatesView,
} from './quote-catalog-view';
import { QuoteCatalogImport } from './quote-catalog-import';
import type { ReviewGate } from '@/features/reviews/types';
import {
  masterDataTabs,
  isMasterDataTab,
  type MasterDataTab,
} from './navigation';

type Props = {
  costLockReason?: string | null;
  activeTab: MasterDataTab;
  onTabChange: (tab: MasterDataTab) => void;
  onOpenQuote: () => void;
  reviewGates: ReviewGate[];
  onSave: () => Promise<boolean>;
  resourceTypes: ResourceType[];
  setResourceTypes: React.Dispatch<React.SetStateAction<ResourceType[]>>;
  subcontractItems: SubcontractItem[];
  setSubcontractItems: React.Dispatch<React.SetStateAction<SubcontractItem[]>>;
  supplementalCostItems: SupplementalCostItem[];
  setSupplementalCostItems: React.Dispatch<
    React.SetStateAction<SupplementalCostItem[]>
  >;
  maintenancePriceRecords: MaintenancePriceRecord[];
  setMaintenancePriceRecords: React.Dispatch<
    React.SetStateAction<MaintenancePriceRecord[]>
  >;
  assumptionLibrary: AssumptionDefinition[];
  setAssumptionLibrary: React.Dispatch<
    React.SetStateAction<AssumptionDefinition[]>
  >;
  quoteTemplates: QuoteTemplate[];
  setQuoteTemplates: React.Dispatch<React.SetStateAction<QuoteTemplate[]>>;
  selectedQuoteTemplateId: string;
  setSelectedQuoteTemplateId: React.Dispatch<React.SetStateAction<string>>;
  project: Pick<Project, 'id' | 'name' | 'client'>;
  /** Includes every saved cost version so an in-use RE Type cannot be removed. */
  costRows: CostInputRow[];
  currentWorkflowStepCode: string;
  setCurrentWorkflowStepCode: React.Dispatch<React.SetStateAction<string>>;
  setSelectedStep: React.Dispatch<React.SetStateAction<number>>;
  processSteps: WorkflowStep[];
  setProcessSteps: React.Dispatch<React.SetStateAction<WorkflowStep[]>>;
  projectStatus: ProjectStatus;
  setProjectStatus: React.Dispatch<React.SetStateAction<ProjectStatus>>;
  projectStatusDefinitions: ProjectStatusDefinition[];
  setProjectStatusDefinitions: React.Dispatch<
    React.SetStateAction<ProjectStatusDefinition[]>
  >;
  announce: (message: string) => void;
};

const denseInput =
  'h-8 min-w-20 rounded-none border-0 bg-transparent px-2 text-[11px] shadow-none focus-visible:relative focus-visible:z-20 focus-visible:bg-white focus-visible:ring-1';

/**
 * Canonical internal RE Types. When a user deletes one and later selects Add,
 * the first missing governed combination is restored before a custom type is
 * created. This keeps the fixed HQ/Local/ARP model easy to repair.
 */
const canonicalResourceTypes = [
  ['HQ', 'L1'],
  ['HQ', 'L2'],
  ['HQ', 'L3'],
  ['HQ', 'L4'],
  ['LOCAL', 'L1'],
  ['LOCAL', 'L2'],
  ['LOCAL', 'L3'],
  ['LOCAL', 'L4'],
  ['ARP', 'L0'],
  ['ARP', 'L1'],
  ['ARP', 'L2'],
  ['ARP', 'L3'],
  ['ARP', 'L4'],
] as const satisfies ReadonlyArray<
  readonly [
    NonNullable<ResourceType['pool']>,
    NonNullable<ResourceType['level']>,
  ]
>;

/** Browser-generated IDs remain unique after rows are deleted and re-added. */
const newRecordId = (prefix: string) =>
  `${prefix}-${globalThis.crypto.randomUUID()}`;

/** Short suffix for human-visible codes; the full UUID remains the database ID. */
const newCodeSuffix = () =>
  globalThis.crypto.randomUUID().split('-')[0].toUpperCase();

/** Destructive edits always require an explicit user confirmation. */
const confirmDelete = (label: string) =>
  window.confirm(
    `Delete ${label}? This action is saved to the local database.\n\n确认删除 ${label}？此操作将保存到本地数据库。`,
  );

/** Reusable editable cell keeps all master tables dense and consistent. */
function EditCell({
  value,
  type = 'text',
  onChange,
  ariaLabel,
}: {
  value: string | number;
  type?: 'text' | 'number' | 'date';
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <Input
      className={denseInput}
      type={type}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function MasterDataView(props: Props) {
  const {
    costLockReason = null,
    activeTab,
    onTabChange,
    onOpenQuote,
    resourceTypes,
    setResourceTypes,
    subcontractItems,
    setSubcontractItems,
    supplementalCostItems,
    setSupplementalCostItems,
    maintenancePriceRecords,
    setMaintenancePriceRecords,
    assumptionLibrary,
    setAssumptionLibrary,
    quoteTemplates,
    setQuoteTemplates,
    selectedQuoteTemplateId,
    setSelectedQuoteTemplateId,
    project,
    costRows,
    currentWorkflowStepCode,
    setCurrentWorkflowStepCode,
    setSelectedStep,
    processSteps,
    setProcessSteps,
    projectStatus,
    setProjectStatus,
    projectStatusDefinitions,
    setProjectStatusDefinitions,
    announce,
    reviewGates,
    onSave,
  } = props;
  const [query, setQuery] = useState('');
  const tabCounts: Record<MasterDataTab, number> = {
    resources: resourceTypes.length,
    subcontract: subcontractItems.length,
    supplemental: supplementalCostItems.length,
    maintenance: maintenancePriceRecords.length,
    assumptions: assumptionLibrary.length,
    'quote-templates': quoteTemplates.length,
    workflow: processSteps.length,
    status: projectStatusDefinitions.length,
  };
  const maintenanceImportRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const matches = (...values: unknown[]) =>
    values.join(' ').toLowerCase().includes(q);

  const updateResource = <K extends keyof ResourceType>(
    id: string,
    key: K,
    value: ResourceType[K],
  ) =>
    setResourceTypes((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  const updateSubcontract = <K extends keyof SubcontractItem>(
    id: string,
    key: K,
    value: SubcontractItem[K],
  ) =>
    setSubcontractItems((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  const updateSupplemental = <K extends keyof SupplementalCostItem>(
    id: string,
    key: K,
    value: SupplementalCostItem[K],
  ) =>
    setSupplementalCostItems((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  const updateMaintenance = <K extends keyof MaintenancePriceRecord>(
    id: string,
    key: K,
    value: MaintenancePriceRecord[K],
  ) =>
    setMaintenancePriceRecords((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  /** Updates one project-specific workflow node without changing its code. */
  const updateProcessStep = <K extends keyof WorkflowStep>(
    code: string,
    key: K,
    value: WorkflowStep[K],
  ) =>
    setProcessSteps((rows) =>
      rows.map((row) => (row.code === code ? { ...row, [key]: value } : row)),
    );

  /** Keeps the presentation tone synchronized with the selected state. */
  const updateProcessState = (code: string, state: WorkflowState) =>
    setProcessSteps((rows) =>
      rows.map((row) =>
        row.code === code
          ? { ...row, state, tone: workflowStateLabels[state].tone }
          : row,
      ),
    );

  const resources = resourceTypes.filter((row) =>
    matches(row.code, row.name, row.pool, row.level),
  );
  const subcontract = subcontractItems.filter((row) =>
    matches(row.code, row.item, row.bu, row.supplier),
  );
  const supplemental = supplementalCostItems.filter((row) =>
    matches(row.code, row.name, row.statementCode, row.owner),
  );
  const maintenance = maintenancePriceRecords.filter((row) =>
    matches(row.client, row.service, row.productModel, row.site, row.source),
  );
  const workflow = processSteps.filter((row) =>
    matches(row.no, row.code, row.name, row.nameZh, row.owner, row.state),
  );
  const statuses = projectStatusDefinitions.filter((row) =>
    matches(row.code, row.name, row.nameZh, row.active),
  );

  /** Adds a project-specific workflow stage with schema-valid starter data. */
  const addWorkflowStep = () => {
    setQuery('');
    const code = `CUSTOM-STAGE-${newCodeSuffix()}`;
    setProcessSteps((rows) => {
      const nextNumber =
        Math.max(0, ...rows.map((row) => Number(row.no) || 0)) + 1;
      return [
        ...rows,
        {
          code,
          no: String(nextNumber).padStart(2, '0'),
          name: 'New Workflow Stage',
          nameZh: '新流程节点',
          owner: 'Me',
          state: 'not_started',
          tone: 'gray',
          date: 'Not set',
          dateZh: '未设置',
          detail: '',
          detailZh: '',
          input: '',
          inputZh: '',
          required: false,
        },
      ];
    });
    if (!currentWorkflowStepCode) {
      setCurrentWorkflowStepCode(code);
      setSelectedStep(0);
    }
    announce('Workflow stage added. / 已新增流程节点。');
  };

  /** Deletes a workflow node and moves the current pointer when necessary. */
  const deleteWorkflowStep = (step: WorkflowStep) => {
    const linked = reviewGates.filter(
      (review) => review.workflowStepCode === step.code,
    );
    if (linked.length) {
      announce(
        `This node is used by ${linked.length} review(s). Reassign their workflow first. / 请先调整关联评审的流程节点。`,
      );
      return;
    }
    if (!confirmDelete(`${step.no} · ${step.name}`)) return;
    const remaining = processSteps.filter((item) => item.code !== step.code);
    const nextCurrentCode =
      currentWorkflowStepCode === step.code
        ? remaining[0]?.code || ''
        : currentWorkflowStepCode;
    setProcessSteps(remaining);
    setCurrentWorkflowStepCode(nextCurrentCode);
    setSelectedStep(
      Math.max(
        0,
        remaining.findIndex((item) => item.code === nextCurrentCode),
      ),
    );
    announce(
      `Workflow stage ${step.no} deleted. / 已删除流程节点 ${step.no}。`,
    );
  };

  /** Updates a display field without changing the stable Agent/CLI status code. */
  const updateProjectStatusDefinition = <
    K extends keyof ProjectStatusDefinition,
  >(
    code: string,
    key: K,
    value: ProjectStatusDefinition[K],
  ) =>
    setProjectStatusDefinitions((rows) =>
      rows.map((row) => (row.code === code ? { ...row, [key]: value } : row)),
    );

  /** Adds a schema-valid status option to this project's status dictionary. */
  const addProjectStatusDefinition = () => {
    setQuery('');
    const code = `CUSTOM-STATUS-${newCodeSuffix()}`;
    setProjectStatusDefinitions((rows) => [
      ...rows,
      {
        code,
        name: 'New Project Status',
        nameZh: '新项目状态',
        active: true,
      },
    ]);
    announce('Project status added. / 已新增项目状态。');
  };

  /** Deletes one status option and safely reassigns the current selection. */
  const deleteProjectStatusDefinition = (status: ProjectStatusDefinition) => {
    if (projectStatusDefinitions.length <= 1) {
      announce(
        'Delete blocked: at least one project status is required. / 删除已阻止：至少需要保留一个项目状态。',
      );
      return;
    }
    if (!confirmDelete(`${status.code} · ${status.name}`)) return;
    const remaining = projectStatusDefinitions.filter(
      (item) => item.code !== status.code,
    );
    if (projectStatus === status.code) {
      setProjectStatus(
        remaining.find((item) => item.active)?.code || remaining[0].code,
      );
    }
    setProjectStatusDefinitions(remaining);
    announce(
      `Project status ${status.name} deleted. / 已删除项目状态 ${status.nameZh || status.name}。`,
    );
  };

  /**
   * Restores a missing canonical RE Type first. If the canonical set is
   * complete, a valid custom/subcontract RE Type is added instead.
   */
  const addResource = () => {
    setQuery('');
    setResourceTypes((rows) => {
      const codes = new Set(rows.map((row) => row.code.toUpperCase()));
      const missing = canonicalResourceTypes.find(
        ([pool, level]) => !codes.has(`${pool}-${level}`),
      );
      const effectiveFrom = `${new Date().getFullYear()}-01-01`;
      if (missing) {
        const [pool, level] = missing;
        return [
          ...rows,
          {
            id: newRecordId('rt'),
            code: `${pool}-${level}`,
            name: `${pool === 'LOCAL' ? 'Local' : pool} ${level}`,
            category: 'internal',
            pool,
            level,
            mandayRate: 0,
            mandaysPerMonth: 21.75,
            hoursPerManday: 8,
            hqTravel: pool === 'HQ',
            effectiveFrom,
            effectiveTo: '',
            active: true,
          },
        ];
      }
      const suffix = newCodeSuffix();
      return [
        ...rows,
        {
          id: newRecordId('rt'),
          code: `CUSTOM-${suffix}`,
          name: 'Custom RE Type',
          category: 'subcontract',
          pool: null,
          level: null,
          mandayRate: 0,
          mandaysPerMonth: 21.75,
          hoursPerManday: 8,
          hqTravel: false,
          effectiveFrom,
          effectiveTo: '',
          active: true,
        },
      ];
    });
    announce('RE Type added. / 已新增 RE Type。');
  };

  /** Adds a fully valid row so SQLite autosave never receives blank required fields. */
  const addSubcontract = () => {
    setQuery('');
    const suffix = newCodeSuffix();
    setSubcontractItems((rows) => [
      ...rows,
      {
        id: newRecordId('sub'),
        code: `SUB-${suffix}`,
        item: 'New Subcontract Item',
        bu: 'Unassigned BU',
        supplier: 'TBD Supplier',
        pricingBasis: 'Fixed price',
        currency: 'SGD',
        active: true,
      },
    ]);
    announce('Subcontract item added. / 已新增分包条目。');
  };

  /** Adds a reusable manual-cost reference with a unique integration code. */
  const addSupplemental = () => {
    setQuery('');
    const suffix = newCodeSuffix();
    setSupplementalCostItems((rows) => [
      ...rows,
      {
        id: newRecordId('supp'),
        code: `SUP-${suffix}`,
        name: 'New Supplemental Cost',
        statementCode: '2.3.4.2',
        defaultAmount: 0,
        currency: 'SGD',
        owner: 'Commercial',
        sourceNote: 'Manual reference',
        active: true,
      },
    ]);
    announce('Supplemental cost added. / 已新增补充成本。');
  };

  /** Adds a maintenance-price reference with nonblank editable placeholders. */
  const addMaintenance = () => {
    setQuery('');
    setMaintenancePriceRecords((rows) => [
      ...rows,
      {
        id: newRecordId('mh'),
        client: 'New Client',
        service: 'Maintenance Service',
        productModel: 'TBD Model',
        serviceLevel: 'TBD Service Level',
        site: 'TBD Site',
        coverageMonths: 12,
        quantity: 1,
        costAmount: 0,
        quotedAmount: 0,
        currency: 'SGD',
        quoteDate: new Date().toISOString().slice(0, 10),
        outcome: 'Reference',
        source: 'Manual entry',
      },
    ]);
    announce('Maintenance history added. / 已新增维保历史。');
  };

  /**
   * Imports governed maintenance history from the public JSON contract or an
   * XLSX worksheet with matching English column names.
   */
  const importMaintenance = async (file: File) => {
    try {
      let records: MaintenancePriceRecord[];
      if (file.name.toLowerCase().endsWith('.json')) {
        const value = JSON.parse(await file.text()) as {
          schemaVersion?: string;
          records?: MaintenancePriceRecord[];
        };
        if (value.schemaVersion !== '1.0.0' || !Array.isArray(value.records)) {
          throw new Error('JSON must follow maintenance-price/1.0.0.');
        }
        assertMaintenanceImport(value);
        records = value.records;
      } else {
        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('Workbook has no worksheet.');
        const header = new Map<string, number>();
        sheet.getRow(1).eachCell((cell, column) => {
          header.set(cell.text.trim().toLowerCase(), column);
        });
        const cell = (
          row: import('exceljs').Row,
          ...names: string[]
        ): string | Date => {
          const column = names.map((name) => header.get(name)).find(Boolean);
          if (!column) return '';
          const worksheetCell = row.getCell(column);
          return worksheetCell.value instanceof Date
            ? worksheetCell.value
            : worksheetCell.text;
        };
        records = [];
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const client = String(cell(row, 'client') || '').trim();
          const service = String(cell(row, 'service') || '').trim();
          if (!client && !service) return;
          const quoteDateValue = cell(row, 'quote date', 'quotedate');
          const quoteDate =
            quoteDateValue instanceof Date
              ? quoteDateValue.toISOString().slice(0, 10)
              : String(quoteDateValue || '').slice(0, 10);
          const rawOutcome = String(cell(row, 'outcome') || 'Reference');
          const outcome = rawOutcome as MaintenancePriceRecord['outcome'];
          records.push({
            id: newRecordId('mh'),
            client,
            service,
            productModel: String(
              cell(row, 'product model', 'productmodel', 'model') || '',
            ).trim(),
            serviceLevel: String(
              cell(row, 'service level', 'servicelevel') || '',
            ).trim(),
            site: String(cell(row, 'site') || '').trim(),
            coverageMonths: parseImportNumber(
              cell(row, 'coverage months', 'coveragemonths', 'months'),
              `Row ${rowNumber} coverageMonths`,
            ),
            quantity: parseImportNumber(
              cell(row, 'quantity', 'qty'),
              `Row ${rowNumber} quantity`,
            ),
            costAmount: roundMoney(
              parseImportNumber(
                cell(row, 'cost', 'cost amount'),
                `Row ${rowNumber} cost`,
              ),
            ),
            quotedAmount: roundMoney(
              parseImportNumber(
                cell(row, 'quoted', 'quoted amount', 'quote'),
                `Row ${rowNumber} quote`,
              ),
            ),
            currency: String(cell(row, 'currency') || 'SGD').trim() as 'SGD',
            quoteDate,
            outcome,
            source:
              String(cell(row, 'source') || file.name).trim() || file.name,
          });
        });
      }
      assertMaintenanceImport({ schemaVersion: '1.0.0', records });
      if (!records.length) throw new Error('No maintenance records found.');
      const valid = records.map((record) => ({
        ...record,
        costAmount: roundMoney(record.costAmount),
        quotedAmount: roundMoney(record.quotedAmount),
      }));
      setMaintenancePriceRecords((current) => {
        const byId = new Map(current.map((record) => [record.id, record]));
        valid.forEach((record) => byId.set(record.id, record));
        return [...byId.values()];
      });
      announce(
        `Imported ${valid.length} maintenance record(s) from ${file.name}. / 已导入 ${valid.length} 条维保历史。`,
      );
    } catch (error) {
      announce(
        `Maintenance import failed: ${error instanceof Error ? error.message : 'Unknown error'} / 维保历史导入失败。`,
      );
    }
  };

  /** Removes an unreferenced RE Type without invalidating any cost version. */
  const deleteResource = (row: ResourceType) => {
    const usageCount = costRows.filter(
      (costRow) => costRow.reTypeId === row.id,
    ).length;
    if (usageCount > 0) {
      announce(
        `Delete blocked: ${row.name} is used by ${usageCount} cost row(s). / 删除已阻止：该 RE Type 仍被 ${usageCount} 条成本明细使用。`,
      );
      return;
    }
    if (resourceTypes.length <= 1) {
      announce(
        'Delete blocked: at least one RE Type is required. / 删除已阻止：至少需要保留一个 RE Type。',
      );
      return;
    }
    if (!confirmDelete(`${row.code} · ${row.name}`)) return;
    setResourceTypes((rows) => rows.filter((item) => item.id !== row.id));
    announce(`RE Type ${row.code} deleted. / 已删除 RE Type ${row.code}。`);
  };

  /** Shared delete helper for master tables without foreign-key references. */
  const deleteUnreferencedRow = (
    label: string,
    remove: () => void,
    successMessage: string,
  ) => {
    if (!confirmDelete(label)) return;
    remove();
    announce(successMessage);
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="border border-border bg-card">
        <SectionHeading
          index="01"
          title="Master Data"
          titleZh="基础数据管理"
          description="Maintain reference data and customer templates here; select and use them in Pricing & Quote."
          descriptionZh="此处统一维护基础数据与客户模板；报价页负责选择、引用与输出。"
          action={
            <Button size="sm" variant="outline" onClick={onOpenQuote}>
              Open Quote{' '}
              <span className="text-[10px] opacity-60">返回报价</span>
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/20 px-3 py-2 text-xs">
          <span className="font-medium">
            Current project / 当前项目：{project.name}
          </span>
          <span className="financial-numeral text-muted-foreground">
            {project.id}
          </span>
          <span className="text-muted-foreground">
            Client / 客户：{project.client}
          </span>
          <span className="text-muted-foreground">
            Project-owned · 按项目保存，非全局共享
          </span>
        </div>
      </section>
      <section className="min-w-0 overflow-hidden border border-border bg-card">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (!isMasterDataTab(value)) return;
            onTabChange(value);
            setQuery('');
          }}
        >
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center justify-between gap-3 pb-2">
              <p className="text-xs text-muted-foreground">
                Reference Libraries / 基础数据与模板库
              </p>
              <div className="relative w-[260px] max-w-[60%]">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 rounded-sm bg-white pl-8 text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search current master-data tab"
                  placeholder="Search this tab / 搜索当前页签"
                />
              </div>
            </div>
            <div className="overflow-x-auto pb-1">
              <TabsList
                variant="line"
                aria-label="Master Data libraries"
                className="min-w-max justify-start"
              >
                {masterDataTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="h-8 px-2"
                  >
                    {tab.label}
                    <span className="text-[10px] opacity-60">
                      {tab.labelZh}
                    </span>
                    <span className="financial-numeral rounded-sm bg-muted px-1 text-[10px]">
                      {tabCounts[tab.value]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
          <TabsContent value="workflow" className="mt-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
              <span>
                Editing {project.id} · {project.name} / 编辑项目可选流程节点
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge tone="blue">
                  <BiInline en="Project specific" zh="按项目独立保存" />
                </StatusBadge>
                <Button
                  size="sm"
                  className="h-7 text-[10px]"
                  onClick={addWorkflowStep}
                >
                  <Plus />
                  Add row / 新增
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[1240px] text-[11px]">
                <TableHeader>
                  <TableRow className="bg-[#f2f0ea] hover:bg-[#f2f0ea]">
                    <TableHead className="w-16">No.</TableHead>
                    <TableHead className="w-52">Code / 系统编码</TableHead>
                    <TableHead>Stage Name / 英文名称</TableHead>
                    <TableHead>中文名称</TableHead>
                    <TableHead className="w-36">Owner / 负责人</TableHead>
                    <TableHead className="w-44">State / 状态</TableHead>
                    <TableHead className="w-24 text-center">
                      Required / 必须
                    </TableHead>
                    <TableHead className="w-16 text-center">
                      Action / 操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workflow.map((step) => (
                    <TableRow
                      key={step.code}
                      className={
                        step.code === currentWorkflowStepCode
                          ? 'h-9 bg-[#edf4f3]'
                          : 'h-9'
                      }
                    >
                      <TableCell className="financial-numeral font-semibold">
                        {step.no}
                      </TableCell>
                      <TableCell>
                        <code className="text-[10px] text-muted-foreground">
                          {step.code}
                        </code>
                        {step.code === currentWorkflowStepCode ? (
                          <span className="ml-2">
                            <StatusBadge tone="blue">
                              Current / 当前
                            </StatusBadge>
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={step.name}
                          ariaLabel={`${step.code} English name`}
                          onChange={(value) =>
                            updateProcessStep(step.code, 'name', value)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={step.nameZh}
                          ariaLabel={`${step.code} Chinese name`}
                          onChange={(value) =>
                            updateProcessStep(step.code, 'nameZh', value)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={step.owner}
                          ariaLabel={`${step.code} owner`}
                          onChange={(value) =>
                            updateProcessStep(step.code, 'owner', value)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={step.state}
                          onValueChange={(value) => {
                            if (value) {
                              updateProcessState(
                                step.code,
                                value as WorkflowState,
                              );
                            }
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-8 w-full rounded-none border-0 bg-transparent text-[10px] shadow-none focus-visible:bg-white"
                            aria-label={`${step.code} state`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              Object.keys(
                                workflowStateLabels,
                              ) as WorkflowState[]
                            ).map((state) => (
                              <SelectItem key={state} value={state}>
                                <BiInline
                                  en={workflowStateLabels[state].en}
                                  zh={workflowStateLabels[state].zh}
                                />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() =>
                            updateProcessStep(
                              step.code,
                              'required',
                              !step.required,
                            )
                          }
                        >
                          <StatusBadge tone={step.required ? 'amber' : 'gray'}>
                            <BiInline
                              en={step.required ? 'Required' : 'Optional'}
                              zh={step.required ? '必须' : '可选'}
                            />
                          </StatusBadge>
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <DeleteRowButton
                          label={`${step.no} · ${step.name}`}
                          onDelete={() => deleteWorkflowStep(step)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="border-t bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
              Rows can be added or deleted. Names, owner, state, and required
              flag are editable; the system code stays stable for CLI and Agent
              operations. /
              可新增或删除节点；名称、负责人、状态和必须标记可编辑，系统编码保持稳定。
            </p>
          </TabsContent>
          <TabsContent value="status" className="mt-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
              <span>
                Editing {project.id} · {project.name} / 编辑项目状态选项
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge tone="blue">
                  <BiInline en="Project specific" zh="按项目独立保存" />
                </StatusBadge>
                <Button
                  size="sm"
                  className="h-7 text-[10px]"
                  onClick={addProjectStatusDefinition}
                >
                  <Plus />
                  Add row / 新增
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[820px] text-[11px]">
                <TableHeader>
                  <TableRow className="bg-[#f2f0ea] hover:bg-[#f2f0ea]">
                    <TableHead className="w-60">Code / 系统编码</TableHead>
                    <TableHead>Status Name / 英文名称</TableHead>
                    <TableHead>中文名称</TableHead>
                    <TableHead className="w-28">Available / 可选</TableHead>
                    <TableHead className="w-20 text-center">
                      Action / 操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statuses.map((status) => (
                    <TableRow
                      key={status.code}
                      className={
                        status.code === projectStatus
                          ? 'h-9 bg-[#edf4f3]'
                          : 'h-9'
                      }
                    >
                      <TableCell>
                        <code className="text-[10px] text-muted-foreground">
                          {status.code}
                        </code>
                        {status.code === projectStatus ? (
                          <span className="ml-2">
                            <StatusBadge tone="blue">
                              Current / 当前
                            </StatusBadge>
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={status.name}
                          ariaLabel={`${status.code} English status name`}
                          onChange={(value) =>
                            updateProjectStatusDefinition(
                              status.code,
                              'name',
                              value,
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={status.nameZh}
                          ariaLabel={`${status.code} Chinese status name`}
                          onChange={(value) =>
                            updateProjectStatusDefinition(
                              status.code,
                              'nameZh',
                              value,
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() =>
                            updateProjectStatusDefinition(
                              status.code,
                              'active',
                              !status.active,
                            )
                          }
                        >
                          <StatusBadge tone={status.active ? 'green' : 'gray'}>
                            {status.active ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <DeleteRowButton
                          label={`${status.code} · ${status.name}`}
                          onDelete={() => deleteProjectStatusDefinition(status)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="border-t bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
              English and Chinese names are editable. The code stays stable for
              CLI and Agent operations; inactive options are hidden from new
              selections. /
              中英文名称可编辑，系统编码保持稳定；停用状态不再供新选择。
            </p>
          </TabsContent>
          <TabsContent value="resources" className="mt-0">
            {costLockReason && (
              <output className="block border-b bg-amber-50 p-3 text-sm text-amber-900">
                {costLockReason}{' '}
                主数据汇率仍可更新；已锁定的成本保留原汇率，不会随主数据变更。
              </output>
            )}
            <div className="min-w-0">
              <div className="flex items-center justify-between border-b bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
                <span>HQ L1–L4 · Local L1–L4 · ARP L0–L4 · SGD/MD</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    onClick={addResource}
                  >
                    <Plus />
                    Add row / 新增
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={async () =>
                      announce(
                        (await onSave())
                          ? costLockReason
                            ? 'Master rates saved; locked costs are unchanged. / 主数据汇率已保存，已锁定成本保持不变。'
                            : 'RE Type catalogue saved. Apply Master Rates in Cost to use changes. / 主数据已保存，可在成本页应用汇率。'
                          : 'Save failed; edits retained / 保存失败，修改已保留',
                      )
                    }
                  >
                    <Save />
                    Save rates
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table className="min-w-[1320px] text-[11px]">
                  <TableHeader>
                    <TableRow className="bg-[#f2f0ea]">
                      {[
                        'Code / 编码',
                        'Name / 名称',
                        'Pool',
                        'Level',
                        'MD Rate / 人天汇率',
                        'MD / MM',
                        'Hour / MD',
                        'MM Rate / 人月',
                        'Hour Rate / 人时',
                        'Effective From',
                        'Effective To',
                        'Status',
                        'Action / 操作',
                      ].map((label) => (
                        <TableHead
                          key={label}
                          className="h-9 whitespace-nowrap px-2 text-[10px]"
                        >
                          {label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resources.map((row) => {
                      const rate = getResourceRateConversions(row);
                      return (
                        <TableRow key={row.id} className="h-9">
                          <TableCell className="font-semibold">
                            {row.code}
                          </TableCell>
                          <TableCell>
                            <EditCell
                              value={row.name}
                              ariaLabel={`${row.code} name`}
                              onChange={(v) =>
                                updateResource(row.id, 'name', v)
                              }
                            />
                          </TableCell>
                          <TableCell>{row.pool ?? '—'}</TableCell>
                          <TableCell>{row.level ?? '—'}</TableCell>
                          <TableCell>
                            <EditCell
                              type="number"
                              value={row.mandayRate}
                              ariaLabel={`${row.code} manday rate`}
                              onChange={(v) =>
                                updateResource(
                                  row.id,
                                  'mandayRate',
                                  Math.max(0, Number(v) || 0),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <EditCell
                              type="number"
                              value={row.mandaysPerMonth}
                              ariaLabel={`${row.code} MD per month`}
                              onChange={(v) =>
                                updateResource(
                                  row.id,
                                  'mandaysPerMonth',
                                  Math.max(0.01, Number(v) || 0.01),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <EditCell
                              type="number"
                              value={row.hoursPerManday}
                              ariaLabel={`${row.code} hours per MD`}
                              onChange={(v) =>
                                updateResource(
                                  row.id,
                                  'hoursPerManday',
                                  Math.max(0.01, Number(v) || 0.01),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="financial-numeral">
                            {formatSgd(rate.perMonth)}
                          </TableCell>
                          <TableCell className="financial-numeral">
                            {formatSgd(rate.perHour)}
                          </TableCell>
                          <TableCell>
                            <EditCell
                              type="date"
                              value={row.effectiveFrom}
                              ariaLabel={`${row.code} effective from`}
                              onChange={(v) =>
                                updateResource(row.id, 'effectiveFrom', v)
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <EditCell
                              type="date"
                              value={row.effectiveTo}
                              ariaLabel={`${row.code} effective to`}
                              onChange={(v) =>
                                updateResource(row.id, 'effectiveTo', v)
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() =>
                                updateResource(row.id, 'active', !row.active)
                              }
                            >
                              <StatusBadge tone={row.active ? 'green' : 'gray'}>
                                {row.active ? 'Active' : 'Inactive'}
                              </StatusBadge>
                            </button>
                          </TableCell>
                          <TableCell className="text-center">
                            <DeleteRowButton
                              label={`${row.code} · ${row.name}`}
                              onDelete={() => deleteResource(row)}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="border-t bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
                MM rate = MD rate × MD/MM. Hour rate = MD rate ÷ Hour/MD. HQ
                rows automatically enable travel. / 人月、人时汇率自动换算。
              </p>
            </div>
          </TabsContent>
          <TabsContent value="subcontract" className="mt-0">
            <TableToolbar count={subcontract.length} onAdd={addSubcontract} />
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow className="bg-[#f2f0ea]">
                    {[
                      'Code',
                      'Item / 条目',
                      'BU',
                      'Supplier / 供应商',
                      'Pricing Basis / 计价依据',
                      'Currency',
                      'Status',
                      'Action / 操作',
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subcontract.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <EditCell
                          value={row.code}
                          ariaLabel="Subcontract code"
                          onChange={(v) => updateSubcontract(row.id, 'code', v)}
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.item}
                          ariaLabel="Subcontract item"
                          onChange={(v) => updateSubcontract(row.id, 'item', v)}
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.bu}
                          ariaLabel="Subcontract BU"
                          onChange={(v) => updateSubcontract(row.id, 'bu', v)}
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.supplier}
                          ariaLabel="Supplier"
                          onChange={(v) =>
                            updateSubcontract(row.id, 'supplier', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.pricingBasis}
                          ariaLabel="Pricing basis"
                          onChange={(v) =>
                            updateSubcontract(row.id, 'pricingBasis', v)
                          }
                        />
                      </TableCell>
                      <TableCell>{row.currency}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() =>
                            updateSubcontract(row.id, 'active', !row.active)
                          }
                        >
                          <StatusBadge tone={row.active ? 'green' : 'gray'}>
                            {row.active ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <DeleteRowButton
                          label={`${row.code} · ${row.item}`}
                          onDelete={() =>
                            deleteUnreferencedRow(
                              `${row.code} · ${row.item}`,
                              () =>
                                setSubcontractItems((rows) =>
                                  rows.filter((item) => item.id !== row.id),
                                ),
                              `Subcontract item ${row.code} deleted. / 已删除分包条目 ${row.code}。`,
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="supplemental" className="mt-0">
            <TableToolbar count={supplemental.length} onAdd={addSupplemental} />
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow className="bg-[#f2f0ea]">
                    {[
                      'Code',
                      'Name / 名称',
                      'Statement',
                      'Default SGD',
                      'Owner',
                      'Source',
                      'Status',
                      'Action / 操作',
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplemental.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <EditCell
                          value={row.code}
                          ariaLabel="Supplemental code"
                          onChange={(v) =>
                            updateSupplemental(row.id, 'code', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.name}
                          ariaLabel="Supplemental name"
                          onChange={(v) =>
                            updateSupplemental(row.id, 'name', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.statementCode}
                          ariaLabel="Statement code"
                          onChange={(v) =>
                            updateSupplemental(row.id, 'statementCode', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          type="number"
                          value={row.defaultAmount}
                          ariaLabel="Default amount"
                          onChange={(v) =>
                            updateSupplemental(
                              row.id,
                              'defaultAmount',
                              roundMoney(Number(v) || 0),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.owner}
                          ariaLabel="Owner"
                          onChange={(v) =>
                            updateSupplemental(row.id, 'owner', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.sourceNote}
                          ariaLabel="Source"
                          onChange={(v) =>
                            updateSupplemental(row.id, 'sourceNote', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() =>
                            updateSupplemental(row.id, 'active', !row.active)
                          }
                        >
                          <StatusBadge tone={row.active ? 'green' : 'gray'}>
                            {row.active ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <DeleteRowButton
                          label={`${row.code} · ${row.name}`}
                          onDelete={() =>
                            deleteUnreferencedRow(
                              `${row.code} · ${row.name}`,
                              () =>
                                setSupplementalCostItems((rows) =>
                                  rows.filter((item) => item.id !== row.id),
                                ),
                              `Supplemental cost ${row.code} deleted. / 已删除补充成本 ${row.code}。`,
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="maintenance" className="mt-0">
            <div className="flex items-center justify-between border-b bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
              <span>{maintenance.length} records / 条记录</span>
              <div className="flex gap-2">
                <input
                  ref={maintenanceImportRef}
                  type="file"
                  accept=".json,.xlsx"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importMaintenance(file);
                    event.target.value = '';
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px]"
                  onClick={() => maintenanceImportRef.current?.click()}
                >
                  <Upload /> Import JSON/XLSX / 导入
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-[10px]"
                  onClick={addMaintenance}
                >
                  <Plus /> Add row / 新增
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[1400px]">
                <TableHeader>
                  <TableRow className="bg-[#f2f0ea]">
                    {[
                      'Client',
                      'Service',
                      'Product / Model',
                      'Service Level',
                      'Site',
                      'Months',
                      'Qty',
                      'Cost',
                      'Quoted',
                      'Unit / Year',
                      'Quote Date',
                      'Outcome',
                      'Source',
                      'Action / 操作',
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {maintenance.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <EditCell
                          value={row.client}
                          ariaLabel="Client"
                          onChange={(v) =>
                            updateMaintenance(row.id, 'client', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.service}
                          ariaLabel="Service"
                          onChange={(v) =>
                            updateMaintenance(row.id, 'service', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.productModel}
                          ariaLabel="Product model"
                          onChange={(v) =>
                            updateMaintenance(row.id, 'productModel', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.serviceLevel}
                          ariaLabel="Service level"
                          onChange={(v) =>
                            updateMaintenance(row.id, 'serviceLevel', v)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          value={row.site}
                          ariaLabel="Site"
                          onChange={(v) => updateMaintenance(row.id, 'site', v)}
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          type="number"
                          value={row.coverageMonths}
                          ariaLabel="Coverage months"
                          onChange={(v) =>
                            updateMaintenance(
                              row.id,
                              'coverageMonths',
                              Math.max(0, Number(v) || 0),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          type="number"
                          value={row.quantity}
                          ariaLabel="Quantity"
                          onChange={(v) =>
                            updateMaintenance(
                              row.id,
                              'quantity',
                              Math.max(0, Number(v) || 0),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          type="number"
                          value={row.costAmount}
                          ariaLabel="Cost amount"
                          onChange={(v) =>
                            updateMaintenance(
                              row.id,
                              'costAmount',
                              roundMoney(Number(v) || 0),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <EditCell
                          type="number"
                          value={row.quotedAmount}
                          ariaLabel="Quoted amount"
                          onChange={(v) =>
                            updateMaintenance(
                              row.id,
                              'quotedAmount',
                              roundMoney(Number(v) || 0),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="financial-numeral">
                        {unitAnnualMaintenanceQuote(row) === null
                          ? '不可比较'
                          : formatSgd(unitAnnualMaintenanceQuote(row)!)}
                      </TableCell>
                      <TableCell>
                        <EditCell
                          type="date"
                          value={row.quoteDate}
                          ariaLabel="Quote date"
                          onChange={(v) =>
                            updateMaintenance(row.id, 'quoteDate', v)
                          }
                        />
                      </TableCell>
                      <TableCell>{row.outcome}</TableCell>
                      <TableCell>
                        <EditCell
                          value={row.source}
                          ariaLabel="Source"
                          onChange={(v) =>
                            updateMaintenance(row.id, 'source', v)
                          }
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <DeleteRowButton
                          label={`${row.client} · ${row.service}`}
                          onDelete={() =>
                            deleteUnreferencedRow(
                              `${row.client} · ${row.service}`,
                              () =>
                                setMaintenancePriceRecords((rows) =>
                                  rows.filter((item) => item.id !== row.id),
                                ),
                              `Maintenance history deleted. / 已删除维保历史记录。`,
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="assumptions" className="mt-0">
            <QuoteCatalogImport
              key={project.id}
              projectId={project.id}
              announce={announce}
              onImport={(library, templates) => {
                setAssumptionLibrary((rows) => [...rows, ...library]);
                setQuoteTemplates((rows) => [...rows, ...templates]);
              }}
            />
            <AssumptionLibraryView
              library={assumptionLibrary}
              setLibrary={setAssumptionLibrary}
              templates={quoteTemplates}
              setTemplates={setQuoteTemplates}
              query={query}
              client={project.client}
              announce={announce}
            />
          </TabsContent>
          <TabsContent value="quote-templates" className="mt-0">
            <QuoteCatalogImport
              key={project.id}
              projectId={project.id}
              announce={announce}
              onImport={(library, templates) => {
                setAssumptionLibrary((rows) => [...rows, ...library]);
                setQuoteTemplates((rows) => [...rows, ...templates]);
              }}
            />
            <QuoteTemplatesView
              key={project.id}
              templates={quoteTemplates}
              setTemplates={setQuoteTemplates}
              library={assumptionLibrary}
              query={query}
              client={project.client}
              selectedId={selectedQuoteTemplateId}
              setSelectedId={setSelectedQuoteTemplateId}
              announce={announce}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

/** Shared compact toolbar for editable reference tables. */
function TableToolbar({ count, onAdd }: { count: number; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between border-b bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
      <span>{count} records / 条记录</span>
      <Button size="sm" className="h-7 text-[10px]" onClick={onAdd}>
        <Plus />
        Add row / 新增
      </Button>
    </div>
  );
}

/** Consistent compact delete control used by every Master Data table. */
function DeleteRowButton({
  label,
  onDelete,
}: {
  label: string;
  onDelete: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:bg-red-50 hover:text-red-700"
      aria-label={`Delete ${label}`}
      title={`Delete ${label} / 删除`}
      onClick={onDelete}
    >
      <Trash2 />
    </Button>
  );
}
