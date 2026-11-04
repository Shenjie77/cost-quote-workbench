/** Catalog adoption and template mapping use compact inline tables and canonical contracts. */
import { esc, btn, table } from './ui.js';
import { pick } from './i18n.js';
const button = (label, action, value = '') =>
  btn(label, `extra-${action}`, false, '', `data-value="${esc(value)}"`);
export const catalogTools = {
  async relatedCatalogs() {
    const first = await this.live.api.request(
      '/masterdata/assumptions?limit=1000&offset=0',
    );
    const items = [...first.items];
    while (items.length < first.total) {
      const page = await this.live.api.request(
        `/masterdata/assumptions?limit=1000&offset=${items.length}`,
      );
      if (page.revision !== first.revision || !page.items.length)
        throw new Error('Catalog changed; reload.');
      items.push(...page.items);
    }
    return { assumptions: items };
  },
  catalogView() {
    const p = this.picker;
    return `<section class="sheet"><div class="toolbar"><strong>${esc(p.title)}</strong><span class="grow"></span>${button(pick('关闭', 'Close'), 'picker-close')}</div>${p.kind === 'assumptions' ? table([pick('假设', 'Assumption'), pick('操作', 'Action')], p.rows.map((r) => `<tr><td>${esc(pick(r.textZh || r.text, r.text))}</td><td>${button(pick('引用', 'Reference'), 'assumption-use', r.id)}</td></tr>`).join('')) : p.kind === 'maintenance' ? table(['Model', 'SLA', 'Site', 'Cost', 'Quote', pick('操作', 'Action')], p.rows.map(({ record: r, unitAnnualQuote: q, unitAnnualCost: c }) => `<tr><td>${esc(r.productModel)}</td><td>${esc(r.serviceLevel)}</td><td>${esc(r.site)}</td><td>${c ?? '—'}</td><td>${q}</td><td>${button(pick('采用', 'Apply'), 'maintenance-use', r.id)}</td></tr>`).join('')) : ''}</section>`;
  },
  templateTools() {
    if (!this.editor?.templateTarget) return '';
    return `<div class="toolbar"><label>${pick('上传客户原始模板', 'Upload customer workbook')}<input type="file" accept=".xlsx" data-extra-template-file></label>${button(pick('读取工作表和保存版式', 'Inspect sheets & saved layouts'), 'template-inspect')}${button(pick('保存当前版式', 'Save current layout'), 'template-save-layout')}</div>${this.templateAsset ? `<div class="toolbar">${this.templateAsset.sheets.map((s) => `${esc(s.name)} (${s.rowCount} × ${s.columnCount})`).join(' · ')}</div>` : ''}${this.layouts ? table([pick('版式', 'Layout'), pick('操作', 'Action')], this.layouts.map((l) => `<tr><td>${esc(l.name)}</td><td>${button(pick('应用版式', 'Apply layout'), 'template-use-layout', l.id)}</td></tr>`).join('')) : ''}`;
  },
  async uploadTemplate(file) {
    if (
      !file ||
      !/\.xlsx$/i.test(file.name) ||
      !file.size ||
      file.size > 10 * 1024 * 1024
    )
      throw new Error('Choose an XLSX up to 10 MiB.');
    await this.live.run(async () => {
      const asset = await this.live.api.request(
        `/quote-template-assets?fileName=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': 'application/octet-stream' },
        },
      );
      this.templateAsset = asset;
      this.editor.value.excel = {
        ...(this.editor.value.excel || {
          detailRow: 10,
          columns: { description: 'B', amount: 'F' },
          cells: {},
        }),
        assetId: asset.assetId,
        fileName: asset.fileName,
        sheetName: asset.sheets[0]?.name || '',
      };
    });
  },
  async catalogAction(a, value) {
    const w = this.w();
    if (a === 'picker-close') {
      this.picker = null;
      this.live.host.render();
      return true;
    }
    if (a === 'assumptions-library') {
      this.picker = {
        kind: 'assumptions',
        title: pick('引用假设库', 'Reference assumption library'),
        rows: w.assumptionLibrary.filter(
          (r) =>
            r.active &&
            this.caps.matchesClient(r.clientPattern, w.project.client),
        ),
      };
      this.live.host.render();
      return true;
    }
    if (a === 'assumption-use') {
      await this.live.run(() =>
        this.mutate((next) => {
          next.quoteAssumptions = this.caps.referenceAssumptions(
            next.quoteAssumptions,
            next.assumptionLibrary,
            [value],
            next.project.client,
          );
        }),
      );
      return true;
    }
    if (a === 'maintenance-prices') {
      const line = w.maintenanceBoq.boq.find((r) => r.id === value);
      this.picker = {
        kind: 'maintenance',
        line: value,
        title: pick('同型号历史选价', 'Historical model prices'),
        rows: this.caps.maintenanceCandidates(
          w.maintenancePriceRecords,
          line.model,
        ),
      };
      this.live.host.render();
      return true;
    }
    if (a === 'maintenance-use') {
      const candidate = this.picker.rows.find((c) => c.record.id === value),
        id = this.picker.line;
      await this.live.run(async () => {
        await this.mutate((next) => {
          next.maintenanceBoq.boq = next.maintenanceBoq.boq.map((r) =>
            r.id === id
              ? {
                  ...r,
                  referenceId: value,
                  unitAnnualQuote: candidate.unitAnnualQuote,
                  unitAnnualCost: candidate.unitAnnualCost,
                  ct: candidate.unitAnnualQuote,
                  spms: 0,
                  basis: `${candidate.record.productModel} / ${candidate.record.serviceLevel || ''} / ${candidate.record.site || ''}`,
                }
              : r,
          );
        });
        this.picker = null;
      });
      return true;
    }
    if (a === 'quote-history') {
      this.openEditor(
        pick('报价历史快照', 'Quotation history snapshot'),
        w.quoteHistory.find((r) => r.id === value),
        this.schema('quoteHistoryRecord'),
        null,
        true,
      );
      this.live.host.render();
      return true;
    }
    if (a === 'master-conflict') {
      const [ci, vi] = value.split(':').map(Number),
        item = this.live.master.conflicts[ci].variants[vi].item;
      this.openEditor(
        pick('确认采用冲突记录', 'Resolve catalog variant'),
        item,
        {},
        async (v) => {
          await this.live.api.request(
            `/masterdata/${this.live.masterKey(this.live.masterTab)}`,
            {
              method: 'PUT',
              body: {
                apiVersion: 'cost-workbench/local-v1',
                kind: 'GlobalMasterDataUpdateRequest',
                expectedRevision: this.live.master.revision,
                changes: { upsert: [v], remove: [] },
              },
            },
          );
          await this.live.loadMaster(this.live.masterTab, true);
        },
      );
      this.live.host.render();
      return true;
    }
    if (a.startsWith('template-')) {
      await this.live.run(async () => {
        const mapping = this.editor.value.excel;
        if (!mapping?.assetId)
          throw new Error('Upload a customer workbook first.');
        this.templateAsset = await this.live.api.request(
          `/quote-template-assets/${mapping.assetId}`,
        );
        if (a === 'template-inspect')
          this.layouts = await this.live.api.request(
            '/quote-template-assets/layouts',
          );
        if (a === 'template-save-layout') {
          await this.live.api.request('/quote-template-assets/layouts', {
            method: 'POST',
            body: {
              name: this.editor.value.name || 'Quotation layout',
              mapping: this.caps.reusableLayout(mapping),
            },
          });
          this.layouts = await this.live.api.request(
            '/quote-template-assets/layouts',
          );
        }
        if (a === 'template-use-layout')
          this.editor.value.excel = this.caps.applySavedLayout(
            this.layouts.find((l) => l.id === value).mapping,
            this.templateAsset,
            mapping.sheetName,
          );
      });
      return true;
    }
    return false;
  },
};
