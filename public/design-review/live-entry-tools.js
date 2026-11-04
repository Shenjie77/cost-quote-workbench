import { esc, btn, heading, table } from './ui.js';
import { pick } from './i18n.js';
import { liveSnapshot } from './business/live-model.js';
const button = (label, id, extra = '') =>
  btn(label, `extra-${id}`, false, '', extra);
import { entryContent } from './business/entry-content.js';
export const entryTools = {
  exclusive() {
    return Boolean(
      this.picker ||
      this.batch ||
      this.editor ||
      this.importer ||
      this.output ||
      this.confirmation ||
      this.subdraft,
    );
  },
  detach() {
    this.mountGeneration++;
    if (this.handle) {
      const target = this.batch || this.subdraft;
      if (target)
        target.document = {
          ...target.document,
          workbook: this.handle.snapshot(),
        };
      this.handle.dispose();
      this.handle = null;
    }
  },
  async mount() {
    const target = this.batch || this.subdraft;
    if (!target || this.handle) return;
    const generation = ++this.mountGeneration;
    const { mountUniver } = await import('./generated/draft.js');
    if (generation !== this.mountGeneration) return;
    const element = document.querySelector('#extra-workbook');
    if (!element) return;
    if (!document.querySelector('link[data-univer-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./generated/draft.css', import.meta.url).href;
      link.dataset.univerCss = '';
      document.head.append(link);
    }
    this.handle = mountUniver(element, target.document.workbook, (workbook) => {
      const changed =
        entryContent(target.document) !== entryContent({ workbook });
      target.document = { ...target.document, workbook };
      if (changed) {
        target.preview = null;
        target.dirty = true;
      }
    });
  },
  async openBulk(kind) {
    await this.live.run(async () => {
      await this.live.flush();
      const w = this.w();
      const master =
        kind === 'master'
          ? {
              tab: this.live.masterKey(this.live.masterTab),
              items: structuredClone(this.live.master.items),
            }
          : undefined;
      if (master) master.related = await this.relatedCatalogs();
      const sheets = this.caps.compactBulkSheets(w, kind, master);
      this.batch = {
        kind,
        master,
        sheets,
        document: this.caps.entryWorkbook(sheets),
        selected: new Set(
          sheets.filter((s) => s.rows?.length).map((s) => s.id),
        ),
        basis: JSON.stringify(w),
        masterBasis: JSON.stringify(master?.items),
        preview: null,
      };
      if (!this.batch.selected.size && sheets.length)
        this.batch.selected.add(sheets[0].id);
    });
  },
  batchView() {
    const b = this.batch;
    return (
      heading(
        pick('批量录入', 'Bulk entry'),
        pick(
          '保留行 ID；未列出的记录保留。校验后再应用。',
          'Keep Row IDs; omitted records are retained. Validate before applying.',
        ),
        button(pick('返回工作表', 'Back to worksheet'), 'batch-close'),
      ) +
      `<section class="sheet"><div class="toolbar">${b.sheets.map((s) => `<label class="inline-field"><input type="checkbox" data-extra-setting="batch-sheet" value="${esc(s.id)}" ${b.selected.has(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}<span class="grow"></span>${button(pick('校验', 'Validate'), 'batch-validate')}${button(pick('应用修改', 'Apply changes'), 'batch-apply')}</div>${b.preview ? `<div class="validation" role="status">${b.preview.issues.length ? b.preview.issues.map((i) => `${esc(i.sheet)} · ${i.row}: ${esc(i.message)}`).join('<br>') : pick(`校验通过，共 ${b.preview.count} 行。`, `Validated ${b.preview.count} rows.`)}</div>` : ''}<div class="validation" role="status" data-batch-validation></div><div id="extra-workbook" class="formula-sheet"></div></section>`
    );
  },
  validateBatch() {
    const b = this.batch;
    if (this.handle)
      b.document = { ...b.document, workbook: this.handle.snapshot() };
    if (
      b.basis !== JSON.stringify(this.w()) ||
      (b.master && b.masterBasis !== JSON.stringify(this.live.master.items))
    )
      throw new Error(
        '输入基准已变化，请关闭并重新打开 / Inputs changed; reopen bulk entry.',
      );
    b.preview = this.caps.previewCompactBulk(
      b.document,
      b.sheets,
      [...b.selected],
      this.w(),
      b.kind,
      b.master,
    );
    b.validated = entryContent(b.document, [...b.selected]);
    const status = document.querySelector('[data-batch-validation]');
    if (status)
      status.textContent = b.preview.issues.length
        ? b.preview.issues
            .map((i) => `${i.sheet} · ${i.row}: ${i.message}`)
            .join(' / ')
        : pick(
            `校验通过，共 ${b.preview.count} 行。`,
            `Validated ${b.preview.count} rows.`,
          );
  },
  async applyBatch() {
    const b = this.batch;
    if (this.handle)
      b.document = { ...b.document, workbook: this.handle.snapshot() };
    if (
      !b.preview ||
      b.preview.issues.length ||
      b.validated !== entryContent(b.document, [...b.selected])
    )
      throw new Error('请先校验当前内容 / Validate current contents first.');
    if (
      b.basis !== JSON.stringify(this.w()) ||
      (b.master && b.masterBasis !== JSON.stringify(this.live.master.items))
    )
      throw new Error('输入已变化，请重新打开 / Inputs changed; reopen.');
    await this.live.run(async () => {
      if (b.kind === 'master') {
        this.live.master.items = b.preview.items;
        await this.live.persistMaster();
      } else
        await this.mutate(
          (w) => {
            if (b.kind === 'personnel')
              w.costRows = b.preview.workspace.costRows;
            if (b.kind === 'subcon')
              w.subcontractCost = b.preview.workspace.subcontractCost;
            if (b.kind === 'maintenance')
              w.maintenanceBoq = b.preview.workspace.maintenanceBoq;
          },
          { cost: ['personnel', 'subcon'].includes(b.kind) },
        );
      this.detach();
      this.batch = null;
    });
  },
  outputView() {
    const o = this.output,
      cost = o.kind === 'cost';
    return (
      heading(
        pick('导出设置', 'Export settings'),
        ' ',
        button(pick('返回', 'Back'), 'output-close'),
      ) +
      `<section class="sheet"><div class="toolbar">${
        cost
          ? `<label>${pick('格式', 'Format')}<select data-extra-setting="output.format"><option value="simple" ${o.format === 'simple' ? 'selected' : ''}>Simple Cost</option><option value="combined" ${o.format === 'combined' ? 'selected' : ''}>Quotation + Simple Cost</option><option value="full" ${o.format === 'full' ? 'selected' : ''}>Full audit</option></select></label>`
          : `<label>${pick('状态', 'Status')}<select data-extra-setting="output.status"><option>Draft</option><option ${o.status === 'Final' ? 'selected' : ''}>Final</option></select></label><label>${pick('版式', 'Layout')}<select data-extra-setting="output.layout">${[
              ['customer', '标准客户报价 / Standard customer'],
              ['template', '已采用客户模板 / Applied template'],
              ['combined', '内部成本报价组合 / Internal combined'],
            ]
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${o.layout === v ? 'selected' : ''}>${l}</option>`,
              )
              .join('')}</select></label>`
      }${button(pick('生成并归档 Excel', 'Generate & archive XLSX'), 'output-run')}</div><div class="details-content"><div class="control-group">${this.caps
        .getAvailableSimpleCostSheets(liveSnapshot(this.live.host.state()))
        .filter(
          () =>
            (cost && o.format !== 'full') || (!cost && o.layout === 'combined'),
        )
        .map(
          (s) =>
            `<label class="inline-field"><input type="checkbox" data-extra-setting="output-sheet" value="${esc(s.id)}" ${o.sheets.has(s.id) ? 'checked' : ''} ${s.id === 'Cost Statement' ? 'disabled' : ''}>${esc(s.label)}</label>`,
        )
        .join('')}</div></div></section>`
    );
  },
  async exportOutput() {
    await this.live.run(async () => {
      await this.live.flush();
      const o = this.output,
        w = this.live.record.workspace,
        snapshot = liveSnapshot(this.live.host.state()),
        runtime = await import('./generated/output.js');
      let result;
      const combined = o.kind === 'cost' && o.format === 'combined';
      if (o.kind === 'cost' && !combined)
        result = await runtime.costOutput(snapshot, {
          full: o.format === 'full',
          sheets: [...o.sheets],
        });
      else {
        const template = w.quoteTemplates.find(
          (t) => t.id === w.selectedQuoteTemplateId,
        );
        let templateBytes;
        if (o.layout === 'template' && template?.excel?.assetId) {
          const res = await fetch(
            `${this.live.api.base}/quote-template-assets/${encodeURIComponent(template.excel.assetId)}/content`,
          );
          if (!res.ok)
            throw new Error('模板文件无法读取 / Template unavailable');
          templateBytes = new Uint8Array(await res.arrayBuffer());
        }
        result = await runtime.quoteOutput(w, snapshot, {
          status: o.status,
          layout: combined ? 'combined' : o.layout,
          templateBytes,
          sheets: [...o.sheets],
        });
      }
      await this.archive(
        result.bytes,
        result.fileName,
        o.kind === 'cost' && !combined ? 'cost' : 'quote',
      );
      if (result.history) {
        const next = {
          ...w,
          quoteHistory: [...w.quoteHistory, result.history],
        };
        this.live.accept(
          await this.live.api.save(next, this.live.record.revision),
        );
      }
      await this.live.loadFiles();
      this.output = null;
      this.live.status = pick('文件已归档', 'File archived');
    });
  },
  importView() {
    const i = this.importer;
    return (
      heading(
        pick('文件导入与预览', 'File import & preview'),
        pick(
          '映射和校验通过后才应用；保留源文件证据。',
          'Apply only after mapping and validation; retain source evidence.',
        ),
        button(pick('返回', 'Back'), 'import-close'),
      ) +
      `<section class="sheet"><div class="toolbar"><input type="file" data-extra-file="import" accept="${i.kind === 'workspace' ? '.json' : '.xlsx'}" aria-label="${pick('选择导入文件', 'Choose import file')}">${i.file ? esc(i.file.name) : ''}${button(pick('预览并校验', 'Preview & validate'), 'import-preview')}${button(pick('应用', 'Apply'), 'import-apply')}</div>${
        i.info && ['cost', 'boq'].includes(i.kind)
          ? `<div class="toolbar"><select aria-label="Worksheet" data-extra-setting="import.sheet">${i.info.sheets.map((s) => `<option ${i.mapping.sheet === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><label>Header row<input type="number" min="1" data-extra-setting="import.headerRow" value="${i.mapping.headerRow}"></label>${i.kind === 'cost' ? ['role', 'mode', 'year'].map((k) => `<label>${k}<select data-extra-setting="import.${k}">${{ role: ['TD', 'PM'], mode: ['mandays', 'sites'], year: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'] }[k].map((v) => `<option ${i.mapping[k] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('') : ''}</div>${table([pick('目标字段', 'Target field'), pick('源列', 'Source column')], (i.kind === 'cost' ? Object.keys(i.mapping.columns) : ['modelColumn', 'quantityColumn']).map((k) => `<tr><td>${esc(k)}</td><td><select data-extra-setting="import.${i.kind === 'cost' ? 'columns.' : ''}${k}"><option value="0">—</option>${(i.info.sheets.find((s) => s.name === i.mapping.sheet)?.columns || []).map((c) => `<option value="${c.column}" ${(i.kind === 'cost' ? i.mapping.columns[k] : i.mapping[k]) === c.column ? 'selected' : ''}>${c.column}: ${esc(c.header)}</option>`).join('')}</select></td></tr>`).join(''))}${
              i.kind === 'cost'
                ? `<div class="toolbar"><label>Default BU<input data-extra-setting="import.defaultBu" value="${esc(i.mapping.defaultBu)}"></label><label>Default RE<select data-extra-setting="import.defaultResource"><option value="">—</option>${liveSnapshot(
                    this.live.host.state(),
                  )
                    .resourceTypes.filter(
                      (r) => r.active && r.category === 'internal',
                    )
                    .map(
                      (r) =>
                        `<option value="${esc(r.id)}" ${i.mapping.defaultResource === r.id ? 'selected' : ''}>${esc(r.code)}</option>`,
                    )
                    .join('')}</select></label></div>`
                : ''
            }`
          : ''
      }${
        i.service
          ? `<div class="toolbar"><label>${pick('实际维保年限', 'Coverage years')}<input type="number" data-extra-setting="import.serviceYears" value="${i.mapping.serviceYears || 1}"></label><label><input type="checkbox" data-extra-service-confirm ${i.discountConfirmed ? 'checked' : ''}>${pick('确认采用 Customer 实际报价', 'Confirm actual customer prices')}</label></div><details class="panel details-panel"><summary>${pick('合并平台明细', 'Merge platform details')}</summary><div class="details-content"><div class="toolbar"><input aria-label="Platform name" data-extra-setting="import.platformName" value="${esc(i.mapping.platformName || '')}" placeholder="Platform name"><input type="number" aria-label="Platform quantity" data-extra-setting="import.platformQuantity" value="${i.mapping.platformQuantity || ''}">${button(pick('合并选中明细', 'Merge selected details'), 'service-merge')}${button(pick('撤销合并', 'Undo merge'), 'service-undo')}</div>${table(['Use', 'Row', 'Model', 'Service'], i.service.parts.map((p) => `<tr><td><input type="checkbox" data-extra-merge="${p.row}" ${(i.mergeRows || []).includes(p.row) ? 'checked' : ''}></td><td>${p.row}</td><td>${esc(p.model)}</td><td>${esc(p.kind)}</td></tr>`).join(''))}</div></details>${table(
              ['Model', 'CT', 'SPMS', pick('实际数量', 'Actual quantity')],
              this.caps
                .serviceQuoteGroups(i.service.parts)
                .map(
                  (g) =>
                    `<tr><td>${esc(g.model)}</td><td>${g.ct}</td><td>${g.spms}</td><td><input type="number" min="1" data-extra-node="${esc(g.key)}" value="${i.nodeCounts[g.key] || ''}"></td></tr>`,
                )
                .join(''),
            )}`
          : ''
      }${
        i.preview
          ? `<div class="validation">${i.preview.issues?.length ? i.preview.issues.map((e) => esc(e.message || e)).join('<br>') : pick('校验通过，等待应用。', 'Validated; ready to apply.')}</div>${table(
              [pick('预览', 'Preview')],
              (i.preview.rows || i.preview.items || [])
                .slice(0, 30)
                .map(
                  (r) =>
                    `<tr><td>${esc(r.scope || r.model || r.name || r.code || r.id)}</td></tr>`,
                )
                .join(''),
            )}`
          : ''
      }</section>`
    );
  },
  async readFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('Maximum 20 MiB');
    await this.live.run(async () => {
      const i = this.importer;
      i.file = file;
      i.bytes = new Uint8Array(await file.arrayBuffer());
      i.preview = null;
      if (i.kind === 'workspace') return;
      if (i.kind === 'service') {
        i.service = await this.caps.inspectServiceQuote(i.bytes, file.name);
        i.nodeCounts = this.caps.inferredNodeCounts(i.service.parts);
        i.mapping.serviceYears = i.service.years.length || 1;
        return;
      }
      if (['cost', 'boq'].includes(i.kind)) {
        i.info = await this.caps.inspectCostWorkbook(i.bytes);
        i.mapping.sheet = i.info.sheets[0]?.name || '';
      }
    });
  },
  async previewImport() {
    await this.live.run(async () => {
      const i = this.importer,
        w = this.w();
      if (!i.file) throw new Error('Select a file');
      i.basis = JSON.stringify(w);
      i.mappingKey = JSON.stringify(i.mapping);
      if (i.kind === 'cost')
        i.preview = await this.caps.previewCostImport(
          i.bytes,
          i.file.name,
          i.mapping,
          liveSnapshot(this.live.host.state()).resourceTypes,
          w.rateSettings,
        );
      if (i.kind === 'boq')
        i.preview = {
          rows: await this.caps.importBoq(i.bytes, i.file.name, i.mapping),
          issues: [],
        };
      if (i.kind === 'service')
        i.preview = {
          rows: this.caps.serviceQuoteLines(
            i.service,
            i.service.parts,
            Number(i.mapping.serviceYears),
            i.nodeCounts,
            !!i.discountConfirmed,
          ),
          issues: [],
        };
      if (i.kind === 'master') {
        i.masterBasis = JSON.stringify(this.live.master);
        const rows = await this.caps.readBulkImportWorkbook(
          this.live.masterKey(this.live.masterTab),
          i.bytes,
        );
        i.preview = this.caps.previewBulkImport(
          this.live.masterKey(this.live.masterTab),
          rows,
          this.live.master.items,
          await this.relatedCatalogs(),
        );
      }
      if (i.kind === 'workspace') {
        const data = JSON.parse(new TextDecoder().decode(i.bytes));
        if (data.project?.id !== w.project.id)
          throw new Error(
            '备份必须属于当前项目 / Backup must belong to current project',
          );
        i.preview = { workspace: data, issues: [] };
      }
    });
  },
  async applyImport() {
    const i = this.importer;
    if (
      !i.applied &&
      (!i.preview ||
        i.preview.issues?.length ||
        i.basis !== JSON.stringify(this.w()) ||
        i.mappingKey !== JSON.stringify(i.mapping))
    )
      throw new Error('请重新预览当前数据 / Preview current data first');
    await this.live.run(async () => {
      if (!i.applied) {
        if (i.kind === 'master') {
          if (i.masterBasis !== JSON.stringify(this.live.master))
            throw new Error('Catalog changed');
          this.live.master.items = i.preview.items;
          await this.live.persistMaster();
        } else
          await this.mutate(
            (w) => {
              if (i.kind === 'cost')
                w.costRows = this.caps.applyCostImport(w.costRows, i.preview, {
                  resources: liveSnapshot(this.live.host.state()).resourceTypes,
                  rates: w.rateSettings,
                });
              if (i.kind === 'boq' || i.kind === 'service')
                w.maintenanceBoq = {
                  ...(w.maintenanceBoq || this.caps.emptyMaintenance()),
                  pricingMode: 'components',
                  boq: this.caps.appendBoq(
                    w.maintenanceBoq?.boq || [],
                    i.preview.rows,
                  ),
                };
              if (i.kind === 'workspace') return i.preview.workspace;
            },
            { cost: i.kind === 'cost' },
          );
        i.applied = true;
      }
      const w = this.live.record.workspace,
        q = new URLSearchParams({
          originalName: i.file.name,
          mimeType: i.file.type || 'application/octet-stream',
          category: 'source',
          versionCode: w.activeVersion,
          requestId: (i.requestId ||= crypto.randomUUID()),
        });
      await this.live.api.request(
        `/projects/${encodeURIComponent(w.project.id)}/files?${q}`,
        {
          method: 'POST',
          body: i.file,
          headers: { 'Content-Type': 'application/octet-stream' },
        },
      );
      this.importer = null;
      await this.live.loadFiles();
    });
  },
};
