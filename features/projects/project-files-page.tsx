'use client';
import { useCallback, useState } from 'react';
import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { SectionHeading } from '@/components/workbench/section-heading';
import { ArchiveSettingsPanel, ProjectFilesPanel } from './project-files-panel';
import { useWorkbenchLanguage } from '../workbench/workbench-language';
import type { ProjectFileCategory } from './project-files';
import type { WorkflowStep } from './types';
const categories: [ProjectFileCategory, string, string][] = [
  ['general', 'General', '公共文件'],
  ['workflow', 'Workflow', '流程文件'],
  ['cost', 'Cost', '成本文件'],
  ['quote', 'Quotation', '报价文件'],
  ['cpq', 'CPQ', 'CPQ'],
  ['maintenance', 'Maintenance', '维保'],
  ['source', 'Source imports', '导入原件'],
  ['backup', 'Backup', '备份'],
];
/** The standalone archive surface reuses the existing upload queue, revisions and OS-folder API. */
export function ProjectFilesPage({
  projectId,
  versions,
  steps,
  onBusyChange,
}: {
  projectId: string;
  versions: string[];
  steps: WorkflowStep[];
  onBusyChange: (busy: boolean) => void;
}) {
  const { label } = useWorkbenchLanguage();
  const [category, setCategory] = useState<ProjectFileCategory | ''>('');
  const [version, setVersion] = useState('');
  const [node, setNode] = useState('');
  const [busy, setBusy] = useState(false);
  const uploadingChanged = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange(value);
    },
    [onBusyChange],
  );
  return (
    <Surface variant="page">
      <SectionHeading
        variant="page"
        title="Project files & archive"
        titleZh="项目文件与归档"
        description="Browse project files by category, version or workflow step."
        descriptionZh="按类别、版本或流程节点查找文件，也可直接打开项目文件夹。"
      />

      <Surface variant="sheet">
        <Disclosure>
          <DisclosureSummary>
            {label('Archive location settings', '归档位置设置')}
          </DisclosureSummary>
          <ArchiveSettingsPanel disabled={busy} />
        </Disclosure>
        <ProjectFilesPanel
          embedded
          toolbar={
            <>
              <label className="flex items-center gap-2">
                <Text
                  textRole="body-small"
                  className="shrink-0 whitespace-nowrap"
                >
                  {label('Category', '类别')}
                </Text>
                <SelectField
                  aria-label="File category"
                  value={category}
                  disabled={busy}
                  onChange={(e) => {
                    setCategory(e.target.value as ProjectFileCategory | '');
                    setNode('');
                  }}
                >
                  <option value="">
                    {label('All categories', '全部类别')}
                  </option>
                  {categories.map(([key, en, zh]) => (
                    <option key={key} value={key}>
                      {label(en, zh)}
                    </option>
                  ))}
                </SelectField>
              </label>
              <label className="flex items-center gap-2">
                <Text
                  textRole="body-small"
                  className="shrink-0 whitespace-nowrap"
                >
                  {label('Version', '版本')}
                </Text>
                <SelectField
                  aria-label="File version"
                  value={version}
                  disabled={busy}
                  onChange={(e) => {
                    setVersion(e.target.value);
                    if (!e.target.value) setNode('');
                  }}
                >
                  <option value="">{label('All versions', '全部版本')}</option>
                  {versions.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </SelectField>
              </label>
              <label className="flex items-center gap-2">
                <Text
                  textRole="body-small"
                  className="shrink-0 whitespace-nowrap"
                >
                  {label('Node', '节点')}
                </Text>
                <SelectField
                  aria-label="File node"
                  value={node}
                  disabled={busy}
                  onChange={(e) => {
                    setNode(e.target.value);
                    if (e.target.value) {
                      setCategory('workflow');
                      if (!version) setVersion(versions.at(-1) || '');
                    }
                  }}
                >
                  <option value="">{label('All nodes', '全部节点')}</option>
                  {steps.map((s) => (
                    <option key={s.code} value={s.code}>
                      {label(s.name, s.nameZh)}
                    </option>
                  ))}
                </SelectField>
              </label>
            </>
          }
          projectId={projectId}
          nodeCode={node || undefined}
          nodeName={steps.find((s) => s.code === node)?.name}
          versionCode={version || undefined}
          filterCategory={category || undefined}
          onUploadingChange={uploadingChanged}
        />
      </Surface>
    </Surface>
  );
}
