import { pick } from './i18n.js';
import { heading, btn, esc } from './ui.js';
const recoveryKey = 'cost-workbench.calculation-recovery.scratchpad';
export class CompactDraft {
  constructor(api, notify) {
    this.api = api;
    this.notify = notify;
    this.handle = null;
    this.document = null;
    this.revision = null;
    this.loaded = false;
    this.status = '';
    this.generation = 0;
    this.dirty = false;
  }
  view() {
    return (
      heading(
        pick('公式草稿', 'Formula drafts'),
        pick(
          '独立公式工作簿，不直接计入项目成本。',
          'An independent formula workbook, separate from project costs.',
        ),
        btn(pick('保存草稿', 'Save draft'), 'live-draft-save', true) +
          btn(pick('下载备份', 'Download backup'), 'live-draft-backup'),
      ) +
      `<section class="sheet"><div class="toolbar"><span id="draft-status">${esc(this.status || pick('载入工作簿…', 'Loading workbook…'))}</span><span class="grow"></span>${localStorage.getItem(recoveryKey) ? btn(pick('恢复本机未保存草稿', 'Restore local unsaved draft'), 'live-draft-restore') : ''}</div><div id="compact-univer" class="formula-sheet"></div></section>`
    );
  }
  detach() {
    this.generation++;
    if (this.handle) {
      this.document = { ...this.document, workbook: this.handle.snapshot() };
      this.handle.dispose();
      this.handle = null;
    }
  }
  async mount() {
    const generation = ++this.generation;
    const runtime = await import('./generated/draft.js');
    if (!this.loaded) {
      const r = await this.api.request('/calculation-drafts/scratchpad');
      this.document = r?.document || runtime.initialScratchpad();
      this.revision = r?.revision ?? null;
      this.loaded = true;
    }
    if (generation !== this.generation) return;
    if (!document.querySelector('link[data-univer-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./generated/draft.css', import.meta.url).href;
      link.dataset.univerCss = '';
      document.head.append(link);
    }
    const container = document.querySelector('#compact-univer');
    if (!container) return;
    this.handle = runtime.mountUniver(
      container,
      this.document.workbook,
      (workbook) => {
        if (
          JSON.stringify(workbook) === JSON.stringify(this.document?.workbook)
        )
          return;
        this.document = { ...this.document, workbook };
        this.dirty = true;
        localStorage.setItem(
          recoveryKey,
          JSON.stringify({ document: this.document, revision: this.revision }),
        );
        this.setStatus(pick('草稿未保存', 'Unsaved draft'));
      },
    );
    this.document = { ...this.document, workbook: this.handle.snapshot() };
    this.setStatus(
      this.dirty
        ? pick('草稿未保存', 'Unsaved draft')
        : `${pick('已载入', 'Loaded')} · R${this.revision ?? 0}`,
    );
  }
  setStatus(text) {
    this.status = text;
    const el = document.querySelector('#draft-status');
    if (el) el.textContent = text;
  }
  async save() {
    try {
      if (this.handle)
        this.document = {
          ...this.document,
          workbook: await this.handle.calculate(),
        };
      this.setStatus(pick('保存中…', 'Saving…'));
      const r = await this.api.request('/calculation-drafts/scratchpad', {
        method: 'PUT',
        body: { document: this.document, expectedRevision: this.revision },
      });
      this.revision = r.revision;
      this.dirty = false;
      localStorage.removeItem(recoveryKey);
      this.setStatus(`${pick('已保存', 'Saved')} · R${r.revision}`);
    } catch (e) {
      this.setStatus(e.message);
      this.notify(e.message);
      throw e;
    }
  }
  restore() {
    const cached = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
    if (!cached?.document) throw new Error('No recoverable draft');
    this.detach();
    this.document = cached.document;
    this.dirty = true;
    return this.mount();
  }
}
