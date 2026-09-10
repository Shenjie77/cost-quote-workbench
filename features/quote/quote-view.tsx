/** Pricing, client-template output, assumptions, and quotation history. */

import { useEffect, useRef, useState } from 'react';
import { Download, FileCheck2, Plus, Save, Trash2 } from 'lucide-react';
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
import { BiInline, BiText } from '@/components/workbench/bilingual-text';
import { SectionHeading } from '@/components/workbench/section-heading';
import { StatusBadge } from '@/components/workbench/status-badge';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import type { CostVersionState } from '@/features/cost/domain';
import { ContextBand } from '@/features/projects/project-context-band';
import {
  calculatePricing,
  type PricingSettings,
} from '@/features/quote/domain';
import { downloadQuoteWorkbook } from '@/features/quote/export-quote-workbook';
import type {
  AssumptionDefinition,
  QuoteAssumption,
  QuoteHistoryRecord,
  QuoteHistoryStatus,
  QuoteTemplate,
} from '@/features/quote/types';
import { Textarea } from '@/components/ui/textarea';
import { AssumptionPicker } from './assumption-picker';
import { QuoteTemplatePicker } from './template-picker';
import {
  applicableTemplates,
  matchesClient,
  referenceAssumptions,
} from './catalog-domain';
import { ManualHistoryForm } from './manual-history-form';
import { validatePricingSettings } from './domain';
import { formatSgd } from '@/lib/formatters';
import type { QuoteMasterDataTab } from '@/features/master-data/navigation';
import type { BuCostAllocation } from './profit-share';
import { quoteProfitShareSnapshot } from './history-record';
import { ProfitShareSummary } from './profit-share-summary';

const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;

export function QuoteView({
  project,
  proposalNumber,
  onProposalNumberChange,
  activeVersion,
  versionState,
  totalCost,
  costAllocation,
  costErrors,
  decisionError,
  onSave,
  onOpenMasterData,
  onApplyProfitShare,
  onExportStateChange,
  exportInProgress,
  pricing,
  setPricing,
  assumptionLibrary,
  quoteTemplates,
  selectedQuoteTemplateId,
  setSelectedQuoteTemplateId,
  quoteAssumptions,
  setQuoteAssumptions,
  quoteHistory,
  setQuoteHistory,
  announce,
}: {
  project: CostExportSnapshot['project'];
  proposalNumber?: string;
  onProposalNumberChange?: (value: string) => void;
  activeVersion: string;
  versionState: CostVersionState;
  totalCost: number;
  costAllocation?: BuCostAllocation;
  costErrors: string[];
  decisionError?: string;
  onSave: () => Promise<boolean>;
  /** Catalog maintenance stays outside Quote; this callback only changes views. */
  onOpenMasterData: (tab: QuoteMasterDataTab) => void;
  /** Explicitly captures the published global rates for this pricing draft. */
  onApplyProfitShare?: () => Promise<boolean>;
  /** Parent prevents cross-project switching while allowing same-project navigation. */
  onExportStateChange: (exporting: boolean) => void;
  exportInProgress: boolean;
  pricing: PricingSettings;
  setPricing: React.Dispatch<React.SetStateAction<PricingSettings>>;
  assumptionLibrary: AssumptionDefinition[];
  quoteTemplates: QuoteTemplate[];
  selectedQuoteTemplateId: string;
  setSelectedQuoteTemplateId: React.Dispatch<React.SetStateAction<string>>;
  quoteAssumptions: QuoteAssumption[];
  setQuoteAssumptions: React.Dispatch<React.SetStateAction<QuoteAssumption[]>>;
  quoteHistory: QuoteHistoryRecord[];
  setQuoteHistory: React.Dispatch<React.SetStateAction<QuoteHistoryRecord[]>>;
  announce: (message: string) => void;
}) {
  const [showManualHistory, setShowManualHistory] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isApplyingRates, setIsApplyingRates] = useState(false);
  const applyingRates = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const result = calculatePricing(totalCost, pricing, costAllocation);
  const template = quoteTemplates.find(
    (item) => item.id === selectedQuoteTemplateId,
  );
  const choices = applicableTemplates(quoteTemplates, project.client);
  const templateAvailable = Boolean(
    template?.active && matchesClient(template.clientPattern, project.client),
  );
  const outputErrors = [
    ...costErrors,
    ...validatePricingSettings(pricing, totalCost, costAllocation),
    ...(!templateAvailable
      ? [
          'Select an active template matching this client / 请选择当前客户适用的启用模板',
        ]
      : []),
    ...(quoteAssumptions.some((row) => row.included && !row.text.trim())
      ? ['Included assumption text is required / 已包含假设的正文不可为空']
      : []),
  ];
  /** Explicit selection applies eligible defaults once, retaining all local changes. */
  const applyTemplate = (id: string) => {
    const chosen = choices.find((item) => item.id === id);
    if (!chosen) return;
    setSelectedQuoteTemplateId(id);
    setQuoteAssumptions((rows) =>
      referenceAssumptions(
        rows,
        assumptionLibrary,
        chosen.defaultAssumptionIds,
        project.client,
      ),
    );
    announce(
      'Template selected; eligible default assumptions added without overwriting existing text. / 已选择模板并补入适用默认假设，原内容保留。',
    );
  };
  const updateNumber = (key: keyof PricingSettings, raw: string) => {
    const value = Number(raw);
    setPricing((current) => ({
      ...current,
      [key]: Number.isFinite(value) ? value : 0,
    }));
  };

  /** Generates one real XLSX file and records the exact commercial snapshot. */
  const generateDraft = async () => {
    if (!template || isExporting || exportInProgress || applyingRates.current)
      return;
    if (decisionError) {
      announce(decisionError);
      return;
    }
    if (outputErrors.length) {
      announce(
        `Quotation validation failed: ${outputErrors[0]} / 请先修正输入`,
      );
      return;
    }
    if (versionState !== 'Confirmed') {
      announce(
        'Confirm the selected cost version before generating a customer quotation. / 生成客户报价前请先确认当前成本版本。',
      );
      return;
    }
    setIsExporting(true);
    onExportStateChange(true);
    const timestamp = new Date();
    const profitShareMasterDataRevision = pricing.profitShareMasterDataRevision;
    const quoteNumber = `QT-${project.id.replace(/^PRJ-/, '')}-${activeVersion}-${timestamp
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14)}`;
    try {
      const exported = await downloadQuoteWorkbook({
        project,
        quoteNumber,
        costVersion: activeVersion,
        template,
        assumptions: quoteAssumptions,
        pricing: result,
        profitShareMasterDataRevision,
      });
      const history: QuoteHistoryRecord = {
        id: newId('quote-history'),
        quoteNumber,
        generatedAt: timestamp.toISOString(),
        costVersion: activeVersion,
        templateId: template.id,
        status: 'Draft',
        costAmount: result.cost,
        quoteBeforeTax: result.quoteBeforeTax,
        gstAmount: result.gstAmount,
        quoteAfterTax: result.quoteAfterTax,
        grossMarginPercent: result.grossMarginPercent,
        profitShareSnapshot: quoteProfitShareSnapshot(
          result,
          profitShareMasterDataRevision,
        ),
        note: `Generated ${exported.fileName}`,
        templateSnapshot: structuredClone(template),
        assumptionSnapshots: structuredClone(
          quoteAssumptions.filter((row) => row.included),
        ),
      };
      // Parent keeps the project fixed during export. Its state setter survives
      // navigation away from this view, so every completed output keeps history.
      setQuoteHistory((records) => [history, ...records]);
      announce(
        `Exported ${exported.fileName} and recorded quotation history. / 已导出报价并记录历史。`,
      );
    } catch (error) {
      announce(
        `Quote export failed: ${error instanceof Error ? error.message : 'Unknown error'} / 报价导出失败。`,
      );
    } finally {
      onExportStateChange(false);
      if (mounted.current) setIsExporting(false);
    }
  };

  /** Adds a historical reference without generating a new client document. */
  const addManualHistory = () => setShowManualHistory(true);

  return (
    <div className="space-y-4">
      <ContextBand
        proposalNumber={proposalNumber}
        onProposalNumberChange={onProposalNumberChange}
        project={project}
        costVersion={activeVersion}
        versionStatus={versionState}
        action={
          <StatusBadge tone="amber">
            <BiInline en="Pricing draft" zh="定价草稿" />
          </StatusBadge>
        }
      />
      <QuoteTemplatePicker
        key={project.id}
        templates={quoteTemplates}
        client={project.client}
        selectedId={selectedQuoteTemplateId}
        onApply={applyTemplate}
        onManage={() => onOpenMasterData('quote-templates')}
        busy={exportInProgress}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <section className="border border-border bg-card">
          <SectionHeading
            index="01"
            title="Pricing Parameters"
            titleZh="定价参数"
            description="Pricing is saved with the project and recalculated from the active cost version."
            descriptionZh="定价参数随项目保存，并基于当前成本版本实时重算。"
          />
          <div className="divide-y divide-border text-xs">
            <div className="grid grid-cols-[1fr_180px] items-center gap-4 px-4 py-3">
              <BiText
                en="Cost with Risk"
                zh="含风险项目总成本"
                className="font-medium"
              />
              <span className="financial-numeral text-right font-semibold">
                {formatSgd(result.cost)}
              </span>
            </div>
            <ProfitShareSummary
              result={result}
              masterDataRevision={pricing.profitShareMasterDataRevision}
              onManage={() => onOpenMasterData('profit-share')}
              applying={isApplyingRates}
              disabled={exportInProgress || isExporting}
              onApply={
                onApplyProfitShare
                  ? async () => {
                      if (
                        applyingRates.current ||
                        exportInProgress ||
                        isExporting
                      )
                        return;
                      applyingRates.current = true;
                      setIsApplyingRates(true);
                      try {
                        announce(
                          (await onApplyProfitShare())
                            ? 'Latest profit share rates applied and saved.'
                            : 'Profit share rates were not applied. The current selection is retained.',
                        );
                      } catch (error) {
                        announce(
                          `Unable to apply profit share rates: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        );
                      } finally {
                        applyingRates.current = false;
                        if (mounted.current) setIsApplyingRates(false);
                      }
                    }
                  : undefined
              }
            />
            <label
              htmlFor="target-gross-margin"
              className="grid grid-cols-[1fr_180px] items-center gap-4 px-4 py-2.5"
            >
              <BiText
                en="Target Sales GP (%)"
                zh="目标销售毛利率（扣除分成）"
                className="font-medium"
              />
              <Input
                id="target-gross-margin"
                type="number"
                min="0"
                max="95"
                step="0.01"
                value={pricing.targetGrossMargin}
                onChange={(event) =>
                  updateNumber('targetGrossMargin', event.target.value)
                }
                className="h-8 text-right financial-numeral"
              />
            </label>
            <div className="grid grid-cols-[1fr_180px] items-center gap-4 bg-[#f4f2ed] px-4 py-3">
              <BiText
                en="Target List Price"
                zh="目标报价（折扣前）"
                className="font-medium"
              />
              <span className="financial-numeral text-right font-semibold">
                {result.valid ? formatSgd(result.listPrice) : '—'}
              </span>
            </div>
            <label
              htmlFor="pricing-discount"
              className="grid grid-cols-[1fr_180px] items-center gap-4 px-4 py-2.5"
            >
              <BiText
                en="Discount (SGD)"
                zh="折扣金额（SGD）"
                className="font-medium"
              />
              <Input
                id="pricing-discount"
                type="number"
                min="0"
                step="0.01"
                value={pricing.discount}
                onChange={(event) =>
                  updateNumber('discount', event.target.value)
                }
                className="h-8 text-right financial-numeral"
              />
            </label>
            <label
              htmlFor="pricing-gst"
              className="grid grid-cols-[1fr_180px] items-center gap-4 px-4 py-2.5"
            >
              <BiText en="GST (%)" zh="税率（%）" className="font-medium" />
              <Input
                id="pricing-gst"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={pricing.gstPercent}
                onChange={(event) =>
                  updateNumber('gstPercent', event.target.value)
                }
                className="h-8 text-right financial-numeral"
              />
            </label>
            <div className="grid grid-cols-2 divide-x divide-border bg-[#edf4f3]">
              <div className="px-4 py-3">
                <BiText
                  en="Actual Sales GP"
                  zh="销售毛利率（扣除分成）"
                  className="text-[10px] text-[#557276]"
                />
                <p className="financial-numeral mt-1 text-lg font-bold text-[#173a52]">
                  {result.valid
                    ? `${result.grossMarginPercent.toFixed(2)}%`
                    : '—'}
                </p>
                <p className="financial-numeral mt-1 text-[10px] text-[#557276]">
                  {result.valid ? formatSgd(result.salesGrossProfit) : '—'}
                </p>
              </div>
              <div className="px-4 py-3 text-right">
                <BiText
                  en="Quote Before Tax"
                  zh="未税报价"
                  className="items-end text-[10px] text-[#557276]"
                />
                <p className="financial-numeral mt-1 text-lg font-bold text-[#173a52]">
                  {formatSgd(result.quoteBeforeTax)}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border p-3">
            <Button
              variant="outline"
              disabled={isApplyingRates}
              onClick={async () =>
                announce(
                  (await onSave())
                    ? 'Pricing saved / 定价已保存'
                    : 'Pricing save failed; edits are retained / 保存失败，修改已保留',
                )
              }
            >
              <Save /> Save Pricing{' '}
              <span className="text-[9px] opacity-60">保存定价</span>
            </Button>
            <Button
              onClick={generateDraft}
              disabled={
                !template ||
                isExporting ||
                isApplyingRates ||
                exportInProgress ||
                versionState !== 'Confirmed' ||
                outputErrors.length > 0
              }
              title={
                versionState === 'Confirmed'
                  ? 'Generate customer quotation workbook'
                  : 'Confirm the current cost version first / 请先确认当前成本版本'
              }
            >
              {isExporting ? <Download /> : <FileCheck2 />}
              {isExporting ? 'Exporting…' : 'Generate XLSX'}{' '}
              <span className="text-[9px] opacity-60">生成报价</span>
            </Button>
          </div>
          {outputErrors.length > 0 ? (
            <p role="alert" className="px-3 pb-3 text-xs text-red-700">
              Validation · 输入校验：{outputErrors[0]}
            </p>
          ) : null}
        </section>
        <section className="border border-border bg-card">
          <SectionHeading
            index="02"
            title="Client Output Preview"
            titleZh=""
            description="Preview the currently applied quotation template."
            descriptionZh=""
          />
          <div className="p-5">
            <div className="mx-auto max-w-[520px] border border-[#c8c4ba] bg-[#fffefa] p-7 shadow-[0_8px_24px_rgba(23,58,82,0.08)]">
              <div className="flex items-start justify-between border-b-2 border-[#173a52] pb-5">
                <div>
                  <p className="text-base font-bold tracking-wide text-[#173a52]">
                    {template?.documentTitle || 'SERVICE QUOTATION'}
                  </p>
                </div>
                <span className="financial-numeral text-[9px] text-muted-foreground">
                  QT-{project.id.replace(/^PRJ-/, '')}-{activeVersion}
                </span>
              </div>
              <div className="mt-6">
                <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                  Prepared for
                </p>
                <p className="mt-1 text-sm font-semibold">{project.client}</p>
                <p className="mt-1 text-[9px] text-muted-foreground">
                  {project.name}
                </p>
              </div>
              <div className="mt-6 border-y border-border py-5">
                <div className="flex items-end justify-between gap-4">
                  <p className="text-xs font-medium">Total Before Tax</p>
                  <p className="financial-numeral text-2xl font-bold text-[#173a52]">
                    {formatSgd(result.quoteBeforeTax)}
                  </p>
                </div>
                <div className="mt-3 flex items-end justify-between gap-4 text-muted-foreground">
                  <p className="text-[9px]">
                    GST {result.gstPercent.toFixed(2)}%
                  </p>
                  <p className="financial-numeral text-xs">
                    {formatSgd(result.gstAmount)}
                  </p>
                </div>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <p className="text-[10px] font-medium">Total After Tax</p>
                  <p className="financial-numeral text-sm font-semibold">
                    {formatSgd(result.quoteAfterTax)}
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-2 text-[10px] text-muted-foreground">
                <p>• Validity: {template?.validityDays || 30} days</p>
                <p>• Payment: {template?.paymentTerms || 'Not set'}</p>
                <p>• Cost baseline: {activeVersion}</p>
                {template?.termsAndConditions && (
                  <div className="border-t pt-2">
                    <p className="font-semibold">Terms & Conditions</p>
                    <p className="whitespace-pre-wrap break-words">
                      {template.termsAndConditions}
                    </p>
                  </div>
                )}
                {quoteAssumptions
                  .filter((row) => row.included)
                  .map((row) => (
                    <p className="whitespace-pre-wrap break-words" key={row.id}>
                      • {row.text}
                    </p>
                  ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="border border-border bg-card">
        <SectionHeading
          index="03"
          title="Quote Assumptions"
          titleZh="报价假设"
          description="Included rows are written into the generated client workbook."
          descriptionZh="这里只修改当前报价的假设，不回写假设库；勾选内容将进入客户报价单。"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenMasterData('assumptions')}
              >
                Manage library{' '}
                <span className="text-[10px] opacity-60">管理假设库</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setQuoteAssumptions((rows) => [
                    ...rows,
                    {
                      id: newId('assumption'),
                      text: 'New quotation assumption',
                      textZh: '',
                      included: true,
                    },
                  ])
                }
              >
                <Plus /> Add for this quote{' '}
                <span className="text-[10px] opacity-60">本次新增</span>
              </Button>
            </div>
          }
        />
        <AssumptionPicker
          key={project.id}
          library={assumptionLibrary}
          client={project.client}
          assumptions={quoteAssumptions}
          setAssumptions={setQuoteAssumptions}
        />
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-[#f2f0ea]">
                <TableHead className="w-24">Include</TableHead>
                <TableHead>Assumption</TableHead>
                <TableHead className="w-20 text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quoteAssumptions.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() =>
                        setQuoteAssumptions((rows) =>
                          rows.map((row) =>
                            row.id === item.id
                              ? { ...row, included: !row.included }
                              : row,
                          ),
                        )
                      }
                    >
                      <StatusBadge tone={item.included ? 'green' : 'gray'}>
                        {item.included ? 'Included' : 'Excluded'}
                      </StatusBadge>
                    </button>
                    {item.sourceAssumptionId && (
                      <small className="mt-1 block text-muted-foreground">
                        Library copy / 库引用
                      </small>
                    )}
                  </TableCell>
                  <TableCell>
                    <Textarea
                      aria-label="Quotation assumption text"
                      maxLength={2000}
                      value={item.text}
                      onChange={(event) =>
                        setQuoteAssumptions((rows) =>
                          rows.map((row) =>
                            row.id === item.id
                              ? { ...row, text: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setQuoteAssumptions((rows) =>
                          rows.filter((row) => row.id !== item.id),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="border border-border bg-card">
        <SectionHeading
          index="04"
          title="Quotation History"
          titleZh="报价历史"
          description="Every generated file creates a frozen value reference; manual records are also supported."
          descriptionZh="每次生成文件都会保存金额快照，也支持手工补录历史记录。"
          action={
            <Button size="sm" variant="outline" onClick={addManualHistory}>
              <Plus /> Manual history / 手工补录
            </Button>
          }
        />
        {showManualHistory ? (
          <ManualHistoryForm
            costVersion={activeVersion}
            templateId={template?.id || ''}
            onCancel={() => setShowManualHistory(false)}
            onAdd={(record) => {
              setQuoteHistory((records) => [record, ...records]);
              setShowManualHistory(false);
              announce('Historical quote added / 历史报价已录入');
            }}
          />
        ) : null}
        <div className="overflow-x-auto">
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="bg-[#f2f0ea]">
                <TableHead>Quote No.</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>Cost Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Before Tax</TableHead>
                <TableHead className="text-right">After Tax</TableHead>
                <TableHead className="text-right">Sales GP</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-16">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quoteHistory.length ? (
                quoteHistory.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="financial-numeral font-semibold">
                      {record.quoteNumber}
                      {record.templateSnapshot && (
                        <details className="mt-1 max-w-sm text-xs font-normal">
                          <summary className="cursor-pointer text-muted-foreground">
                            Saved T&C & assumptions / 当时报价条款
                          </summary>
                          <div className="space-y-2 whitespace-pre-wrap py-2">
                            <p>{record.templateSnapshot.name}</p>
                            <p>
                              Validity: {record.templateSnapshot.validityDays}{' '}
                              days
                            </p>
                            <p>{record.templateSnapshot.paymentTerms}</p>
                            <p>{record.templateSnapshot.paymentTermsZh}</p>
                            <p>{record.templateSnapshot.termsAndConditions}</p>
                            {record.assumptionSnapshots?.map((row) => (
                              <p key={row.id}>
                                • {row.text}
                                {row.textZh && (
                                  <span className="block">{row.textZh}</span>
                                )}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                    </TableCell>
                    <TableCell className="financial-numeral text-[10px]">
                      {new Date(record.generatedAt).toLocaleString('en-SG')}
                    </TableCell>
                    <TableCell>{record.costVersion}</TableCell>
                    <TableCell>
                      <Select
                        value={record.status}
                        onValueChange={(value) =>
                          setQuoteHistory((rows) =>
                            rows.map((row) =>
                              row.id === record.id
                                ? {
                                    ...row,
                                    status: value as QuoteHistoryStatus,
                                  }
                                : row,
                            ),
                          )
                        }
                      >
                        <SelectTrigger size="sm" className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Draft">Draft</SelectItem>
                          <SelectItem value="Final">Final</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="financial-numeral text-right">
                      {formatSgd(record.costAmount)}
                    </TableCell>
                    <TableCell className="financial-numeral text-right">
                      {formatSgd(record.quoteBeforeTax)}
                    </TableCell>
                    <TableCell className="financial-numeral text-right">
                      {formatSgd(record.quoteAfterTax)}
                    </TableCell>
                    <TableCell className="financial-numeral text-right">
                      {record.grossMarginPercent.toFixed(2)}%
                    </TableCell>
                    <TableCell>
                      <Input
                        value={record.note}
                        onChange={(event) =>
                          setQuoteHistory((rows) =>
                            rows.map((row) =>
                              row.id === record.id
                                ? { ...row, note: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setQuoteHistory((rows) =>
                            rows.filter((row) => row.id !== record.id),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="h-20 text-center text-xs text-muted-foreground"
                  >
                    No quotation history yet / 暂无报价历史
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
