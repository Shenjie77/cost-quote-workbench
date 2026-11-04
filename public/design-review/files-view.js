import { pick } from './i18n.js';
import { esc, btn, table, heading, input } from './ui.js';
export const fileCategories = [
  ['all', '全部', 'All'],
  ['general', '公共文件', 'General'],
  ['workflow', '流程', 'Workflow'],
  ['cost', '成本', 'Cost'],
  ['quote', '报价', 'Quote'],
  ['cpq', 'CPQ', 'CPQ'],
  ['maintenance', '维保', 'Maintenance'],
  ['source', '导入原件', 'Source'],
  ['backup', '备份', 'Backup'],
];
export const folderFor = (category) =>
  ['cost', 'source'].includes(category)
    ? 'cost'
    : ['quote', 'cpq', 'maintenance'].includes(category)
      ? 'quotation'
      : 'workflow';
export function folderLinks(compact = false) {
  return `<div class="${compact ? 'folder-shortcuts' : 'toolbar'}">${compact ? '' : `<span class="muted small">${pick('快捷目录', 'Folder shortcuts')}</span>`}${[
    ['all', '项目文件夹', 'Project folder'],
    ['cost', '成本文件夹', 'Cost folder'],
    ['quotation', '报价文件夹', 'Quotation folder'],
    ['workflow', '流程文件夹', 'Workflow folder'],
  ]
    .map(([id, zh, en]) =>
      btn(
        compact
          ? pick(zh.replace('文件夹', ''), en.replace(' folder', ''))
          : pick(zh, en),
        'folder',
        false,
        'folder',
        `data-value="${id}" aria-label="${pick(zh, en)}" title="${pick(zh, en)}"`,
      ),
    )
    .join('')}</div>`;
}
export function filesView(state, filters) {
  const files = state.files.filter(
    (f) =>
      (filters.folder === 'all' || folderFor(f.category) === filters.folder) &&
      (filters.category === 'all' || f.category === filters.category) &&
      (!filters.version || f.version === filters.version) &&
      (!filters.node || f.node === filters.node),
  );
  const option = (key, items) =>
    `<select data-file-filter="${key}" aria-label="${key}">${items.map(([v, label]) => `<option ${key === 'node' && v ? 'data-user-content' : ''} value="${esc(v)}" ${filters[key] === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  return (
    heading(
      pick('项目文件与归档', 'Project files & archive'),
      pick(
        '目录入口、版本、节点和附件操作集中在一处。',
        'Folder shortcuts, versions, nodes and file actions in one place.',
      ),
    ) +
    `<section class="sheet">${folderLinks()}<div class="toolbar"><span class="badge info">${state.live ? pick('真实归档', 'Live archive') : pick('目录交互预览', 'Folder interaction preview')}</span><span class="path-text" data-user-content>${esc(state.archive.projectPath)}/${filters.folder === 'all' ? '' : esc(filters.folder)}</span><button class="button" ${state.live ? 'data-action="live-open-folder"' : 'disabled'} title="${pick('正式接入后调用原平台 Open Folder API，在服务端电脑打开。', 'Production uses the existing Open Folder API on the server computer.')}">${state.live ? pick('在 Finder / Explorer 打开', 'Open in Finder / Explorer') : pick('在 Finder / Explorer 打开（待接入）', 'Open in Finder / Explorer (pending)')}</button></div><details class="details-panel"><summary>${pick('归档位置设置', 'Archive location settings')}</summary><div class="details-content"><label class="inline-field"><span>${pick('新项目默认根目录', 'Default root for new projects')}</span>${input('archive', 'project', 'rootPath', state.archive.rootPath)}${state.live ? btn(pick('保存默认根目录', 'Save default root'), 'live-save-root') : ''}</label><label class="inline-field"><span>${pick('当前项目文件夹', 'Current project folder')}</span>${input('archive', 'project', 'projectPath', state.archive.projectPath)}${state.live ? btn(pick('迁移当前项目目录', 'Move project archive'), 'live-move-root') : ''}</label><p class="small muted">${state.live ? pick('迁移目录会复制并校验文件；重命名项目不移动文件夹。', 'Relocation copies and verifies files; renaming a project does not move its folder.') : pick('审核页仅修改示例路径。正式迁移使用原平台的复制、校验、提交机制；重命名项目不移动文件夹。', 'Review changes sample paths only.')}</p></div></details><div class="toolbar">${option(
      'category',
      fileCategories.map(([id, zh, en]) => [id, pick(zh, en)]),
    )}${option('version', [
      ['', pick('全部版本', 'All versions')],
      ...(state.live
        ? [
            ...new Set([
              ...state._source.costVersions.map((v) => v.code),
              ...state.files.map((f) => f.version).filter(Boolean),
            ]),
          ].map((v) => [v, v])
        : [
            ['V1', 'V1'],
            ['V2', 'V2'],
          ]),
    ])}${option('node', [['', pick('全部节点', 'All nodes')], ...state.tasks.map((t) => [t.id, t.name])])}<span class="grow"></span><label class="button">${state.live ? pick('选择文件', 'Choose files') : pick('选择文件（本页演示）', 'Choose files (session only)')}<input id="review-file-upload" type="file" multiple hidden></label></div><div class="drop-area" data-file-drop tabindex="0">${state.live ? pick('拖入文件；单个不超过 50 MiB，上传至当前项目归档。', 'Drop files up to 50 MiB each to archive in this project.') : pick('拖入文件；单个不超过 50 MiB。仅保留在本次审核页面，可下载验证，不写入磁盘归档。', 'Drop files, up to 50 MiB each. Kept in this review session for download testing; not archived to disk.')}</div>${table(
      [
        { label: pick('文件名', 'File name'), cls: 'c-description' },
        { label: pick('类别', 'Category'), cls: 'c-code' },
        { label: pick('版本 / 节点', 'Version / node'), cls: 'c-medium' },
        { label: pick('大小', 'Size'), cls: 'c-short' },
        { label: pick('操作', 'Actions'), cls: 'c-note' },
      ],
      files
        .map(
          (f) =>
            `<tr><td data-user-content>${esc(f.name)}</td><td>${pick(...(fileCategories.find((c) => c[0] === f.category) || ['', f.category, f.category]).slice(1))}</td><td data-user-content>${esc(f.version || '—')} / ${esc(state.tasks.find((t) => t.id === f.node)?.name || '—')}</td><td>${f.size ? `${(f.size / 1024).toFixed(1)} KB` : '—'}</td><td><div class="actions">${btn(pick('下载', 'Download'), 'file-download', false, '', `data-id="${f.id}" ${f.url ? '' : 'disabled'}`)}${btn(pick('所在目录', 'Containing folder'), 'file-location', false, 'folder', `data-id="${f.id}"`)}${btn(pick('删除', 'Delete'), 'file-delete', false, '', `data-id="${f.id}"`)}</div></td></tr>${filters.deleteId === f.id ? `<tr><td colspan="5"><div class="toolbar"><span>${state.live ? pick('删除归档文件', 'Delete archived file') : pick('删除本页文件', 'Remove session file')} <strong data-user-content>${esc(f.name)}</strong>?</span>${btn(pick('确认删除', 'Confirm removal'), 'file-delete-confirm', false, '', `data-id="${f.id}"`)}${btn(pick('取消', 'Cancel'), 'file-delete-cancel')}</div></td></tr>` : ''}`,
        )
        .join(''),
    )}<div class="sheet-footer">${files.length} ${state.live ? pick('项归档文件', 'archived files') : pick('项；示例文件不包含附件，下载按钮仅对本次选择的文件启用。', 'items; sample records have no attachment. Downloads are enabled for files you choose.')}</div></section>`
  );
}
