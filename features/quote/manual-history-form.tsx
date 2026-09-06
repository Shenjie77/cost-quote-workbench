/**
 * Manual references record an actual historical quotation. They do not create
 * a new customer document or substitute today's calculated pricing.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { roundMoney } from '@/features/cost/domain';
import { isValidIsoDate } from '@/features/cost/validation';
import type { QuoteHistoryRecord } from './types';

export function ManualHistoryForm({
  costVersion,
  templateId,
  onAdd,
  onCancel,
}: {
  costVersion: string;
  templateId: string;
  onAdd: (record: QuoteHistoryRecord) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    quoteNumber: '',
    quoteDate: '',
    costAmount: '',
    quoteBeforeTax: '',
    gstAmount: '0',
    note: '',
  });
  const [error, setError] = useState('');
  const fields = [
    ['quoteNumber', 'Quote number / 报价编号', 'text'],
    ['quoteDate', 'Quote date / 实际报价日期', 'date'],
    ['costAmount', 'Actual cost / 历史成本', 'number'],
    ['quoteBeforeTax', 'Quote before tax / 税前报价', 'number'],
    ['gstAmount', 'Tax amount / 税额', 'number'],
    ['note', 'Source / note · 来源备注', 'text'],
  ] as const;
  return (
    <form
      className="grid gap-3 border-b bg-muted/20 p-3 md:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        const cost = roundMoney(Number(values.costAmount));
        const quote = roundMoney(Number(values.quoteBeforeTax));
        const tax = roundMoney(Number(values.gstAmount));
        if (
          !values.quoteNumber.trim() ||
          !isValidIsoDate(values.quoteDate) ||
          !values.costAmount.trim() ||
          !values.quoteBeforeTax.trim() ||
          [cost, quote, tax].some(
            (value) => !Number.isFinite(value) || value < 0 || value > 1e12,
          ) ||
          quote + tax > 1e12 ||
          (quote > 0 && ((quote - cost) / quote) * 100 < -100000)
        ) {
          setError(
            'Enter a valid number, date, and non-negative amounts. / 请填写有效编号、日期和非负金额。',
          );
          return;
        }
        onAdd({
          id: `quote-history-${crypto.randomUUID()}`,
          quoteNumber: values.quoteNumber.trim(),
          generatedAt: `${values.quoteDate}T00:00:00.000Z`,
          costVersion,
          templateId,
          status: 'Draft',
          costAmount: cost,
          quoteBeforeTax: quote,
          gstAmount: tax,
          quoteAfterTax: roundMoney(quote + tax),
          grossMarginPercent: quote > 0 ? ((quote - cost) / quote) * 100 : 0,
          note: values.note,
        });
      }}
    >
      {fields.map(([key, label, type]) => (
        <label key={key} className="text-xs">
          {label}
          <Input
            type={type}
            value={values[key]}
            required={key !== 'note'}
            min={type === 'number' ? 0 : undefined}
            step={type === 'number' ? 'any' : undefined}
            maxLength={key === 'quoteNumber' ? 160 : 2000}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [key]: event.target.value,
              }))
            }
          />
        </label>
      ))}
      {error ? (
        <p role="alert" className="text-xs text-red-700 md:col-span-3">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 md:col-span-3">
        <Button type="submit" size="sm">
          Add reference / 添加历史
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel / 取消
        </Button>
      </div>
    </form>
  );
}
