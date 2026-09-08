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
  type ResourceType,
} from '@/features/cost/domain';
import {
  unitAnnualMaintenanceQuote,
  type MaintenancePriceRecord,
  type SupplementalCostItem,
} from '@/features/master-data/domain';
import type { SubcontractItem } from '@/features/master-data/types';
import type { CatalogItem } from '@/features/cpq/domain';
import { GlobalCpqCatalog } from './global-cpq-catalog';
import { WorkflowTemplateEditor } from './workflow-template-editor';
import type {
  ProjectStatusDefinition,
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
import {
  masterDataTabs,
  isMasterDataTab,
  type MasterDataTab,
} from './navigation';
import {
  createResourceType,
  editResourceType,
  resourceClassificationIssue,
  resourceLevels,
  resourcePools,
} from './resource-editing';

type Props = {
  editingDisabled?: boolean;
  saveLabel?: string;
  activeTab: MasterDataTab;
  onTabChange: (tab: MasterDataTab) => void;
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
  processSteps: WorkflowStep[];
  setProcessSteps: React.Dispatch<React.SetStateAction<WorkflowStep[]>>;
  projectStatusDefinitions: ProjectStatusDefinition[];
  setProjectStatusDefinitions: React.Dispatch<
    React.SetStateAction<ProjectStatusDefinition[]>
  >;
  catalog: CatalogItem[];
  setCatalog: React.Dispatch<React.SetStateAction<CatalogItem[]>>;
  announce: (message: string) => void;
};

const denseInput =
  'h-8 min-w-20 rounded-none border-0 bg-transparent px-2 text-[11px] shadow-none focus-visible:relative focus-visible:z-20 focus-visible:bg-white focus-visible:ring-1';

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
  min,
  step,
  placeholder,
}: {
  value: string | number;
  type?: 'text' | 'number' | 'date';
  onChange: (value: string) => void;
  ariaLabel: string;
  min?: number;
  step?: number | 'any';
  placeholder?: string;
}) {
  return (
    <Input
      className={denseInput}
      type={type}
      value={value}
      aria-label={ariaLabel}
      min={min}
      step={step}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Classification is visible and editable; dependent fields save atomically. */
export function ResourceIdentityCells({
  row,
  onChange,
}: {
  row: ResourceType;
  onChange: <K extends keyof ResourceType>(
    key: K,
    value: ResourceType[K],
  ) => void;
}) {
  const internal = row.category === 'internal';
  const issue = resourceClassificationIssue(row);
  return (
    <>
      <TableCell className="font-semibold">
        <EditCell
          value={row.code}
          ariaLabel={`${row.code} code`}
          onChange={(value) => onChange('code', value)}
        />
      </TableCell>
      <TableCell>
        <EditCell
          value={row.name}
          ariaLabel={`${row.code} name`}
          onChange={(value) => onChange('name', value)}
        />
      </TableCell>
      <TableCell>
        <select
          className={`${denseInput} min-w-36`}
          value={row.category}
          aria-label={`${row.code} category`}
          onChange={(event) =>
            onChange('category', event.target.value as ResourceType['category'])
          }
        >
          {!['internal', 'subcontract'].includes(row.category) && (
            <option value={row.category} disabled>
              Select / 请选择
            </option>
          )}
          <option value="internal">Internal / 自有</option>
          <option value="subcontract">Subcontract / 分包</option>
        </select>
        {issue && (
          <p role="alert" className="max-w-60 px-2 text-[10px] text-red-700">
            {issue}
          </p>
        )}
      </TableCell>
      <TableCell>
        <select
          className={denseInput}
          value={row.pool ?? ''}
          disabled={!internal}
          aria-label={`${row.code} pool`}
          onChange={(event) =>
            onChange('pool', event.target.value as ResourceType['pool'])
          }
        >
          {!resourcePools.some((pool) => pool === row.pool) && (
            <option value={row.pool ?? ''} disabled>
              {row.pool
                ? `${row.pool} / 无效`
                : internal
                  ? 'Select / 请选择'
                  : '—'}
            </option>
          )}
          {resourcePools.map((pool) => (
            <option key={pool} value={pool}>
              {pool}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell>
        <select
          className={denseInput}
          value={row.level ?? ''}
          disabled={!internal}
          aria-label={`${row.code} level`}
          onChange={(event) =>
            onChange('level', event.target.value as ResourceType['level'])
          }
        >
          {!resourceLevels.some((level) => level === row.level) && (
            <option value={row.level ?? ''} disabled>
              {row.level
                ? `${row.level} / 无效`
                : internal
                  ? 'Select / 请选择'
                  : '—'}
            </option>
          )}
          {resourceLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </TableCell>
    </>
  );
}

export function MasterDataView(props: Props) {
  const {
    editingDisabled = false,
    saveLabel,
    activeTab,
    onTabChange,
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
    processSteps,
    setProcessSteps,
    projectStatusDefinitions,
    setProjectStatusDefinitions,
    announce,
    onSave,
    catalog,
    setCatalog,
  } = props;
  const [query, setQuery] = useState('');
  const workflow = activeTab === 'workflow';
  const currentSaveLabel =
    saveLabel ||
    (workflow ? 'Preview & Publish' : 'Save this tab / 保存当前页签');
  const tabCounts: Record<MasterDataTab, number> = {
    'cpq-catalog': catalog.length,
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
      rows.map((row) =>
        row.id === id ? editResourceType(row, key, value) : row,
      ),
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
  const resources = resourceTypes.filter((row) =>
    matches(
      row.code,
      row.name,
      row.category,
      row.category === 'internal' ? '自有' : '分包',
      row.pool,
      row.level,
    ),
  );
  const subcontract = subcontractItems.filter((row) =>
    matches(row.code, row.item, row.bu, row.unit, row.currency),
  );
  const supplemental = supplementalCostItems.filter((row) =>
    matches(row.code, row.name, row.statementCode, row.owner),
  );
  const maintenance = maintenancePriceRecords.filter((row) =>
    matches(row.client, row.service, row.productModel, row.site, row.source),
  );
  const statuses = projectStatusDefinitions.filter((row) =>
    matches(row.code, row.name, row.nameZh, row.active),
  );

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

  /** Adds a reusable status definition for future projects. */
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
    setProjectStatusDefinitions(remaining);
    announce(
      `Project status ${status.name} deleted. / 已删除项目状态 ${status.nameZh || status.name}。`,
    );
  };

  /** The user chooses each new resource's classification explicitly. */
  const addResource = () => {
    setQuery('');
    const row = createResourceType(
      newRecordId('rt'),
      newCodeSuffix(),
      `${new Date().getFullYear()}-01-01`,
    );
    setResourceTypes((rows) => [...rows, row]);
    announce(
      'RE Type added: select Category, Pool and Level. / 已新增 RE Type，可设置种类、Pool 和 Level。',
    );
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
        unit: 'pcs',
        unitPrice: null,
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

  /** Existing projects retain their own RE Type snapshots after removal. */
  const deleteResource = (row: ResourceType) => {
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
          titleZh={workflow ? '' : '基础数据管理'}
          description={
            workflow
              ? 'Configure the global workflow and preview changes before publishing to ongoing projects.'
              : 'Global reference data for future projects. Existing project and cost-version snapshots stay unchanged.'
          }
          descriptionZh={
            workflow
              ? undefined
              : '全局主数据供未来项目使用；维护不读取项目，已有项目及成本版本保留采用时的数据快照。'
          }
          action={
            <Button
              size="sm"
              disabled={editingDisabled}
              onClick={async () => {
                if (await onSave())
                  announce(
                    workflow
                      ? 'Workflow template saved.'
                      : 'Global master data saved / 全局主数据已保存。',
                  );
              }}
            >
              <Save /> {currentSaveLabel}
            </Button>
          }
        />
        <p className="border-t bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {workflow
            ? 'Publishing updates pending steps in ongoing projects. Active deadlines are retained unless explicitly recalculated; completed history and cost snapshots remain unchanged.'
            : 'Global / 全局共享 · 新项目取得独立副本。已有 Draft 也不会自动更新汇率；如需采用新汇率，请在目标成本版本明确应用。'}
        </p>
      </section>
      <section className="min-w-0 overflow-hidden border border-border bg-card">
        <Tabs
          value={activeTab === 'status' ? 'workflow' : activeTab}
          onValueChange={(value) => {
            if (!isMasterDataTab(value)) return;
            onTabChange(value);
            setQuery('');
          }}
        >
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center justify-between gap-3 pb-2">
              <p className="text-xs text-muted-foreground">
                {workflow
                  ? 'Reference Libraries'
                  : 'Reference Libraries / 基础数据与模板库'}
              </p>
              <div className="relative w-[260px] max-w-[60%]">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 rounded-sm bg-white pl-8 text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search current master-data tab"
                  placeholder={
                    workflow
                      ? 'Search Workflow Steps'
                      : 'Search this tab / 搜索当前页签'
                  }
                />
              </div>
            </div>
            <div className="overflow-x-auto pb-1">
              <TabsList
                variant="line"
                aria-label="Master Data libraries"
                className="min-w-max justify-start"
              >
                {masterDataTabs
                  .filter((tab) => tab.value !== 'status')
                  .map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="h-8 px-2"
                    >
                      {tab.label}
                      <span className="text-[10px] opacity-60">
                        {workflow && tab.value === 'workflow'
                          ? ''
                          : tab.labelZh}
                      </span>
                      <span className="financial-numeral rounded-sm bg-muted px-1 text-[10px]">
                        {tabCounts[tab.value]}
                      </span>
                    </TabsTrigger>
                  ))}
              </TabsList>
            </div>
          </div>
          <fieldset disabled={editingDisabled} className="min-w-0 border-0 p-0">
            <TabsContent value="cpq-catalog" className="mt-0">
              <GlobalCpqCatalog
                items={catalog}
                setItems={setCatalog}
                query={query}
              />
            </TabsContent>
            <TabsContent value="workflow" className="mt-0">
              <WorkflowTemplateEditor
                steps={processSteps}
                setSteps={setProcessSteps}
                query={query}
                disabled={editingDisabled}
                announce={announce}
              />
            </TabsContent>
            <TabsContent value="status" className="mt-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
                <span>Default status definitions / 默认项目状态字典</span>
                <div className="flex items-center gap-2">
                  <StatusBadge tone="blue">
                    <BiInline en="Global defaults" zh="全局默认值" />
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
                      <TableRow key={status.code} className="h-9">
                        <TableCell>
                          <code className="text-[10px] text-muted-foreground">
                            {status.code}
                          </code>
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
                            <StatusBadge
                              tone={status.active ? 'green' : 'gray'}
                            >
                              {status.active ? 'Active' : 'Inactive'}
                            </StatusBadge>
                          </button>
                        </TableCell>
                        <TableCell className="text-center">
                          <DeleteRowButton
                            label={`${status.code} · ${status.name}`}
                            onDelete={() =>
                              deleteProjectStatusDefinition(status)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="border-t bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
                English and Chinese names are editable. The code stays stable
                for CLI and Agent operations; inactive options are hidden from
                new selections. /
                中英文名称可编辑，系统编码保持稳定；停用状态不再供新选择。
              </p>
            </TabsContent>
            <TabsContent value="resources" className="mt-0">
              <div className="min-w-0">
                <div className="flex items-center justify-between border-b bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
                  <span>
                    Internal / 自有 · Subcontract / 分包 · LOCAL / ARP / HQ /
                    OTHER · L0–L4 · SGD/MD
                  </span>
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
                            ? 'Global RE Types saved. Existing costs are unchanged. / 全局资源费率已保存，已有成本不变。'
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
                  <Table className="min-w-[1480px] text-[11px]">
                    <TableHeader>
                      <TableRow className="bg-[#f2f0ea]">
                        {[
                          'Code / 编码',
                          'Name / 名称',
                          'Category / 种类',
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
                            <ResourceIdentityCells
                              row={row}
                              onChange={(key, value) =>
                                updateResource(row.id, key, value)
                              }
                            />
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
                                <StatusBadge
                                  tone={row.active ? 'green' : 'gray'}
                                >
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
                  rows automatically enable travel. Classification changes keep
                  the code unchanged. / 人月、人时汇率自动换算；自有人员可选择
                  Pool 和 Level，HQ 自动启用差旅；OTHER（如远程支持）不计 HQ
                  差旅，也不适用 3% allowance。分包不使用人员 Pool 和
                  Level。修改分类不会改写编码。
                </p>
              </div>
            </TabsContent>
            <TabsContent value="subcontract" className="mt-0">
              <TableToolbar count={subcontract.length} onAdd={addSubcontract} />
              <div className="overflow-x-auto">
                <Table className="min-w-[1000px]">
                  <TableHeader>
                    <TableRow className="bg-[#f2f0ea]">
                      {[
                        'Code',
                        'Item / 条目',
                        'BU',
                        'Unit / 单位',
                        'Unit Price / 参考单价',
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
                            onChange={(v) =>
                              updateSubcontract(row.id, 'code', v)
                            }
                          />
                        </TableCell>
                        <TableCell className="min-w-[260px]">
                          <EditCell
                            value={row.item}
                            ariaLabel="Subcontract item"
                            onChange={(v) =>
                              updateSubcontract(row.id, 'item', v)
                            }
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
                            value={row.unit ?? ''}
                            ariaLabel={`${row.code} unit`}
                            placeholder="Not set"
                            onChange={(v) =>
                              updateSubcontract(row.id, 'unit', v || null)
                            }
                          />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <EditCell
                            value={row.unitPrice ?? ''}
                            type="number"
                            min={0}
                            step="any"
                            ariaLabel={`${row.code} unit price`}
                            placeholder="Not priced"
                            onChange={(v) => {
                              const price = v === '' ? null : Number(v);
                              if (
                                price !== null &&
                                (!Number.isFinite(price) ||
                                  price < 0 ||
                                  price > 1e12)
                              ) {
                                announce(
                                  'Enter a unit price between 0 and 1,000,000,000,000. / 单价须为 0 至 1,000,000,000,000 之间的数字。',
                                );
                                return;
                              }
                              updateSubcontract(row.id, 'unitPrice', price);
                            }}
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
                <p className="border-t bg-[#f8f7f3] px-3 py-2 text-[10px] text-muted-foreground">
                  Unit Price is a reference price in the listed currency. Blank
                  means not priced; 0 means zero cost. Catalogue edits do not
                  create or update project costs. /
                  单价按本行币种填写；留空为未定价， 0
                  为零成本。目录更新不会自动生成或修改项目成本。
                </p>
              </div>
            </TabsContent>
            <TabsContent value="supplemental" className="mt-0">
              <TableToolbar
                count={supplemental.length}
                onAdd={addSupplemental}
              />
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
                            onChange={(v) =>
                              updateMaintenance(row.id, 'site', v)
                            }
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
              <AssumptionLibraryView
                library={assumptionLibrary}
                setLibrary={setAssumptionLibrary}
                templates={quoteTemplates}
                query={query}
                announce={announce}
              />
            </TabsContent>
            <TabsContent value="quote-templates" className="mt-0">
              <QuoteTemplatesView
                templates={quoteTemplates}
                setTemplates={setQuoteTemplates}
                library={assumptionLibrary}
                query={query}
                announce={announce}
              />
            </TabsContent>
          </fieldset>
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
