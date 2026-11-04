import { pick } from './i18n.js';
import { esc, input } from './ui.js';
export function projectInfoView(project, tags = []) {
  if (!project) return '';
  const fields = [
    ['proposalNumber', 'Proposal Number', 'Proposal Number'],
    ['companyUrl', 'iSales 链接', 'iSales URL'],
    ['cpqUrl', 'CPQ 链接', 'CPQ URL'],
    ['scopeBrief', '范围说明', 'Scope brief'],
    ['technicalBasis', '技术依据', 'Technical basis'],
  ];
  return `<details class="panel details-panel"><summary>${pick('当前项目资料与快捷链接', 'Current project details & links')} · <span data-user-content>${esc(project.name)}</span></summary><div class="details-content"><div class="field-grid">${fields.map(([key, zh, en]) => `<label class="inline-field"><span>${pick(zh, en)}</span>${input('projects', project.id, key, project[key] || '')}</label>`).join('')}</div><div class="toolbar"><span>${pick('项目标签', 'Project tags')}</span>${tags
    .filter((t) => t.active || project.tags?.includes(t.name))
    .map(
      (t) =>
        `<label class="inline-field"><input type="checkbox" data-project-tag="${esc(t.name)}" data-project-id="${project.id}" ${project.tags?.includes(t.name) ? 'checked' : ''} ${!t.active ? 'disabled' : ''}>${esc(t.name)}</label>`,
    )
    .join('')}</div><div class="toolbar">${['companyUrl', 'cpqUrl']
    .map((key) => {
      let valid = false;
      try {
        valid = ['http:', 'https:'].includes(new URL(project[key]).protocol);
      } catch {}
      return valid
        ? `<a class="button" target="_blank" rel="noopener noreferrer" href="${esc(project[key])}">${key === 'companyUrl' ? 'iSales' : 'CPQ'} ↗</a>`
        : '';
    })
    .join(
      '',
    )}<span class="small muted">${pick('项目资料与成本快照分开保存；目录位置在“项目文件”维护。', 'Project details are separate from cost snapshots; folder locations live under Project files.')}</span></div></div></details>`;
}
