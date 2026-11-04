import { esc, btn, heading, table } from './ui.js';
import { pick } from './i18n.js';
import * as engine from './business/engine.js';
const button = (name, key, value = '') =>
  btn(name, `extra-${key}`, false, '', `data-value="${esc(value)}"`);
export const draftTools = {
  subdraftContext(target) {
    const w = this.w(),
      value = w.subcontractCost || engine.emptySubcontractCost(),
      project = target === 'project';
    return {
      lines: project
        ? value.lines
        : value.siteTypes.find((s) => s.id === target)?.lines || [],
      project,
      factors: engine.getSubcontractRateFactors(
        value.rateSettings,
        engine.getY1Year(w.rateSettings),
      ),
    };
  },
  async openSubdraft(target) {
    await this.live.run(async () => {
      await this.live.flush();
      const w = this.w(),
        id = `subcontract:${w.project.id}:${w.activeVersion}:${target === 'project' ? 'project' : `site:${target}`}`,
        ctx = this.subdraftContext(target);
      const record = await this.live.api.request(
        `/calculation-drafts/${encodeURIComponent(id)}`,
      );
      this.subdraft = {
        target,
        id,
        document:
          record?.document ||
          this.caps.subcontractWorkbook(
            ctx.lines,
            ctx.project,
            ctx.factors,
            target,
          ),
        revision: record?.revision ?? null,
      };
    });
  },
  subdraftView() {
    const s = this.subdraft,
      ctx = this.subdraftContext(s.target),
      stale =
        s.document.basis !==
        this.caps.subcontractBasis(ctx.lines, ctx.project, ctx.factors);
    return (
      heading(
        pick('分包公式草稿', 'Subcontract formula draft'),
        pick(
          '保存草稿不会进入成本；计算并应用才更新成本。',
          'Saving the draft does not post costs; calculate and apply explicitly.',
        ),
      ) +
      `<section class="sheet"><div class="toolbar">${stale ? `<span class="validation">${pick('成本或费率已变化，应用前须从成本重新载入。', 'Costs or rates changed. Reload from costs before applying.')}</span>` : ''}${button(pick('保存草稿', 'Save draft'), 'subdraft-save')}${button(pick('计算并应用到成本', 'Calculate & apply to costs'), 'subdraft-apply')}${button(pick('完成', 'Done'), 'subdraft-done')}${button(pick('从成本重新载入', 'Reload from costs'), 'subdraft-reload')}${button(pick('下载备份', 'Download backup'), 'subdraft-backup')}</div><div id="extra-workbook" class="formula-sheet"></div></section>`
    );
  },
  async saveSubdraft() {
    const s = this.subdraft;
    if (this.handle)
      s.document = { ...s.document, workbook: await this.handle.calculate() };
    const record = await this.live.api.request(
      `/calculation-drafts/${encodeURIComponent(s.id)}`,
      {
        method: 'PUT',
        body: { document: s.document, expectedRevision: s.revision },
      },
    );
    s.revision = record.revision;
    s.dirty = false;
  },
  async subdraftAction(a) {
    if (a === 'subdraft-backup') {
      this.live.download(
        new Blob([JSON.stringify(this.subdraft.document, null, 2)]),
        `${this.subdraft.id.replaceAll(':', '_')}.json`,
      );
      return;
    }
    if (a === 'subdraft-reload') {
      this.confirmation = {
        message: pick(
          '用当前成本替换此草稿的公式？建议先下载备份。',
          'Replace draft formulas with current costs? Download a backup first.',
        ),
        run: () => {
          const c = this.subdraftContext(this.subdraft.target);
          this.detach();
          this.subdraft.document = this.caps.subcontractWorkbook(
            c.lines,
            c.project,
            c.factors,
            this.subdraft.target,
          );
        },
      };
      this.live.host.render();
      return;
    }
    await this.live.run(async () => {
      await this.saveSubdraft();
      if (a === 'subdraft-apply') {
        const c = this.subdraftContext(this.subdraft.target),
          lines = this.caps.readSubcontractWorkbook(
            this.subdraft.document,
            c.lines,
            c.project,
            c.factors,
          );
        await this.mutate(
          (w) => {
            if (c.project) w.subcontractCost.lines = lines;
            else
              w.subcontractCost.siteTypes.find(
                (s) => s.id === this.subdraft.target,
              ).lines = lines;
          },
          { cost: true },
        );
        const next = this.subdraftContext(this.subdraft.target);
        this.subdraft.document.basis = this.caps.subcontractBasis(
          next.lines,
          next.project,
          next.factors,
        );
        await this.saveSubdraft();
      }
      if (a === 'subdraft-done') {
        this.detach();
        this.subdraft = null;
      }
    });
  },
  aiView() {
    const ai = this.ai;
    return `<div class="toolbar"><select aria-label="AI scene" data-extra-ai="scene">${ai.scenes.map((s, i) => `<option value="${i}" ${i === ai.selected ? 'selected' : ''}>${esc(s.scene.name)}</option>`).join('')}</select>${button(pick('编辑场景', 'Edit scene'), 'ai-scene')}${button(pick('探测本地模型', 'Probe model'), 'ai-probe')}${button(pick('生成草稿', 'Generate draft'), 'ai-generate')}${ai.generating ? button(pick('取消等待', 'Cancel waiting'), 'ai-cancel') : ''}<span>${esc(ai.status || '')}</span></div><div class="details-content">${ai.sources.map((s) => `<label class="inline-field"><input type="checkbox" data-extra-ai-source="${esc(s.id)}" ${ai.selectedSources.has(s.id) ? 'checked' : ''}>${esc(s.titleZh || s.title)}</label>`).join('')}</div><label class="inline-field">${pick('调整要求', 'Adjustment')}<input data-extra-ai="adjustment" value="${esc(ai.adjustment || '')}"></label>${ai.result ? `<div class="details-content">${ai.result.sections.map((s) => `<h3>${esc(s.id)}</h3>${s.entries.map((e) => `<p>${esc(e.lead)} ${esc(e.excerpt)}</p>`).join('')}`).join('')}${button(pick('编辑并确认输出', 'Edit & confirm output'), 'ai-confirm')}</div>` : ''}${table([pick('时间', 'Date'), pick('状态', 'State'), pick('操作', 'Action')], ai.runs.map((r) => `<tr><td>${esc(r.createdAt)}</td><td>${esc(r.status)}</td><td>${button(pick('查看', 'View'), 'ai-run', r.id)}</td></tr>`).join(''))}<a class="text-button" href="${esc(this.live.api.base)}/ai-output/export" download>${pick('导出反馈记录', 'Export feedback')}</a>`;
  },
  async aiAction(a, value) {
    if (a === 'ai-open') {
      await this.live.run(async () => {
        const [scenes, runs] = await Promise.all([
          this.live.api.request('/ai-output/scenes'),
          this.live.api.request('/ai-output/runs'),
        ]);
        const digest = engine.buildDailyDigest(
          this.live.index,
          this.live.index.flatMap((p) => p.reviewGates || []),
        );
        this.ai = {
          scenes,
          runs,
          selected: 0,
          sources: digest.items,
          selectedSources: new Set(digest.items.slice(0, 30).map((i) => i.id)),
          adjustment: '',
        };
      });
      return;
    }
    const ai = this.ai;
    if (a === 'ai-cancel') {
      ai.controller?.abort();
      ai.generating = false;
      ai.status = pick(
        '已取消等待；已有草稿保留。',
        'Waiting cancelled; previous draft retained.',
      );
      this.live.host.render();
      return;
    }
    if (a === 'ai-probe') {
      await this.live.run(async () => {
        await this.live.api.request('/ai-output/probe', { method: 'POST' });
        ai.status = pick('模型连接正常', 'Model connected');
      });
      return;
    }
    if (a === 'ai-scene') {
      const selected = ai.scenes[ai.selected];
      this.openEditor(
        pick('本地 AI 场景', 'Local AI scene'),
        selected.scene,
        this.caps.sceneSchema,
        async (v) => {
          ai.scenes[ai.selected] = await this.live.api.request(
            '/ai-output/scenes',
            {
              method: 'PUT',
              body: { scene: v, expectedRevision: selected.revision },
            },
          );
        },
      );
      this.live.host.render();
      return;
    }
    if (a === 'ai-run') {
      const r = ai.runs.find((r) => r.id === value);
      ai.run = r;
      ai.result = r.final || r.result;
      ai.status = r.error || r.status;
      this.live.host.render();
      return;
    }
    if (a === 'ai-confirm') {
      if (!ai.run?.result) throw new Error('Select an output first');
      this.openEditor(
        pick('确认 AI 输出', 'Confirm AI output'),
        { output: ai.result, note: '' },
        {
          type: 'object',
          properties: {
            output: this.caps.outputSchema,
            note: { type: 'string' },
          },
        },
        async (v) => {
          ai.run = await this.live.api.request('/ai-output/confirm', {
            method: 'POST',
            body: { id: ai.run.id, final: v.output, note: v.note },
          });
          ai.result = ai.run.final;
          ai.runs = await this.live.api.request('/ai-output/runs');
        },
      );
      this.live.host.render();
      return;
    }
    if (a === 'ai-generate') {
      if (ai.generating) return;
      if (!ai.selectedSources.size || ai.selectedSources.size > 30)
        throw new Error('Select 1–30 source records.');
      ai.generating = true;
      ai.controller = new AbortController();
      ai.status = pick('正在生成…', 'Generating…');
      this.live.host.render();
      try {
        const s = ai.scenes[ai.selected];
        const response = await fetch(
          `${this.live.api.base}/ai-output/generate`,
          {
            method: 'POST',
            signal: ai.controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sceneId: s.scene.id,
              sceneRevision: s.revision,
              sourceIds: [...ai.selectedSources],
              adjustment: ai.adjustment,
            }),
          },
        );
        const result = await response.json();
        if (!response.ok || !result.ok)
          throw new Error(result.error?.message || 'Generation failed');
        ai.run = result.data;
        ai.result = ai.run.result;
        ai.runs = await this.live.api.request('/ai-output/runs');
        ai.status = pick(
          '草稿已生成，尚未确认',
          'Draft generated; awaiting confirmation',
        );
      } catch (e) {
        ai.status =
          e.name === 'AbortError'
            ? pick('已取消等待', 'Waiting cancelled')
            : e.message;
      } finally {
        ai.generating = false;
        this.live.host.render();
      }
    }
  },
};
