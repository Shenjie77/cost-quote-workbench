/** Optional business workspaces composed from the compact design's shared primitives. */
import { esc, btn, table } from './ui.js';
import { pick } from './i18n.js';
import { entryTools } from './live-entry-tools.js';
import { catalogTools } from './live-catalog-tools.js';
import { draftTools } from './live-draft-tools.js';
import {
  fieldEditor,
  fieldAt,
  schemaAt,
  defaultField,
  updateField,
  resolveSchema,
} from './field-editor.js';
import { workspaceFromState, liveSnapshot } from './business/live-model.js';
import * as engine from './business/engine.js';
import { repairCostRecovery } from './business/cost-input.js';
import { workspaceCostBaseline } from './business/cpq-baseline.js';
const clone = (v) => structuredClone(v),
  same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const action = (label, id, value = '') =>
  btn(label, `extra-${id}`, false, '', `data-value="${esc(value)}"`);
const section = (title, content) =>
  `<details class="panel details-panel"><summary>${title}</summary><div class="details-content">${content}</div></details>`;
const money = (n) =>
  Number(n || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const masterDefs = {
  resources: 'resourceType',
  subcontract: 'subcontractItem',
  supplemental: 'supplementalCostItem',
  maintenance: 'maintenancePriceRecord',
  'service-history': 'servicePriceRecord',
  assumptions: 'assumptionDefinition',
  'quote-templates': 'quoteTemplate',
  'profit-share': 'profitShareRate',
  workflow: 'workflowStep',
  'project-tags': 'projectTagDefinition',
  status: 'projectStatusDefinition',
  'cpq-catalog': 'cpqCatalogItem',
};
export class CompactFeatures {
  constructor(live) {
    this.live = live;
    this.caps = null;
    this.editor = null;
    this.batch = null;
    this.importer = null;
    this.output = null;
    this.handle = null;
    this.mountGeneration = 0;
    this.confirmation = null;
    this.reminders = null;
    this.ai = null;
  }
  async ready() {
    return (this.caps ||= await import('./generated/capabilities.js'));
  }
  layout() {
    return this.live.host.layout();
  }
  w() {
    return workspaceFromState(this.live.host.state());
  }
  async mutate(edit, { cost = false } = {}) {
    await this.live.flush();
    let w = clone(this.live.record.workspace);
    if (cost) {
      const reason = this.caps.costLockReason(w, w.activeVersion);
      if (reason) throw new Error(reason);
      if (
        w.costVersions.find((v) => v.code === w.activeVersion)?.state !==
        'Draft'
      )
        throw new Error('成本版本只读 / Read-only cost version');
    }
    const changed = await edit(w);
    if (changed) w = changed;
    if (cost) {
      w.costRows = engine.recalculateCostRows(
        w.costRows,
        w.costVersions.find((v) => v.code === w.activeVersion)?.resourceTypes ||
          w.resourceTypes,
        w.rateSettings,
      );
      w.costVersions = w.costVersions.map((v) =>
        v.code === w.activeVersion
          ? {
              ...v,
              ...Object.fromEntries(
                [
                  'costRows',
                  'rateSettings',
                  'travelSettings',
                  'manualCosts',
                  'subcontractCost',
                  'travelRows',
                  'travelUplift',
                ]
                  .filter((k) => w[k] !== undefined)
                  .map((k) => [k, clone(w[k])]),
              ),
            }
          : v,
      );
    }
    this.live.accept(await this.live.api.save(w, this.live.record.revision));
    await this.live.loadFiles();
    this.live.status = pick('已保存', 'Saved');
  }
  schema(name) {
    return (
      this.caps.workspaceSchema.$defs[name] ||
      this.caps.costSchema.$defs[name] ||
      {}
    );
  }
  openEditor(title, value, schema, apply, readOnly = false) {
    this.editor = {
      title,
      value: clone(value),
      before: clone(value),
      schema,
      apply,
      readOnly,
    };
  }
  renderEditor() {
    const e = this.editor;
    return `<section class="sheet"><div class="toolbar"><strong>${esc(e.title)}</strong><span class="grow"></span>${e.readOnly ? '' : action(pick('保存字段', 'Save fields'), 'editor-save')}${action(pick('关闭', 'Close'), 'editor-close')}</div>${this.templateTools()}${fieldEditor(e.value, e.schema, this.caps, [], e.readOnly)}</section>`;
  }
  view(route) {
    if (!this.caps || !this.live.record) return '';
    if (this.confirmation)
      return `<section class="sheet"><div class="toolbar">${esc(this.confirmation.message)}${action(pick('确认', 'Confirm'), 'confirm')}${action(pick('取消', 'Cancel'), 'cancel')}</div></section>`;
    if (this.picker) return this.catalogView();
    if (this.subdraft) return this.subdraftView();
    if (this.batch) return this.batchView();
    if (this.editor) return this.renderEditor();
    if (this.importer) return this.importView();
    if (this.output) return this.outputView();
    if (this.confirmation)
      return `<section class="sheet"><div class="toolbar">${esc(this.confirmation.message)}${action(pick('确认', 'Confirm'), 'confirm')}${action(pick('取消', 'Cancel'), 'cancel')}</div></section>`;
    const w = this.w();
    let content = this.live.recovery
      ? `<section class="sheet"><div class="toolbar">${pick('发现未保存的浏览器备份。', 'Unsaved browser backup found.')}${action(pick('恢复编辑', 'Recover edits'), 'recovery-restore')}${action(pick('下载备份', 'Download backup'), 'recovery-download')}${action(pick('保留服务器数据', 'Keep server data'), 'recovery-dismiss')}</div></section>`
      : '';
    if (['cost', 'subcon', 'summary', 'compare'].includes(route))
      content += section(
        pick('录入与版本工具', 'Entry & version tools'),
        `<div class="toolbar">${route === 'cost' ? action(pick('批量录入', 'Bulk entry'), 'bulk', 'personnel') + action(pick('导入 TD / PM', 'Import TD / PM'), 'import', 'cost') : ''}${route === 'subcon' ? action(pick('批量录入', 'Bulk entry'), 'bulk', 'subcon') : ''}${action(pick('导出设置', 'Export options'), 'output', 'cost')}${action(pick('暂停成本版本', 'Suspend cost version'), 'suspend')}${action(pick('删除暂停版本', 'Delete suspended version'), 'delete-version')}</div>`,
      );
    if (route === 'subcon')
      content += section(
        pick('分包公式工作表', 'Subcontract formula worksheets'),
        `<div class="toolbar">${action(pick('共享费用公式', 'Shared formulas'), 'subdraft', 'project')}${w.subcontractCost?.siteTypes.map((s) => action(esc(s.name), 'subdraft', s.id)).join('') || ''}</div>`,
      );
    if (route === 'quote') content += this.quoteTools();
    if (route === 'maintenance') content += this.maintenanceTools(w);
    if (route === 'cpq')
      content += section(
        pick('配置快照与历史', 'Configuration snapshots & history'),
        `<div class="toolbar">${action(pick('采用最新 CPQ 目录', 'Adopt CPQ catalog'), 'adopt', 'cpq-catalog')}${action(pick('归档当前结果', 'Archive result'), 'cpq-archive')}</div>${table([pick('时间', 'Date'), pick('成本版本', 'Cost version'), pick('金额', 'Amount'), pick('操作', 'Action')], (w.cpq?.archives || []).map((a) => `<tr><td>${esc(a.createdAt)}</td><td>${esc(a.costVersion)}</td><td class="num">${money(a.result.totalCost)}</td><td>${action(pick('导出 Excel', 'Export Excel'), 'cpq-export', a.id)}${action(pick('查看快照', 'View snapshot'), 'cpq-history', a.id)}</td></tr>`).join(''))}`,
      );
    if (route === 'master' && this.live.master) content += this.masterTools();
    if (route === 'today')
      content += section(
        pick('提醒与本地 AI', 'Reminders & local AI'),
        `<div class="toolbar">${action(pick('刷新提醒', 'Refresh reminders'), 'reminders')}${action(pick('打开本地 AI', 'Open local AI'), 'ai-open')}</div>${this.reminders ? table([pick('事项', 'Item'), pick('项目', 'Project'), pick('操作', 'Action')], this.reminders.map((r) => `<tr><td>${esc(r.item?.titleZh || r.item?.title || r.message || r.kind)}</td><td>${esc(r.item?.projectId || r.projectId)}</td><td>${action(pick('已阅', 'Acknowledge'), 'reminder-ack', r.id)}</td></tr>`).join('')) : ''}${this.ai ? this.aiView() : ''}`,
      );
    if (route === 'workflow') content += this.workflowHistory(w);
    if (route === 'projects')
      content += section(
        pick('项目备份与状态', 'Project backup & status'),
        `<div class="toolbar">${action(pick('下载完整项目备份', 'Download project backup'), 'project-backup')}${action(pick('恢复项目备份', 'Restore project backup'), 'import', 'workspace')}${action(pick('更新项目状态', 'Edit project status'), 'project-status')}</div>`,
      );
    return content;
  }
  quoteTools() {
    return section(
      pick('报价设置与输出', 'Quotation settings & output'),
      `<div class="toolbar">${action(pick('项目 GP / 目标价格', 'Project GP / target price'), 'pricing')}${action(pick('采用 BU 分成', 'Adopt BU share'), 'adopt', 'profit-share')}${action(pick('刷新模板和假设目录', 'Refresh templates & assumptions'), 'quote-catalog')}${action(pick('引用假设库', 'Reference library'), 'assumptions-library')}${action(pick('编辑项目假设', 'Edit assumptions'), 'assumptions')}${action(pick('编辑模板全部字段', 'Edit template fields'), 'quote-template')}${action(pick('输出设置：草稿 / 正式 / 内部组合', 'Output: Draft / Final / Internal'), 'output', 'quote')}</div>`,
    );
  }
  maintenanceTools(w) {
    const m = w.maintenanceBoq || this.caps.emptyMaintenance();
    return section(
      pick('维保版本、导入与归档', 'Maintenance versions, imports & archives'),
      `<div class="toolbar"><label>${pick('版本', 'Version')}<select data-extra-setting="mv">${[this.caps.maintenanceVersionCode(m), ...(m.versions || []).map((v) => v.code)].map((code) => `<option ${code === this.caps.maintenanceVersionCode(m) ? 'selected' : ''}>${esc(code)}</option>`).join('')}</select></label>${action(pick('复制版本', 'Copy version'), 'mv-copy')}${action(pick('空白版本', 'Blank version'), 'mv-blank')}${action(pick('删除当前版本', 'Delete current version'), 'mv-delete')}${action(pick('批量录入', 'Bulk entry'), 'bulk', 'maintenance')}${action(pick('导入 BOQ', 'Import BOQ'), 'import', 'boq')}${action(pick('导入 CT / SPMS', 'Import CT / SPMS'), 'import', 'service')}${action(pick('导出并归档', 'Export & archive'), 'maintenance-archive')}</div>${table([pick('条目', 'Item'), pick('操作', 'Action')], m.boq.map((r) => `<tr><td>${esc(r.model)}</td><td>${action(pick('全部字段', 'All fields'), 'maintenance-line', r.id)}${action(pick('历史选价', 'History prices'), 'maintenance-prices', r.id)}${action(pick('移除条目', 'Remove item'), 'maintenance-remove', r.id)}</td></tr>`).join(''))}${table(
        [
          pick('版本', 'Version'),
          pick('时间', 'Date'),
          pick('金额', 'Amount'),
          pick('操作', 'Action'),
        ],
        m.archives
          .map(
            (a) =>
              `<tr><td>${esc(a.versionCode || 'MV1')}</td><td>${esc(a.createdAt)}</td><td class="num">${money(a.quote)}</td><td>${action(pick('导出', 'Export'), 'maintenance-export', a.id)}${action(pick('查看', 'View'), 'maintenance-history', a.id)}${action(a.deletedAt ? pick('恢复', 'Restore') : pick('移入回收站', 'Move to trash'), 'maintenance-trash', a.id)}</td></tr>`,
          )
          .join(''),
      )}`,
    );
  }
  masterTools() {
    const m = this.live.master;
    const conflicts = (m.conflicts || [])
      .map(
        (c, ci) =>
          `<div class="toolbar"><strong>${esc(c.key)}</strong>${c.variants.map((v, vi) => action(pick('审阅冲突候选', 'Review variant') + ' ' + (vi + 1), 'master-conflict', `${ci}:${vi}`)).join('')}</div>`,
      )
      .join('');
    return (
      conflicts +
      section(
        pick('目录维护与完整字段', 'Catalog tools & complete fields'),
        `<div class="toolbar">${action(pick('新增记录', 'New record'), 'master-add')}${action(pick('批量编辑', 'Bulk edit'), 'bulk', 'master')}${action(pick('导入 Excel', 'Import Excel'), 'import', 'master')}${action(pick('导出目录 / 模板', 'Export catalog / template'), 'master-export')}${['resources', 'subcontract', 'supplemental', 'maintenance', 'assumptions', 'quote-templates', 'profit-share', 'cpq-catalog'].includes(this.live.masterKey(this.live.masterTab)) ? action(pick('当前项目采用目录', 'Apply catalog to project'), 'adopt', this.live.masterKey(this.live.masterTab)) : ''}</div>`,
      )
    );
  }
  workflowHistory(w) {
    return section(
      pick('历史轮次与审批证据', 'Historical rounds & approval evidence'),
      `<div class="toolbar">${Object.keys(w.versionWorkflows || {})
        .map((k) => action(esc(k), 'workflow-evidence', k))
        .join(
          '',
        )}${action(pick('历史审批', 'Legacy reviews'), 'legacy-evidence')}</div>`,
    );
  }
  async archive(bytes, name, category, version) {
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const w = this.live.record.workspace;
    const q = new URLSearchParams({
      originalName: name,
      mimeType: blob.type,
      category,
      versionCode: version || w.activeVersion,
      requestId: crypto.randomUUID(),
    });
    await this.live.api.request(
      `/projects/${encodeURIComponent(w.project.id)}/files?${q}`,
      {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': 'application/octet-stream' },
      },
    );
    this.live.download(blob, name);
    await this.live.loadFiles();
  }
  async input(el) {
    if (el.hasAttribute('data-extra-service-confirm')) {
      this.importer.discountConfirmed = el.checked;
      this.importer.preview = null;
      return true;
    }
    if (el.dataset.extraMerge) {
      const rows = new Set(this.importer.mergeRows || []);
      if (el.checked) rows.add(Number(el.dataset.extraMerge));
      else rows.delete(Number(el.dataset.extraMerge));
      this.importer.mergeRows = [...rows];
      return true;
    }
    if (el.dataset.extraNode) {
      this.importer.nodeCounts[el.dataset.extraNode] = Number(el.value);
      this.importer.preview = null;
      return true;
    }
    if (el.dataset.extraAi) {
      this.ai[
        el.dataset.extraAi === 'scene' ? 'selected' : el.dataset.extraAi
      ] = el.dataset.extraAi === 'scene' ? Number(el.value) : el.value;
      return true;
    }
    if (el.dataset.extraAiSource) {
      if (el.checked) this.ai.selectedSources.add(el.dataset.extraAiSource);
      else this.ai.selectedSources.delete(el.dataset.extraAiSource);
      return true;
    }
    if (el.dataset.extraPath && this.editor) {
      const path = JSON.parse(el.dataset.extraPath);
      const value =
        el.type === 'checkbox'
          ? el.checked
          : el.type === 'number'
            ? el.value === ''
              ? el.hasAttribute('data-nullable')
                ? null
                : undefined
              : Number(el.value)
            : el.value;
      updateField(this.editor.value, path, value);
      return true;
    }
    if (el.dataset.extraMigrate) {
      const ids = new Set(this.live.migrateIds || []);
      if (el.checked) ids.add(el.dataset.extraMigrate);
      else ids.delete(el.dataset.extraMigrate);
      this.live.migrateIds = [...ids];
      await this.live.run(() => this.live.persistMaster());
      return true;
    }
    if (el.dataset.extraSetting === 'mv') {
      await this.live.run(() =>
        this.mutate((w) => {
          w.maintenanceBoq = this.caps.selectMaintenanceVersion(
            w.maintenanceBoq || this.caps.emptyMaintenance(),
            el.value,
          );
        }),
      );
      return true;
    }
    if (el.dataset.extraSetting === 'batch-sheet') {
      if (el.checked) this.batch.selected.add(el.value);
      else this.batch.selected.delete(el.value);
      this.batch.preview = null;
      return true;
    }
    if (el.dataset.extraSetting?.startsWith('output.')) {
      const key = el.dataset.extraSetting.slice(7);
      this.output[key] = el.value;
      this.live.host.renderInPlace();
      return true;
    }
    if (el.dataset.extraSetting === 'output-sheet') {
      if (el.checked) this.output.sheets.add(el.value);
      else this.output.sheets.delete(el.value);
      return true;
    }
    if (el.dataset.extraSetting?.startsWith('import.')) {
      this.importer.preview = null;
      const key = el.dataset.extraSetting.slice(7);
      if (key.startsWith('columns.'))
        this.importer.mapping.columns[key.slice(8)] = Number(el.value);
      else
        this.importer.mapping[key] =
          el.type === 'number' ||
          ['modelColumn', 'quantityColumn'].includes(key)
            ? Number(el.value)
            : el.value;
      this.live.host.renderInPlace();
      return true;
    }
    if (el.hasAttribute('data-extra-template-file')) {
      await this.uploadTemplate(el.files?.[0]);
      return true;
    }
    if (el.dataset.extraFile) {
      await this.readFile(el.files?.[0]);
      return true;
    }
    return false;
  }
  async action(name, el) {
    if (!name.startsWith('extra-')) return false;
    await this.ready();
    const a = name.slice(6),
      value = el.dataset.value,
      w = this.w();
    if (await this.catalogAction(a, value)) return true;
    if (a.startsWith('recovery-')) {
      const recovery = this.live.recovery;
      if (a === 'recovery-download')
        this.live.download(
          new Blob([JSON.stringify(recovery.workspace, null, 2)], {
            type: 'application/json',
          }),
          `${w.project.id}-recovery.json`,
        );
      if (a === 'recovery-restore') {
        if (recovery.revision !== this.live.record.revision)
          throw new Error(
            '备份基准已变化，请下载备份并核对差异 / Backup revision differs; download and compare before restoring.',
          );
        const { projectState } = await import('./business/live-model.js');
        const restored = projectState(
          repairCostRecovery(recovery.workspace),
          this.live.index,
        );
        restored.tasks = recovery.tasks || restored.tasks;
        this.live.host.setState(restored);
        this.live.recovery = null;
        this.live.host.dirty();
      }
      if (a === 'recovery-dismiss') {
        this.live.recovery = null;
        localStorage.removeItem(this.live.recoveryKey());
      }
      this.live.host.render();
      return true;
    }
    if (a === 'editor-close') {
      if (this.editor && !same(this.editor.before, this.editor.value)) {
        this.confirmation = {
          message: pick(
            '放弃尚未保存的字段修改？',
            'Discard unsaved field edits?',
          ),
          run: () => {
            this.editor = null;
          },
        };
      } else this.editor = null;
      this.live.host.render();
      return true;
    }
    if (a === 'editor-save') {
      await this.live.run(async () => {
        await this.editor.apply(clone(this.editor.value));
        this.editor = null;
      });
      return true;
    }
    if (a.startsWith('field-')) {
      const path = JSON.parse(el.dataset.extraPath),
        e = this.editor;
      const spec = schemaAt(e.schema, path, this.caps);
      if (a === 'field-key-add') {
        const key = el
          .closest('.toolbar')
          .querySelector('[data-extra-dictionary-key]')
          .value.trim();
        if (!key || ['__proto__', 'prototype', 'constructor'].includes(key))
          throw new Error('Invalid field name');
        const obj = fieldAt(e.value, path);
        if (Object.hasOwn(obj, key)) throw new Error('Field already exists');
        obj[key] = defaultField(
          resolveSchema(spec, this.caps).additionalProperties || {},
          this.caps,
        );
      }
      if (a === 'field-create')
        updateField(e.value, path, defaultField(spec, this.caps));
      if (a === 'field-add')
        fieldAt(e.value, path).push(
          defaultField(resolveSchema(spec, this.caps).items || {}, this.caps),
        );
      if (a === 'field-remove') {
        const arr = fieldAt(e.value, path.slice(0, -1));
        arr.splice(path.at(-1), 1);
      }
      this.live.host.render();
      return true;
    }
    if (a === 'cancel') {
      this.confirmation = null;
      this.live.host.render();
      return true;
    }
    if (a === 'confirm') {
      const c = this.confirmation;
      await this.live.run(async () => {
        await c.run();
        this.confirmation = null;
      });
      return true;
    }
    if (a.startsWith('subdraft-')) {
      await this.subdraftAction(a);
      return true;
    }
    if (a === 'bulk') {
      await this.openBulk(value);
      return true;
    }
    if (a === 'batch-validate') {
      this.validateBatch();
      return true;
    }
    if (a === 'batch-apply') {
      await this.applyBatch();
      return true;
    }
    if (a === 'batch-close') {
      this.confirmation = {
        message: pick(
          '关闭批量表？尚未应用的编辑会丢弃。',
          'Close bulk sheet and discard unapplied edits?',
        ),
        run: () => {
          this.detach();
          this.batch = null;
        },
      };
      this.live.host.render();
      return true;
    }
    if (a === 'output') {
      this.output = {
        kind: value,
        status: 'Draft',
        layout: 'customer',
        format: 'simple',
        sheets: new Set(
          this.caps
            .getAvailableSimpleCostSheets(liveSnapshot(this.live.host.state()))
            .map((s) => s.id),
        ),
      };
      this.live.host.render();
      return true;
    }
    if (a === 'output-close') {
      this.output = null;
      this.live.host.render();
      return true;
    }
    if (a === 'output-run') {
      await this.exportOutput();
      return true;
    }
    if (a === 'import') {
      this.importer = {
        kind: value,
        mapping: {
          sheet: '',
          headerRow: 1,
          role: 'TD',
          mode: 'mandays',
          year: 'Y1',
          columns: {
            scope: 1,
            bu: 0,
            resource: 0,
            mandays: 2,
            sites: 0,
            mdPerSite: 0,
            cost: 0,
          },
          defaultBu: '',
          defaultResource: '',
          modelColumn: 1,
          quantityColumn: 2,
        },
      };
      this.live.host.render();
      return true;
    }
    if (a === 'import-close') {
      this.importer = null;
      this.live.host.render();
      return true;
    }
    if (a === 'service-merge' || a === 'service-undo') {
      const i = this.importer;
      i.mergeUndo ||= [];
      if (a === 'service-merge') {
        const result = this.caps.mergeServiceQuoteItems(
          i.service.parts,
          i.mergeRows || [],
          i.mapping.platformName || '',
          Number(i.mapping.platformQuantity),
          i.nodeCounts,
        );
        i.mergeUndo.push({
          parts: clone(i.service.parts),
          counts: clone(i.nodeCounts),
        });
        i.service.parts = result.parts;
        i.nodeCounts[result.key] = result.quantity;
      } else {
        const before = i.mergeUndo.pop();
        if (before) {
          i.service.parts = before.parts;
          i.nodeCounts = before.counts;
        }
      }
      i.preview = null;
      i.mergeRows = [];
      this.live.host.render();
      return true;
    }
    if (a === 'import-preview') {
      await this.previewImport();
      return true;
    }
    if (a === 'import-apply') {
      await this.applyImport();
      return true;
    }
    if (a === 'mv-copy' || a === 'mv-blank') {
      await this.live.run(() =>
        this.mutate((next) => {
          next.maintenanceBoq = this.caps.createMaintenanceVersion(
            next.maintenanceBoq || this.caps.emptyMaintenance(),
            a === 'mv-copy',
          );
        }),
      );
      return true;
    }
    if (a === 'mv-delete') {
      this.confirmation = {
        message: pick(
          '删除当前维保版本并保留历史归档？',
          'Delete current maintenance draft and retain archives?',
        ),
        run: () =>
          this.mutate((next) => {
            next.maintenanceBoq = this.caps.deleteMaintenanceVersion(
              next.maintenanceBoq,
              this.caps.maintenanceVersionCode(next.maintenanceBoq),
            );
          }),
      };
      this.live.host.render();
      return true;
    }
    if (a === 'suspend') {
      await this.live.run(() =>
        this.mutate(
          (next) => {
            next.costVersions.find((v) => v.code === next.activeVersion).state =
              'Suspended';
          },
          { cost: false },
        ),
      );
      return true;
    }
    if (a === 'delete-version') {
      const reason = this.caps.costVersionDeletionReason(w, w.activeVersion);
      if (reason) throw new Error(reason);
      this.confirmation = {
        message: pick(
          '删除暂停版本，保留来源快照和历史？',
          'Delete suspended version while retaining provenance?',
        ),
        run: () =>
          this.mutate((next) =>
            this.caps.deleteSuspendedCostVersion(next, next.activeVersion),
          ),
      };
      this.live.host.render();
      return true;
    }
    if (a === 'cpq-archive') {
      await this.live.run(() =>
        this.mutate((next) => {
          next.cpq = this.caps.archiveCpq(
            next.cpq,
            workspaceCostBaseline(next),
            next.ssr?.proposalNumber || '',
          );
        }),
      );
      return true;
    }
    if (a === 'cpq-export') {
      await this.live.run(async () => {
        const archive = w.cpq.archives.find((r) => r.id === value);
        await this.archive(
          await this.caps.buildCpqWorkbook(archive),
          `CPQ_${archive.costVersion}_${Date.now()}.xlsx`,
          'cpq',
        );
      });
      return true;
    }
    if (a === 'cpq-history') {
      this.openEditor(
        pick('CPQ 归档快照', 'CPQ snapshot'),
        w.cpq.archives.find((r) => r.id === value),
        this.schema('cpqArchive'),
        null,
        true,
      );
      this.live.host.render();
      return true;
    }
    if (a === 'maintenance-archive') {
      await this.live.run(async () => {
        await this.mutate((next) => {
          next.maintenanceBoq = this.caps.archiveMaintenance(
            next.maintenanceBoq,
            next.maintenancePriceRecords,
            next.project.client,
          );
        });
        const archive =
          this.live.record.workspace.maintenanceBoq.archives.at(-1);
        await this.archive(
          await this.caps.buildMaintenanceWorkbook(archive),
          `Maintenance_${archive.versionCode || 'MV1'}_${Date.now()}.xlsx`,
          'maintenance',
          archive.versionCode || 'MV1',
        );
      });
      return true;
    }
    if (a === 'maintenance-export') {
      await this.live.run(async () => {
        const archive = w.maintenanceBoq.archives.find((r) => r.id === value);
        await this.archive(
          await this.caps.buildMaintenanceWorkbook(archive),
          `Maintenance_${archive.versionCode || 'MV1'}_${Date.now()}.xlsx`,
          'maintenance',
          archive.versionCode || 'MV1',
        );
      });
      return true;
    }
    if (a === 'maintenance-history') {
      this.openEditor(
        pick('维保归档', 'Maintenance archive'),
        w.maintenanceBoq.archives.find((r) => r.id === value),
        this.schema('maintenanceArchive'),
        null,
        true,
      );
      this.live.host.render();
      return true;
    }
    if (a === 'maintenance-remove' || a === 'maintenance-trash') {
      this.confirmation = {
        message: pick(
          '确认此操作？历史报价和导出文件保留。',
          'Confirm this change? Quotation history and exported files are retained.',
        ),
        run: () =>
          this.mutate((next) => {
            if (a === 'maintenance-remove')
              next.maintenanceBoq.boq = next.maintenanceBoq.boq.filter(
                (r) => r.id !== value,
              );
            else {
              const archive = next.maintenanceBoq.archives.find(
                (r) => r.id === value,
              );
              if (archive.deletedAt) delete archive.deletedAt;
              else archive.deletedAt = new Date().toISOString();
            }
          }),
      };
      this.live.host.render();
      return true;
    }
    if (a === 'maintenance-line') {
      this.openEditor(
        pick('维保条目', 'Maintenance item'),
        w.maintenanceBoq.boq.find((r) => r.id === value),
        this.schema('boqLine'),
        (v) =>
          this.mutate((next) => {
            next.maintenanceBoq.boq = next.maintenanceBoq.boq.map((r) =>
              r.id === value ? v : r,
            );
          }),
      );
      this.live.host.render();
      return true;
    }
    if (a === 'pricing') {
      const spec = this.caps.workspaceSchema.properties.pricing;
      this.openEditor(
        pick('报价参数', 'Pricing settings'),
        w.pricing,
        spec,
        (v) =>
          this.mutate((next) => {
            next.pricing = v;
          }),
      );
      this.live.host.render();
      return true;
    }
    if (a === 'quote-template') {
      const id = w.selectedQuoteTemplateId;
      this.openEditor(
        pick('已采用报价模板', 'Applied quotation template'),
        w.quoteTemplates.find((t) => t.id === id),
        this.schema('quoteTemplate'),
        (v) =>
          this.mutate((next) => {
            next.quoteTemplates = next.quoteTemplates.map((t) =>
              t.id === id ? v : t,
            );
          }),
      );
      this.editor.templateTarget = true;
      this.templateAsset = null;
      this.layouts = null;
      this.live.host.render();
      return true;
    }
    if (a === 'assumptions') {
      this.openEditor(
        pick('项目假设与说明', 'Project assumptions'),
        { items: w.quoteAssumptions },
        {
          type: 'object',
          properties: {
            items: { type: 'array', items: this.schema('quoteAssumption') },
          },
        },
        (v) =>
          this.mutate((next) => {
            next.quoteAssumptions = v.items;
          }),
      );
      this.live.host.render();
      return true;
    }
    if (a === 'quote-catalog') {
      await this.live.run(async () => {
        await this.adopt('quote-templates');
        await this.adopt('assumptions');
      });
      return true;
    }
    if (a === 'adopt') {
      await this.live.run(() => this.adopt(value));
      return true;
    }
    if (a === 'master-add' || a === 'master-edit') {
      const m = this.live.master,
        spec = this.schema(
          masterDefs[this.live.masterKey(this.live.masterTab)],
        );
      const i = a === 'master-add' ? -1 : Number(value),
        record = i < 0 ? defaultField(spec, this.caps) : m.items[i];
      if (i < 0 && m.keyField === 'id') record.id = crypto.randomUUID();
      this.openEditor(
        pick('目录完整字段', 'Catalog fields'),
        record,
        spec,
        async (v) => {
          const before = clone(m.items);
          try {
            if (i < 0) m.items.push(v);
            else m.items[i] = v;
            await this.live.persistMaster();
          } catch (error) {
            m.items = before;
            throw error;
          }
        },
      );
      this.editor.templateTarget =
        this.live.masterKey(this.live.masterTab) === 'quote-templates';
      this.templateAsset = null;
      this.layouts = null;
      this.live.host.render();
      return true;
    }
    if (a === 'master-remove') {
      this.confirmation = {
        message: pick(
          '从此全局目录移除记录？原项目快照保留。',
          'Remove this catalog record? Project snapshots remain.',
        ),
        run: async () => {
          this.live.master.items.splice(Number(value), 1);
          await this.live.persistMaster();
        },
      };
      this.live.host.render();
      return true;
    }
    if (a === 'master-export') {
      await this.live.run(async () => {
        this.live.download(
          new Blob([
            await this.caps.createBulkImportWorkbook(
              this.live.masterKey(this.live.masterTab),
              this.live.master.items,
            ),
          ]),
          `${this.live.masterTab}.xlsx`,
        );
      });
      return true;
    }
    if (a === 'project-backup') {
      this.live.download(
        new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' }),
        `${w.project.id}.json`,
      );
      return true;
    }
    if (a === 'project-status') {
      this.openEditor(
        pick('项目状态', 'Project status'),
        { projectStatus: w.projectStatus },
        {
          type: 'object',
          properties: {
            projectStatus: {
              enum: w.projectStatusDefinitions.map((s) => s.code),
            },
          },
        },
        (v) =>
          this.mutate((next) => {
            next.projectStatus = v.projectStatus;
          }),
      );
      this.live.host.render();
      return true;
    }
    if (a === 'workflow-evidence' || a === 'legacy-evidence') {
      this.openEditor(
        pick('只读历史证据', 'Read-only historical evidence'),
        a === 'workflow-evidence'
          ? w.versionWorkflows[value]
          : {
              ssr: w.ssr,
              reviewGates: w.reviewGates,
              legacyWorkflowArchive: w.legacyWorkflowArchive,
            },
        {},
        null,
        true,
      );
      this.live.host.render();
      return true;
    }
    if (a === 'subdraft') {
      await this.openSubdraft(value);
      return true;
    }
    if (a === 'reminders' || a === 'reminder-ack') {
      await this.live.run(async () => {
        const r =
          a === 'reminders'
            ? await this.live.api.request('/reminders')
            : await this.live.api.request('/reminders', {
                method: 'PUT',
                body: {
                  id: value,
                  fingerprint: this.reminders.find((r) => r.id === value)
                    .fingerprint,
                },
              });
        this.reminders = r.items;
      });
      return true;
    }
    if (a.startsWith('ai-')) {
      await this.aiAction(a, value);
      return true;
    }
    return false;
  }
  async adopt(tab) {
    if (tab === 'resources') {
      const master = await this.live.api.request(
        '/masterdata/resources?limit=1000&offset=0',
      );
      while (master.items.length < master.total) {
        const page = await this.live.api.request(
          `/masterdata/resources?limit=1000&offset=${master.items.length}`,
        );
        if (page.revision !== master.revision || !page.items.length)
          throw new Error('Catalog changed; reload.');
        master.items.push(...page.items);
        master.conflicts.push(...page.conflicts);
      }
      await this.mutate(
        (next) =>
          this.caps.applyCapturedResourceRates(
            next,
            this.caps.captureResourceRates(
              next.costVersions.find((v) => v.code === next.activeVersion),
              master,
            ),
          ),
        { cost: true },
      );
      return;
    }
    await this.live.flush();
    const record = await this.live.api.request(
      `/projects/${encodeURIComponent(this.live.record.workspace.project.id)}/apply-masterdata`,
      {
        method: 'POST',
        body: {
          apiVersion: 'cost-workbench/local-v1',
          kind: 'ApplyMasterDataRequest',
          tab,
          expectedRevision: this.live.record.revision,
        },
      },
    );
    this.live.accept(record);
  }
}

Object.assign(CompactFeatures.prototype, entryTools, draftTools, catalogTools);
