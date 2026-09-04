/** Pricing, client-template output, assumptions, and quotation history. */

import { useState } from 'react';
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
  QuoteAssumption,
  QuoteHistoryRecord,
  QuoteHistoryStatus,
  QuoteTemplate,
} from '@/features/quote/types';
import { formatSgd } from '@/lib/formatters';

const newId = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;

export function QuoteView({
  project,
  activeVersion,
  versionState,
  totalCost,
  pricing,
  setPricing,
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
  activeVersion: string;
  versionState: CostVersionState;
  totalCost: number;
  pricing: PricingSettings;
  setPricing: React.Dispatch<React.SetStateAction<PricingSettings>>;
  quoteTemplates: QuoteTemplate[];
  selectedQuoteTemplateId: string;
  setSelectedQuoteTemplateId: React.Dispatch<React.SetStateAction<string>>;
  quoteAssumptions: QuoteAssumption[];
  setQuoteAssumptions: React.Dispatch<React.SetStateAction<QuoteAssumption[]>>;
  quoteHistory: QuoteHistoryRecord[];
  setQuoteHistory: React.Dispatch<React.SetStateAction<QuoteHistoryRecord[]>>;
  announce: (message: string) => void;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const result = calculatePricing(totalCost, pricing);
  const template =
    quoteTemplates.find((item) => item.id === selectedQuoteTemplateId) ||
    quoteTemplates[0];
  const updateNumber = (key: keyof PricingSettings, raw: string) => {
    const value = Number(raw);
    setPricing((current) => ({
      ...current,
      [key]: Number.isFinite(value) ? value : 0,
    }));
  };

  /** Generates one real XLSX file and records the exact commercial snapshot. */
  const generateDraft = async () => {
    if (!template || isExporting) return;
    if (versionState !== 'Confirmed') {
      announce(
        'Confirm the selected cost version before generating a customer quotation. / 生成客户报价前请先确认当前成本版本。',
      );
      return;
    }
    setIsExporting(true);
    const timestamp = new Date();
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
        note: `Generated ${exported.fileName}`,
      };
      setQuoteHistory((records) => [history, ...records]);
      announce(
        `Exported ${exported.fileName} and recorded quotation history. / 已导出报价并记录历史。`,
      );
    } catch (error) {
      announce(
        `Quote export failed: ${error instanceof Error ? error.message : 'Unknown error'} / 报价导出失败。`,
      );
    } finally {
      setIsExporting(false);
    }
  };

  /** Adds a historical reference without generating a new client document. */
  const addManualHistory = () => {
    const generatedAt = new Date().toISOString();
    setQuoteHistory((records) => [
      {
        id: newId('quote-history'),
        quoteNumber: `MANUAL-${project.id}-${records.length + 1}`,
        generatedAt,
        costVersion: activeVersion,
        templateId: template?.id || quoteTemplates[0].id,
        status: 'Draft',
        costAmount: result.cost,
        quoteBeforeTax: result.quoteBeforeTax,
        gstAmount: result.gstAmount,
        quoteAfterTax: result.quoteAfterTax,
        grossMarginPercent: result.grossMarginPercent,
        note: 'Manual historical reference',
      },
      ...records,
    ]);
    announce('Manual quotation history added. / 已新增手工报价历史。');
  };

  return (
    <div className="space-y-4">
      <ContextBand
        project={project}
        costVersion={activeVersion}
        versionStatus={versionState}
        action={
          <StatusBadge tone="amber">
            <BiInline en="Pricing draft" zh="定价草稿" />
          </StatusBadge>
        }
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
            <label
              htmlFor="target-gross-margin"
              className="grid grid-cols-[1fr_180px] items-center gap-4 px-4 py-2.5"
            >
              <BiText
                en="Target Gross Margin (%)"
                zh="目标销毛率（%）"
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
                {formatSgd(result.listPrice)}
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
                  en="Actual Sales GM"
                  zh="项目实际销毛"
                  className="text-[10px] text-[#557276]"
                />
                <p className="financial-numeral mt-1 text-lg font-bold text-[#173a52]">
                  {result.grossMarginPercent.toFixed(2)}%
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
              onClick={() =>
                announce(
                  'Pricing saved by local autosave / 定价参数已由本地自动保存',
                )
              }
            >
              <Save /> Save Pricing{' '}
              <span className="text-[9px] opacity-60">保存定价</span>
            </Button>
            <Button
              onClick={generateDraft}
              disabled={
                !template || isExporting || versionState !== 'Confirmed'
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
        </section>
        <section className="border border-border bg-card">
          <SectionHeading
            index="02"
            title="Client Output Preview"
            titleZh="客户输出预览"
            description="Select a maintained client template before generating the workbook."
            descriptionZh="生成工作簿前选择已维护的客户模板。"
          />
          <div className="border-b border-border p-3">
            <Select
              value={template?.id}
              onValueChange={(value) =>
                value && setSelectedQuoteTemplateId(value)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select template / 选择模板" />
              </SelectTrigger>
              <SelectContent>
                {quoteTemplates
                  .filter(
                    (item) =>
                      item.active || item.id === selectedQuoteTemplateId,
                  )
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} · {item.nameZh}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="p-5">
            <div className="mx-auto max-w-[520px] border border-[#c8c4ba] bg-[#fffefa] p-7 shadow-[0_8px_24px_rgba(23,58,82,0.08)]">
              <div className="flex items-start justify-between border-b-2 border-[#173a52] pb-5">
                <div>
                  <p className="text-base font-bold tracking-wide text-[#173a52]">
                    {template?.documentTitle || 'SERVICE QUOTATION'}
                  </p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {template?.documentTitleZh || '服务报价单'}
                  </p>
                </div>
                <span className="financial-numeral text-[9px] text-muted-foreground">
                  QT-{project.id.replace(/^PRJ-/, '')}-{activeVersion}
                </span>
              </div>
              <div className="mt-6">
                <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                  Prepared for / 客户
                </p>
                <p className="mt-1 text-sm font-semibold">{project.client}</p>
                <p className="mt-1 text-[9px] text-muted-foreground">
                  {project.name}
                </p>
              </div>
              <div className="mt-6 border-y border-border py-5">
                <div className="flex items-end justify-between gap-4">
                  <BiText
                    en="Total Before Tax"
                    zh="未税总价"
                    className="text-xs font-medium"
                  />
                  <p className="financial-numeral text-2xl font-bold text-[#173a52]">
                    {formatSgd(result.quoteBeforeTax)}
                  </p>
                </div>
                <div className="mt-3 flex items-end justify-between gap-4 text-muted-foreground">
                  <BiText
                    en={`GST ${result.gstPercent.toFixed(2)}%`}
                    zh="税费"
                    className="text-[9px]"
                  />
                  <p className="financial-numeral text-xs">
                    {formatSgd(result.gstAmount)}
                  </p>
                </div>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <BiText
                    en="Total After Tax"
                    zh="含税总价"
                    className="text-[10px] font-medium"
                  />
                  <p className="financial-numeral text-sm font-semibold">
                    {formatSgd(result.quoteAfterTax)}
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-2 text-[10px] text-muted-foreground">
                <p>
                  • Validity: {template?.validityDays || 30} days / 报价有效期
                </p>
                <p>
                  • Payment: {template?.paymentTerms || 'Not set'} / 付款条件
                </p>
                <p>• Cost baseline: {activeVersion} / 成本基线</p>
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
          descriptionZh="勾选的假设将写入生成的客户报价工作簿。"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setQuoteAssumptions((rows) => [
                  ...rows,
                  {
                    id: newId('assumption'),
                    text: 'New quotation assumption',
                    textZh: '新报价假设',
                    included: true,
                  },
                ])
              }
            >
              <Plus /> Add assumption / 新增
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-[#f2f0ea]">
                <TableHead className="w-24">Include</TableHead>
                <TableHead>Assumption / 英文</TableHead>
                <TableHead>中文说明</TableHead>
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
                  </TableCell>
                  <TableCell>
                    <Input
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
                  <TableCell>
                    <Input
                      value={item.textZh}
                      onChange={(event) =>
                        setQuoteAssumptions((rows) =>
                          rows.map((row) =>
                            row.id === item.id
                              ? { ...row, textZh: event.target.value }
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
                <TableHead className="text-right">GM</TableHead>
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
