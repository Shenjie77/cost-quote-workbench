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
import { buildQuoteLines, validateQuoteLines } from './quote-lines';
import { QuoteLinesEditor } from './quote-lines-editor';
import { isRetiredQuoteAssumption } from './types';
import { QuotePreviewDialog } from './quote-preview-dialog';

/** Creates stable local identities for newly recorded assumptions and quotation history. */
const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;

/** Presents project-owned pricing and exports a detached commercial snapshot. */
export function QuoteView({
  project,
  proposalNumber,
  onProposalNumberChange,
  activeVersion,
  versionState,
  totalCost,
  costSnapshot,
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
  /** Captured active-version cost inputs used only to describe and allocate quote lines. */
  costSnapshot: CostExportSnapshot;
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
  const effectiveQuoteAssumptions = quoteAssumptions.filter(
    (row) => !isRetiredQuoteAssumption(row),
  );
  const effectiveAssumptionLibrary = assumptionLibrary.filter(
    (row) => !isRetiredQuoteAssumption(row),
  );
  const lines = buildQuoteLines(
    costSnapshot,
    pricing.lineMode,
    result.listPrice,
    result.allocatedManualLines ?? pricing.manualLines,
  );
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
    ...validateQuoteLines(lines, result.listPrice),
    ...(!templateAvailable
      ? [
          'Select an active template matching this client / 请选择当前客户适用的启用模板',
        ]
      : []),
    ...(effectiveQuoteAssumptions.some(
      (row) => row.included && !row.text.trim(),
    )
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
        effectiveAssumptionLibrary,
        chosen.defaultAssumptionIds,
        project.client,
      ),
    );
    announce(
      'Template selected; eligible default assumptions added without overwriting existing text. / 已选择模板并补入适用默认假设，原内容保留。',
    );
  };
  /** Discount changes net revenue and actual GP without repricing the individual quotation lines. */
  const updateDiscount = (raw: string) => {
    if (isApplyingRates || isExporting || exportInProgress) return;
    const value = Number(raw);
    setPricing((current) => ({
      ...current,
      discount: Number.isFinite(value) ? value : 0,
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
    // Freeze commercial content before asynchronous workbook loading/archive work.
    // A same-project edit during export must not change the recorded output history.
    const exportInput = structuredClone({
      project,
      quoteNumber,
      costVersion: activeVersion,
      template,
      assumptions: effectiveQuoteAssumptions,
      pricing: result,
      profitShareMasterDataRevision,
      lines,
      lineMode: pricing.lineMode ?? 'single',
    });
    try {
      const exported = await downloadQuoteWorkbook(exportInput);
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
        templateSnapshot: exportInput.template,
        assumptionSnapshots: structuredClone(
          exportInput.assumptions.filter((row) => row.included),
        ),
        lineSnapshots: exportInput.lines,
        lineMode: exportInput.lineMode,
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
    <div className="wb-page-stack gap-3">
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
      <section className="wb-panel min-w-0" aria-label="Quotation pricing">
        <SectionHeading
          index="01"
          title="Pricing Parameters"
          titleZh="定价参数"
          description="Set line GP or prices; totals and actual GP update automatically."
          descriptionZh="逐行设置 GP 或售价，自动汇总总价及实际 GP。"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <QuotePreviewDialog
                project={project}
                activeVersion={activeVersion}
                template={template}
                pricing={result}
                lines={lines}
                assumptions={effectiveQuoteAssumptions}
              />
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
                <span className="text-xs opacity-60">保存定价</span>
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
                <span className="text-xs opacity-60">生成报价</span>
              </Button>
            </div>
          }
        />
        {/* Keep editable commercial terms beside their results, following the Cost Grid cell layout. */}
        <Table
          className="min-w-[700px] table-fixed text-xs"
          aria-label="Pricing parameters"
        >
          <TableHeader>
            <TableRow className="h-10 bg-primary text-white hover:bg-primary">
              <TableHead className="border-r border-white/20 px-3 py-1.5 text-xs whitespace-normal text-white">
                <BiText
                  zhClassName="text-white/70"
                  en="Cost with Risk"
                  zh="含风险项目总成本"
                />
              </TableHead>
              <TableHead className="border-r border-white/20 px-3 py-1.5 text-xs whitespace-normal text-white">
                <BiText
                  zhClassName="text-white/70"
                  en="Line Total"
                  zh="明细合计（折扣前）"
                />
              </TableHead>
              <TableHead className="border-r border-white/20 px-3 py-1.5 text-xs whitespace-normal text-white">
                <label htmlFor="pricing-discount">
                  <BiText
                    zhClassName="text-white/70"
                    en="Discount (SGD)"
                    zh="折扣金额"
                  />
                </label>
              </TableHead>
              <TableHead className="border-r border-white/20 px-3 py-1.5 text-xs whitespace-normal text-white">
                <BiText
                  zhClassName="text-white/70"
                  en="Quote Total"
                  zh="最终报价"
                />
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs whitespace-normal text-white">
                <BiText
                  zhClassName="text-white/70"
                  en="Actual Sales GP"
                  zh="销售毛利率（扣除分成）"
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="h-8 hover:bg-transparent">
              <TableCell className="financial-numeral border-r bg-muted/30 px-3 text-right font-semibold">
                {formatSgd(result.cost)}
              </TableCell>
              <TableCell className="financial-numeral border-r bg-muted/30 px-3 text-right font-semibold">
                {result.valid ? formatSgd(result.listPrice) : '—'}
              </TableCell>
              <TableCell className="border-r bg-blue-50/30 p-0">
                <Input
                  id="pricing-discount"
                  disabled={isApplyingRates || isExporting || exportInProgress}
                  type="number"
                  min="0"
                  step="0.01"
                  value={pricing.discount}
                  onChange={(event) => updateDiscount(event.target.value)}
                  className="financial-numeral h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-3 text-right text-xs text-blue-700 shadow-none focus-visible:bg-background focus-visible:ring-1"
                />
              </TableCell>
              <TableCell className="financial-numeral border-r bg-accent/60 px-3 text-right font-semibold text-primary">
                {formatSgd(result.quoteBeforeTax)}
              </TableCell>
              <TableCell className="financial-numeral bg-accent/60 px-3 text-right">
                <span className="block font-semibold text-primary">
                  {result.valid
                    ? `${result.grossMarginPercent.toFixed(2)}%`
                    : '—'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {result.valid ? formatSgd(result.salesGrossProfit) : '—'}
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {/* The detail editor spans the same width as the parameters that determine its prices. */}
        <QuoteLinesEditor
          key={`${project.id}:${activeVersion}`}
          pricing={pricing}
          setPricing={setPricing}
          lines={lines}
          costSnapshot={costSnapshot}
          totalCost={totalCost}
          weightedProfitShareRate={result.weightedProfitShareRate}
          allocatedLines={result.allocatedManualLines}
          disabled={isExporting || exportInProgress || isApplyingRates}
          embedded
        />
        <div className="border-t text-xs">
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
        </div>
        {outputErrors.length > 0 ? (
          <p role="alert" className="px-3 pb-3 text-xs text-red-700">
            Validation · 输入校验：{outputErrors[0]}
          </p>
        ) : null}
      </section>
      <section className="wb-panel">
        <SectionHeading
          index="02"
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
                <span className="text-xs opacity-60">管理假设库</span>
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
                <span className="text-xs opacity-60">本次新增</span>
              </Button>
            </div>
          }
        />
        <AssumptionPicker
          key={project.id}
          library={effectiveAssumptionLibrary}
          client={project.client}
          assumptions={effectiveQuoteAssumptions}
          setAssumptions={setQuoteAssumptions}
        />
        <div className="wb-table-scroll">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead className="w-24">Include</TableHead>
                <TableHead>Assumption</TableHead>
                <TableHead className="w-20 text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {effectiveQuoteAssumptions.map((item) => (
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
                      aria-label={`Delete quotation assumption ${item.text || item.id}`}
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

      <section className="wb-panel">
        <SectionHeading
          index="03"
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
        <div className="wb-table-scroll">
          <Table className="min-w-[1180px]">
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead>Quote No.</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>Cost Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Quote Total</TableHead>
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
                    <TableCell className="financial-numeral text-xs">
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
                        <SelectTrigger
                          size="sm"
                          className="w-24"
                          aria-label={`Status for quotation ${record.quoteNumber}`}
                        >
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
                      {record.grossMarginPercent.toFixed(2)}%
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Note for quotation ${record.quoteNumber}`}
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
                        aria-label={`Delete quotation history ${record.quoteNumber}`}
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
                    colSpan={9}
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
