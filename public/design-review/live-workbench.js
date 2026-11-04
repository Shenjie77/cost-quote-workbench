import { CompactFeatures } from './live-features.js';
import { CompactDraft } from './live-drafts.js';
import { CompactApi, API_VERSION } from './live-client.js';
import {
  projectState,
  workspaceFromState,
  livePricing,
  editLiveQuoteLine,
} from './business/live-model.js';
import * as engine from './business/engine.js';
import { pick } from './i18n.js';
import { esc, btn, heading } from './ui.js';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export class LiveWorkbench {
  constructor(host) {
    this.host = host;
    this.features = new CompactFeatures(this);
    this.api = new CompactApi();
    this.record = null;
    this.index = [];
    this.directory = { bu: [], tags: [] };
    this.busy = false;
    this.status = pick('连接本地数据…', 'Connecting…');
    this.expandedTask = '';
    this.uploadQueue = [];
    this.master = null;
    this.masterTab = 'resources';
    this.masterCache = new Map();
    this.draft = new CompactDraft(this.api, (text) => this.host.notify(text));
  }
  async start() {
    try {
      await this.features.ready();
      this.index = await this.api.list();
      const catalogs = await Promise.allSettled(
        ['profit-share', 'project-tags'].map((tab) =>
          this.api.request(`/masterdata/${tab}?limit=1000&offset=0`),
        ),
      );
      this.directory = {
        bu:
          catalogs[0].status === 'fulfilled'
            ? catalogs[0].value.items
                .filter((r) => r.active === true)
                .map((r) => r.bu)
                .filter(Boolean)
            : [],
        tags: catalogs[1].status === 'fulfilled' ? catalogs[1].value.items : [],
      };
      const remembered = localStorage.getItem('compact-project');
      await this.load(
        this.index.find((p) => p.projectId === remembered)?.projectId ||
          this.index[0]?.projectId,
        false,
      );
    } catch (e) {
      this.error(e);
      this.host.render();
    }
  }
  error(e) {
    this.status =
      e.status === 409
        ? pick(
            '保存冲突，修改已保留。请导出备份后重新载入。',
            'Conflict: edits retained. Back up then reload.',
          )
        : e.message;
    this.host.notify(this.status);
  }
  async run(task) {
    if (this.busy) return;
    this.busy = true;
    this.host.lock(true);
    try {
      return await task();
    } catch (e) {
      this.error(e);
    } finally {
      this.busy = false;
      this.host.render();
    }
  }
  accept(record) {
    this.record = record;
    const previous = this.host.state();
    const state = projectState(record.workspace, this.index);
    if (previous._source?.project.id === record.workspace.project.id) {
      state.files = previous.files;
      state.archive = previous.archive;
    }
    state.liveStatus = this.status;
    state.businessUnits = this.directory.bu;
    state.projectTags = this.directory.tags;
    this.host.setState(state);
    localStorage.setItem('compact-project', record.workspace.project.id);
  }
  async load(id, save = true) {
    if (!id) {
      this.status = pick(
        '没有本地项目，请新建项目。',
        'No local projects. Create a project.',
      );
      this.host.render();
      return;
    }
    if (save && this.record) await this.flush();
    const record = await this.api.load(id);
    this.status = `${pick('已载入', 'Loaded')} · R${record.revision}`;
    this.accept(record);
    this.recovery = null;
    try {
      this.recovery = JSON.parse(
        localStorage.getItem(this.recoveryKey()) || 'null',
      );
    } catch {
      /* Invalid browser backup never replaces server data. */
    }
    await this.loadFiles();
    this.host.render();
  }
  async flush() {
    clearTimeout(this.autoSaveTimer);
    if (!this.record) return;
    const state = this.host.state(),
      tasks = structuredClone(state.tasks),
      sourceTasks = state._source.processSteps;
    const workspace = workspaceFromState(state);
    if (!same(workspace, this.record.workspace)) {
      this.status = pick('保存中…', 'Saving…');
      this.record = await this.api.save(workspace, this.record.revision);
    }
    // Rebase after each successful write so a later workflow failure can be retried safely.
    state._source = structuredClone(this.record.workspace);
    for (const task of tasks) {
      const original = sourceTasks.find((t) => t.code === task.id);
      if (!original) continue;
      if (
        task.owner !== (original.owner || '') ||
        task.note !== (original.note || '') ||
        task.due !== (original.followUpDate || '') ||
        !same(task.fields || {}, original.fieldValues || {})
      ) {
        this.record = await this.api.workflow(
          workspace.project.id,
          this.record.revision,
          {
            nodeCode: task.id,
            action: 'update',
            owner: task.owner,
            note: task.note,
            followUpDate: task.due,
            fields: task.fields || {},
          },
        );
        state._source = structuredClone(this.record.workspace);
      }
    }
    this.status = `${pick('已保存', 'Saved')} · R${this.record.revision}`;
    localStorage.removeItem(this.recoveryKey());
    this.accept(this.record);
    await this.loadFiles();
  }
  async loadFiles() {
    if (!this.record) return;
    try {
      const a = await this.api.files(this.record.workspace.project.id);
      this.archiveSettings = await this.api.request('/archive-settings');
      const s = this.host.state();
      this.index = await this.api.list();
      for (const p of s.projects) {
        const header = this.index.find((h) => h.projectId === p.id);
        if (header)
          Object.assign(p, {
            cost: header.totalCost || 0,
            quote: header.totalQuote || 0,
            stage: header.currentWorkflowStepCode || '',
            due: header.workflowFollowUpDate || '',
          });
      }
      s.archive = { rootPath: a.rootPath, projectPath: a.projectPath };
      this.loadedProjectPath = a.projectPath;
      s.files = a.files.map((f) => ({
        ...f,
        name: f.originalName,
        size: f.sizeBytes,
        version: f.versionCode,
        node: f.nodeCode,
        url: this.api.fileUrl(this.record.workspace.project.id, f.id),
      }));
    } catch (e) {
      this.error(e);
    }
  }
  empty() {
    return heading(
      pick('本地工作区', 'Local workspace'),
      esc(this.status),
      btn(pick('重新连接', 'Reconnect'), 'live-reload') +
        btn(pick('新建项目', 'New project'), 'new-project', true),
    );
  }
  async save() {
    await this.run(async () => {
      await this.flush();
      this.host.notify(this.status);
    });
  }
  recoveryKey() {
    return `compact-recovery:${this.record?.workspace.project.id}`;
  }
  dirty() {
    this.status = pick('未保存', 'Unsaved');
    if (!this.record) return;
    try {
      localStorage.setItem(
        this.recoveryKey(),
        JSON.stringify({
          revision: this.record.revision,
          workspace: workspaceFromState(this.host.state()),
          tasks: this.host.state().tasks,
        }),
      );
    } catch {
      /* Download backup remains available when storage is full. */
    }
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => this.autoSave(), 1500);
  }
  autoSave() {
    if (
      this.busy ||
      this.features.exclusive() ||
      document.activeElement?.matches(
        'input,select,textarea,[contenteditable="true"]',
      )
    ) {
      this.autoSaveTimer = setTimeout(() => this.autoSave(), 1500);
      return;
    }
    void this.save();
  }
  input(el) {
    const s = this.host.state(),
      c = el.dataset.collection,
      id = el.dataset.id,
      key = el.dataset.field;
    const value =
      el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? el.value === ''
            ? undefined
            : Number(el.value)
          : el.value;
    if (el.type === 'number' && value !== undefined && !Number.isFinite(value))
      throw new Error('Invalid number');
    if (c === 'workflowReason') {
      this.workflowReasons ||= {};
      this.workflowReasons[id] = value;
      return true;
    }
    if (c === 'liveQuote') {
      if (value === undefined) return true;
      editLiveQuoteLine(s, this.host.data(), id, {
        [key]: value,
        ...(key === 'targetGrossMargin'
          ? { priceFixed: false, allocationFixed: false }
          : key === 'unitPrice'
            ? { priceFixed: true, allocationFixed: false }
            : {}),
      });
    } else if (c === 'liveGroup') {
      if (key === 'inclusion' && !['mandatory', 'optional'].includes(value))
        throw new Error('Section must be mandatory or optional');
      const current = engine.groupFor(
        livePricing(s, this.host.data()).customerLines.find(
          (l) => l.id === id,
        ) || {
          id,
        },
        s.pricing.lineGroups,
      );
      s.pricing.lineGroups = {
        ...s.pricing.lineGroups,
        [id]: { ...current, [key]: value },
      };
    } else if (c === 'liveRemark')
      s.pricing.lineRemarks = { ...s.pricing.lineRemarks, [id]: value };
    else if (c === 'livePricing') {
      if (key === 'discountMode')
        s.pricing.discountAllocation = {
          ...s.pricing.discountAllocation,
          mode: value,
        };
      else s.pricing[key] = value;
    } else if (c === 'liveTemplate') {
      const t = s.quoteTemplates.find((t) => t.id === id);
      t[key] = value;
    } else if (c === 'liveAssumptions')
      s.quoteAssumptions.find((a) => a.id === id)[key] = value;
    else if (c === 'liveDiscountShare') {
      const shares = (s.pricing.discountAllocation?.shares || []).filter(
        (r) => r.key !== id,
      );
      if (value !== undefined) shares.push({ key: id, percentage: value });
      s.pricing.discountAllocation = {
        ...s.pricing.discountAllocation,
        mode: s.pricing.discountAllocation?.mode || 'category',
        shares,
      };
    } else if (c === 'liveDiscountDescription')
      s.pricing.discountAllocation = {
        ...s.pricing.discountAllocation,
        mode: s.pricing.discountAllocation?.mode || 'category',
        descriptions: {
          ...s.pricing.discountAllocation?.descriptions,
          [id]: value,
        },
      };
    else if (c === 'taskField') {
      const t = s.tasks.find((t) => t.id === id);
      t.fields = { ...t.fields, [key]: value };
    } else if (el.dataset.taskConfirm) {
      s.tasks.find((t) => t.id === el.dataset.taskConfirm).confirmed =
        el.checked;
      return true;
    } else if (el.hasAttribute('data-live-template'))
      s.selectedTemplate = el.value;
    else if (el.hasAttribute('data-live-mode')) {
      this.regroup(el.value);
    } else if (c === 'liveMaster') {
      const r = this.master.items.find(
        (r) => String(r[this.master.keyField]) === id,
      );
      r[key] = value;
      this.status = pick('目录未保存', 'Catalog unsaved');
      this.host.renderInPlace();
      return true;
    } else return false;
    this.host.dirty();
    this.host.renderInPlace();
    return true;
  }
  regroup(mode) {
    const s = this.host.state(),
      data = this.host.data(),
      p = livePricing(s, data);
    const lines =
      mode === 'manual'
        ? s.pricing.customLinesDraft || p.drafts
        : engine
            .buildQuoteLines(data.snapshot, mode, data.total)
            .map(({ amount, ...l }) => ({
              ...l,
              costWeight: amount,
              targetGrossMargin: 45,
              priceFixed: false,
              allocationFixed: false,
            }));
    const calculated = engine.allocateLinePricing(
      lines,
      data.total,
      p.weightedProfitShareRate,
    );
    const { manualTargetPrice: _old, ...rest } = s.pricing;
    s.pricing = {
      ...rest,
      customLinesDraft:
        (s.pricing.lineSourceMode || s.pricing.lineMode) === 'manual'
          ? p.drafts
          : s.pricing.customLinesDraft,
      lineMode: 'manual',
      lineSourceMode: mode,
      manualPricingBasis: 'line-gp',
      manualLines: calculated.lines,
    };
  }
  async action(action, el) {
    if (await this.features.action(action, el)) return true;
    const id = el.dataset.id,
      s = this.host.state(),
      projectId = this.record?.workspace.project.id;
    if (action === 'live-draft-save') {
      await this.draft.save();
      return true;
    }
    if (action === 'live-draft-restore') {
      await this.draft.restore();
      return true;
    }
    if (action === 'live-draft-backup') {
      this.download(
        new Blob([JSON.stringify(this.draft.document, null, 2)], {
          type: 'application/json',
        }),
        'formula-draft.json',
      );
      return true;
    }
    if (action === 'save') {
      await this.save();
      return true;
    }
    if (action === 'live-reload') {
      await this.run(() => this.start());
      return true;
    }
    if (action === 'reset') {
      this.host.notify(
        pick(
          '真实项目不提供重置示例。请使用版本和备份。',
          'Live projects use versions and backups, not sample resets.',
        ),
      );
      return true;
    }
    if (action === 'live-backup') {
      this.download(
        new Blob([JSON.stringify(workspaceFromState(s), null, 2)], {
          type: 'application/json',
        }),
        `${projectId}-unsaved-backup.json`,
      );
      return true;
    }
    if (action === 'master-tab' || action === 'live-master-reload') {
      await this.loadMaster(
        el.dataset.value || this.masterTab,
        action === 'live-master-reload',
      );
      return true;
    }
    if (action === 'live-workflow-publish') {
      await this.run(async () => {
        if (!this.publishPreview) return;
        if (this.publishPreview.projects.some((p) => p.blockers.length))
          throw new Error('Resolve publication blockers first.');
        await this.api.request('/workflow/publish', {
          method: 'POST',
          body: {
            apiVersion: API_VERSION,
            kind: 'WorkflowPublishRequest',
            steps: this.master.items,
            expectedRevision: this.master.revision,
            migrateActiveProjectIds: this.migrateIds || [],
            projectRevisions: Object.fromEntries(
              this.publishPreview.projects
                .filter((p) => !p.completed)
                .map((p) => [p.projectId, p.revision]),
            ),
          },
        });
        this.publishPreview = null;
        await this.loadMaster('workflow', true);
        this.host.notify(
          pick(
            '流程已发布，未完成项目按预览同步',
            'Workflow published; unfinished projects synchronized as previewed.',
          ),
        );
      });
      return true;
    }
    if (action === 'live-master-save') {
      await this.saveMaster();
      return true;
    }
    if (action === 'live-open-task') {
      await this.run(async () => {
        await this.load(el.dataset.projectId);
        this.expandedTask = id;
        location.hash = 'workflow';
      });
      return true;
    }
    if (action === 'new-project') {
      this.host.showCreate();
      return true;
    }
    if (action === 'live-create') {
      await this.run(async () => {
        await this.flush();
        const project = Object.fromEntries(
          ['id', 'name', 'client'].map((k) => [
            k,
            document.querySelector(`[data-new-project="${k}"]`).value.trim(),
          ]),
        );
        const r = await this.api.createProject(project);
        this.index = await this.api.list();
        const catalogs = await Promise.allSettled(
          ['profit-share', 'project-tags'].map((tab) =>
            this.api.request(`/masterdata/${tab}?limit=1000&offset=0`),
          ),
        );
        this.directory = {
          bu:
            catalogs[0].status === 'fulfilled'
              ? catalogs[0].value.items
                  .filter((r) => r.active === true)
                  .map((r) => r.bu)
                  .filter(Boolean)
              : [],
          tags:
            catalogs[1].status === 'fulfilled' ? catalogs[1].value.items : [],
        };
        this.status = pick('项目已创建', 'Project created');
        this.accept(r);
        await this.loadFiles();
        this.host.hideCreate();
      });
      return true;
    }
    if (!projectId) return false;
    if (action === 'open-project') {
      await this.run(() =>
        this.load(
          el.dataset.projectId ||
            this.index.find((p) => p.name === el.dataset.name)?.projectId,
        ),
      );
      return true;
    }
    if (
      action === 'folder' ||
      action === 'file-location' ||
      action === 'live-open-folder'
    ) {
      await this.run(() =>
        this.api.openFolder(
          projectId,
          action === 'folder' ? el.dataset.value : undefined,
          action === 'file-location' ? id : undefined,
        ),
      );
      return true;
    }
    if (action === 'live-save-root') {
      await this.run(async () => {
        await this.api.request('/archive-settings', {
          method: 'PUT',
          body: {
            apiVersion: API_VERSION,
            kind: 'ArchiveSettingsUpdateRequest',
            rootPath: s.archive.rootPath,
            expectedRevision: this.archiveSettings.revision,
          },
        });
        await this.loadFiles();
      });
      return true;
    }
    if (action === 'live-move-root') {
      await this.run(async () => {
        await this.api.request(
          `/projects/${encodeURIComponent(projectId)}/files/location`,
          {
            method: 'PUT',
            body: {
              apiVersion: API_VERSION,
              kind: 'ProjectArchiveMoveRequest',
              projectPath: s.archive.projectPath,
              expectedProjectPath: this.loadedProjectPath,
            },
          },
        );
        await this.loadFiles();
      });
      return true;
    }
    if (action === 'file-delete-confirm') {
      await this.run(async () => {
        await this.api.deleteFile(projectId, id);
        await this.loadFiles();
      });
      return true;
    }
    if (action === 'live-upload-retry') {
      await this.run(() => this.processUploads());
      return true;
    }
    if (action === 'file-download') {
      const f = s.files.find((f) => f.id === id);
      if (f) {
        const a = document.createElement('a');
        a.href = f.url;
        a.download = f.name;
        a.click();
      }
      return true;
    }
    if (action === 'live-task') {
      this.expandedTask = this.expandedTask === id ? '' : id;
      this.host.render();
      return true;
    }
    if (action === 'live-task-files') {
      this.host.taskFiles(id);
      return true;
    }
    if (action === 'live-hold' || action === 'live-workflow-action') {
      const task = s.tasks.find((t) => t.id === id);
      const payload =
        action === 'live-hold'
          ? {
              action: s._source.workflowHold
                ? 'resume_project'
                : 'hold_project',
              reason: this.workflowReasons?.project || '',
            }
          : {
              nodeCode: id,
              action: el.dataset.value,
              reason: this.workflowReasons?.[id] || '',
              owner: task.owner,
              note: task.note,
              followUpDate: task.due,
              fields: task.fields || {},
              ...(el.dataset.value === 'complete'
                ? { confirmed: Boolean(task.confirmed) }
                : {}),
            };
      await this.run(async () => {
        await this.flush();
        const r = await this.api.workflow(
          projectId,
          this.record.revision,
          payload,
        );
        if (this.workflowReasons)
          delete this.workflowReasons[action === 'live-hold' ? 'project' : id];
        this.status = pick('流程已更新', 'Workflow updated');
        this.accept(r);
        await this.loadFiles();
      });
      return true;
    }
    if (
      action === 'version-copy' ||
      action === 'version-blank' ||
      action === 'version-lock'
    ) {
      await this.run(async () => {
        await this.flush();
        const w = structuredClone(this.record.workspace),
          source = w.costVersions.find((v) => v.code === w.activeVersion);
        if (action === 'version-lock') source.state = 'Confirmed';
        else {
          const code = engine.nextCostVersionCode(w);
          const v = engine.createCostVersion(
            code,
            'Draft',
            action === 'version-copy' ? source.code : null,
            source,
          );
          if (action === 'version-blank') {
            v.costRows = [];
            v.subcontractCost = { mode: 'project', lines: [], siteTypes: [] };
            v.manualCosts = {
              ...v.manualCosts,
              ...Object.fromEntries(
                Object.entries(v.manualCosts)
                  .filter(([, v]) => typeof v === 'number')
                  .map(([k]) => [k, k === 'otherServiceRate' ? 0.01 : 0]),
              ),
              categoryRiskWeights: [],
            };
          }
          w.costVersions.push(v);
          w.activeVersion = code;
          for (const k of [
            'costRows',
            'rateSettings',
            'travelSettings',
            'manualCosts',
            'travelRows',
            'travelUplift',
            'subcontractCost',
          ])
            if (v[k] !== undefined) w[k] = structuredClone(v[k]);
        }
        const r = await this.api.save(w, this.record.revision);
        this.status = pick('版本已保存', 'Version saved');
        this.accept(r);
        await this.loadFiles();
      });
      return true;
    }
    if (action === 'reset-discount') {
      s.pricing.discountAllocation = {
        ...s.pricing.discountAllocation,
        mode: s.pricing.discountAllocation?.mode || 'total',
        shares: [],
      };
      this.host.dirty();
      this.host.renderInPlace();
      return true;
    }
    if (action === 'live-add-line') {
      const p = livePricing(s, this.host.data());
      const id = crypto.randomUUID();
      s.pricing = {
        ...s.pricing,
        lineMode: 'manual',
        lineSourceMode: 'manual',
        manualPricingBasis: 'line-gp',
        manualLines: [
          ...p.drafts,
          {
            id,
            description: pick('新报价条目', 'New quotation line'),
            quantity: 1,
            unit: 'lot',
            unitPrice: 0,
            costWeight: 0,
            targetGrossMargin: 45,
          },
        ],
      };
      this.host.dirty();
      this.host.render();
      return true;
    }
    if (action === 'live-refresh-quote') {
      const mode = s.pricing.lineSourceMode || s.pricing.lineMode || 'single';
      if (mode === 'manual') {
        this.host.notify(
          pick('自定义行由你维护。', 'Custom lines are maintained manually.'),
        );
        return true;
      }
      const data = this.host.data(),
        p = livePricing(s, data),
        source = engine.buildQuoteLines(data.snapshot, mode, data.total);
      s.refreshQuote = engine.refreshCostQuoteLines(
        p.drafts,
        source,
        s.pricing,
      );
      this.host.render();
      return true;
    }
    if (action === 'live-refresh-cancel') {
      delete s.refreshQuote;
      this.host.render();
      return true;
    }
    if (action === 'live-refresh-confirm') {
      if (!s.refreshQuote) return true;
      const d = this.host.data(),
        p = livePricing(s, d),
        refreshed = s.refreshQuote;
      const bound = engine.resolveQuoteCostBindings(
        refreshed.lines,
        d.snapshot,
        d.total,
        engine.refreshScopeRiskShares(
          s.pricing.riskScopeShares,
          engine.quoteScopeCosts(d.snapshot, d.total),
        ),
      );
      if (bound.errors.length) throw new Error(bound.errors.join('; '));
      const calc = engine.allocateLinePricing(
        bound.lines,
        d.total,
        p.weightedProfitShareRate,
      );
      s.pricing = {
        ...s.pricing,
        lineSourceMode:
          s.pricing.lineSourceMode || s.pricing.lineMode || 'single',
        lineMode: 'manual',
        manualPricingBasis: 'line-gp',
        manualLines: calc.lines,
        riskScopeShares: engine.refreshScopeRiskShares(
          s.pricing.riskScopeShares,
          engine.quoteScopeCosts(d.snapshot, d.total),
        ),
        lineGroups: refreshed.lineGroups,
        lineRemarks: refreshed.lineRemarks,
      };
      delete s.pricing.manualTargetPrice;
      delete s.refreshQuote;
      this.host.dirty();
      this.host.render();
      return true;
    }
    if (action === 'live-apply-template') {
      const template = s.quoteTemplates.find(
        (t) => t.id === s.selectedTemplate,
      );
      s.quoteAssumptions = this.features.caps.referenceAssumptions(
        s.quoteAssumptions,
        s._source.assumptionLibrary || [],
        template?.defaultAssumptionIds || [],
        s._source.project.client,
      );
      this.host.dirty();
      this.host.render();
      this.host.notify(
        pick(
          '已选择当前项目模板；条款保留在项目快照。',
          'Selected project template; terms stay in the project snapshot.',
        ),
      );
      return true;
    }
    if (action === 'apply-rates') {
      await this.run(() => this.features.adopt('resources'));
      return true;
    }
    if (action === 'export' || action === 'live-export-quote') {
      await this.features.action('extra-output', {
        dataset: { value: action === 'export' ? 'cost' : 'quote' },
      });
      return true;
    }
    return false;
  }
  async switchVersion(code) {
    await this.run(async () => {
      await this.flush();
      const w = structuredClone(this.record.workspace),
        v = w.costVersions.find((v) => v.code === code);
      if (!v) throw new Error('Unknown version');
      w.activeVersion = code;
      for (const k of [
        'costRows',
        'rateSettings',
        'travelSettings',
        'manualCosts',
        'travelRows',
        'travelUplift',
        'subcontractCost',
      ])
        if (v[k] !== undefined) w[k] = structuredClone(v[k]);
      this.accept(await this.api.save(w, this.record.revision));
      await this.loadFiles();
    });
  }
  async upload(files, filters) {
    const projectId = this.record.workspace.project.id;
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        this.host.notify('50 MiB maximum');
        continue;
      }
      this.uploadQueue.push({
        file,
        projectId,
        requestId: crypto.randomUUID(),
        category:
          filters.category !== 'all'
            ? filters.category
            : filters.node
              ? 'workflow'
              : filters.folder === 'quotation'
                ? 'quote'
                : filters.folder === 'cost'
                  ? 'cost'
                  : 'general',
        versionCode: filters.version || this.record.workspace.activeVersion,
        nodeCode: filters.node || '',
        error: '',
      });
    }
    await this.run(() => this.processUploads());
  }
  async processUploads() {
    for (const item of this.uploadQueue) {
      if (item.done) continue;
      const q = new URLSearchParams({
        originalName: item.file.name,
        mimeType: item.file.type || 'application/octet-stream',
        category: item.category,
        versionCode: item.versionCode,
        requestId: item.requestId,
        ...(item.nodeCode ? { nodeCode: item.nodeCode } : {}),
      });
      try {
        await this.api.request(
          `/projects/${encodeURIComponent(item.projectId)}/files?${q}`,
          {
            method: 'POST',
            body: item.file,
            headers: { 'Content-Type': 'application/octet-stream' },
          },
        );
        item.done = true;
      } catch (e) {
        item.error = e.message;
        this.error(e);
      }
    }
    await this.loadFiles();
  }
  download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  masterKey(tab) {
    return (
      {
        catalog: 'subcontract',
        cpq: 'cpq-catalog',
        templates: 'quote-templates',
        share: 'profit-share',
        history: 'maintenance',
      }[tab] || tab
    );
  }
  async loadMaster(tab, reload = false) {
    if (this.master)
      this.masterCache.set(this.masterTab, {
        record: this.master,
        before: this.masterBefore,
      });
    this.masterTab = tab;
    if (!reload && this.masterCache.has(tab)) {
      const cached = this.masterCache.get(tab);
      this.master = cached.record;
      this.masterBefore = cached.before;
      this.host.render();
      return;
    }
    this.master = null;
    this.host.render();
    try {
      const first = await this.api.request(
          `/masterdata/${this.masterKey(tab)}?limit=1000&offset=0`,
        ),
        items = [...first.items];
      while (items.length < first.total) {
        const page = await this.api.request(
          `/masterdata/${this.masterKey(tab)}?limit=1000&offset=${items.length}`,
        );
        if (page.revision !== first.revision || !page.items.length)
          throw new Error('Catalog changed while loading. Reload.');
        items.push(...page.items);
      }
      this.master = { ...first, items };
      this.masterBefore = structuredClone(this.master);
      this.masterCache.set(tab, {
        record: this.master,
        before: this.masterBefore,
      });
      this.host.render();
    } catch (e) {
      this.error(e);
    }
  }
  hasMasterEdits() {
    return (
      !!(this.master && !same(this.master.items, this.masterBefore.items)) ||
      [...this.masterCache.values()].some(
        (c) => !same(c.record.items, c.before.items),
      )
    );
  }
  async saveMaster() {
    await this.run(() => this.persistMaster());
  }
  async persistMaster() {
    if (!this.master) return;
    const before = new Map(
      this.masterBefore.items.map((r) => [r[this.master.keyField], r]),
    );
    const upsert = this.master.items.filter(
      (r) => !same(r, before.get(r[this.master.keyField])),
    );
    if (
      !upsert.length &&
      this.masterBefore.items.length === this.master.items.length
    )
      return;
    if (this.masterTab === 'workflow') {
      this.publishPreview = await this.api.request('/workflow/preview', {
        method: 'POST',
        body: {
          apiVersion: API_VERSION,
          kind: 'WorkflowPublishPreviewRequest',
          steps: this.master.items,
          expectedRevision: this.master.revision,
          migrateActiveProjectIds: this.migrateIds || [],
        },
      });
      return;
    }
    await this.api.request(`/masterdata/${this.masterKey(this.masterTab)}`, {
      method: 'PUT',
      body: {
        apiVersion: API_VERSION,
        kind: 'GlobalMasterDataUpdateRequest',
        expectedRevision: this.master.revision,
        changes: {
          upsert,
          remove: this.masterBefore.items
            .filter(
              (r) =>
                !this.master.items.some(
                  (n) => n[this.master.keyField] === r[this.master.keyField],
                ),
            )
            .map((r) => r[this.master.keyField]),
        },
      },
    });
    await this.loadMaster(this.masterTab, true);
    this.host.notify(
      pick(
        '目录已保存，原项目快照未改变',
        'Catalog saved; project snapshots retained.',
      ),
    );
  }
}
